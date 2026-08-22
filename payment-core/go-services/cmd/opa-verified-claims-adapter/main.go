// Command opa-verified-claims-adapter is the sole bridge between APISIX's
// standard OPA request envelope and policies that require verified Keycloak
// claims. It never trusts X-Userinfo, X-ID-Token, or any client-supplied
// identity header. Instead it independently verifies the Authorization bearer
// token against Keycloak JWKS before adding verified_jwt to the OPA input.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/payment-switch/go-services/internal/integration"
)

const defaultMaxRequestBytes int64 = 1 << 20

type tokenValidator interface {
	ValidateToken(context.Context, string) (*integration.JWTClaims, error)
}

type adapter struct {
	validator       tokenValidator
	opaDecisionURL  string
	httpClient      *http.Client
	maxRequestBytes int64
}

type opaEnvelope struct {
	Input json.RawMessage `json:"input"`
}

type verifiedJWT struct {
	Valid     bool        `json:"valid"`
	Subject   string      `json:"sub"`
	Issuer    string      `json:"iss"`
	Audience  interface{} `json:"aud"`
	ExpiresAt int64       `json:"exp"`
	Roles     []string    `json:"roles"`
}

type adapterInput struct {
	Request     json.RawMessage `json:"request"`
	Var         json.RawMessage `json:"var,omitempty"`
	Route       json.RawMessage `json:"route,omitempty"`
	Service     json.RawMessage `json:"service,omitempty"`
	Consumer    json.RawMessage `json:"consumer,omitempty"`
	VerifiedJWT verifiedJWT     `json:"verified_jwt"`
}

type opaRequest struct {
	Input adapterInput `json:"input"`
}

type opaResult struct {
	Allow      bool              `json:"allow"`
	Reason     interface{}       `json:"reason,omitempty"`
	Headers    map[string]string `json:"headers,omitempty"`
	StatusCode int               `json:"status_code,omitempty"`
}

type opaResponse struct {
	Result opaResult `json:"result"`
}

func main() {
	config, err := loadConfig()
	if err != nil {
		log.Fatalf("invalid verified-claim adapter configuration: %v", err)
	}

	validator, err := integration.NewKeycloakJWTValidator(config.keycloak)
	if err != nil {
		log.Fatalf("initial Keycloak JWKS fetch failed: %v", err)
	}

	a := &adapter{
		validator:       validator,
		opaDecisionURL:  config.opaDecisionURL,
		httpClient:      &http.Client{Timeout: 3 * time.Second},
		maxRequestBytes: defaultMaxRequestBytes,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", a.health)
	mux.HandleFunc("/v1/data/payment/authorization", a.authorize)

	server := &http.Server{
		Addr:              config.listenAddr,
		Handler:           securityHeaders(mux),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	log.Printf("verified-claim adapter listening on %s", config.listenAddr)
	log.Fatal(server.ListenAndServe())
}

type runtimeConfig struct {
	listenAddr     string
	opaDecisionURL string
	keycloak       *integration.KeycloakConfig
}

func loadConfig() (*runtimeConfig, error) {
	baseURL := requiredEnv("KEYCLOAK_BASE_URL")
	realm := requiredEnv("KEYCLOAK_REALM")
	issuer := requiredEnv("KEYCLOAK_REQUIRED_ISSUER")
	audience := requiredEnv("KEYCLOAK_REQUIRED_AUDIENCE")
	opaURL := requiredEnv("OPA_DECISION_URL")
	if baseURL == "" || realm == "" || issuer == "" || audience == "" || opaURL == "" {
		return nil, errors.New("KEYCLOAK_BASE_URL, KEYCLOAK_REALM, KEYCLOAK_REQUIRED_ISSUER, KEYCLOAK_REQUIRED_AUDIENCE, and OPA_DECISION_URL are required")
	}
	if !strings.HasPrefix(opaURL, "https://") && !strings.HasPrefix(opaURL, "http://") {
		return nil, errors.New("OPA_DECISION_URL must be an absolute http(s) URL")
	}
	return &runtimeConfig{
		listenAddr:     envOr("LISTEN_ADDR", ":8080"),
		opaDecisionURL: opaURL,
		keycloak: &integration.KeycloakConfig{
			BaseURL:             baseURL,
			Realm:               realm,
			ClientID:            envOr("KEYCLOAK_CLIENT_ID", audience),
			RequiredIssuer:      issuer,
			RequiredAudience:    audience,
			JWKSRefreshInterval: 5 * time.Minute,
			ClockSkew:           30 * time.Second,
		},
	}, nil
}

func (a *adapter) health(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *adapter) authorize(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, opaResponse{Result: opaResult{Allow: false, Reason: "method_not_allowed", StatusCode: http.StatusMethodNotAllowed}})
		return
	}

	token, err := bearerToken(r.Header.Get("Authorization"))
	if err != nil {
		a.deny(w, http.StatusUnauthorized, "invalid_token")
		return
	}
	claims, err := a.validator.ValidateToken(r.Context(), token)
	if err != nil {
		a.deny(w, http.StatusUnauthorized, "invalid_token")
		return
	}

	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, a.maxRequestBytes))
	if err != nil {
		a.deny(w, http.StatusRequestEntityTooLarge, "request_too_large")
		return
	}
	var incoming opaEnvelope
	if err := json.Unmarshal(body, &incoming); err != nil || len(incoming.Input) == 0 {
		a.deny(w, http.StatusBadRequest, "invalid_opa_input")
		return
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(incoming.Input, &raw); err != nil || len(raw["request"]) == 0 {
		a.deny(w, http.StatusBadRequest, "missing_request")
		return
	}

	request := opaRequest{Input: adapterInput{
		Request:  raw["request"],
		Var:      raw["var"],
		Route:    raw["route"],
		Service:  raw["service"],
		Consumer: raw["consumer"],
		VerifiedJWT: verifiedJWT{
			Valid:     true,
			Subject:   claims.Subject,
			Issuer:    claims.Issuer,
			Audience:  claims.Audience,
			ExpiresAt: claims.ExpiresAt,
			Roles:     allRoles(claims),
		},
	}}
	response, err := a.callOPA(r.Context(), request)
	if err != nil {
		a.deny(w, http.StatusServiceUnavailable, "policy_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (a *adapter) callOPA(ctx context.Context, payload opaRequest) (opaResponse, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return opaResponse{}, fmt.Errorf("marshal policy request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.opaDecisionURL, bytes.NewReader(body))
	if err != nil {
		return opaResponse{}, fmt.Errorf("create policy request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.httpClient.Do(req)
	if err != nil {
		return opaResponse{}, fmt.Errorf("call OPA: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return opaResponse{}, fmt.Errorf("OPA returned %d", resp.StatusCode)
	}
	var result opaResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, a.maxRequestBytes)).Decode(&result); err != nil {
		return opaResponse{}, fmt.Errorf("decode OPA response: %w", err)
	}
	return result, nil
}

func (a *adapter) deny(w http.ResponseWriter, status int, reason string) {
	writeJSON(w, http.StatusOK, opaResponse{Result: opaResult{Allow: false, Reason: reason, StatusCode: status}})
}

func bearerToken(header string) (string, error) {
	parts := strings.Fields(header)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
		return "", errors.New("missing or malformed bearer token")
	}
	return parts[1], nil
}

func allRoles(claims *integration.JWTClaims) []string {
	unique := make(map[string]struct{})
	if claims.RealmAccess != nil {
		for _, role := range claims.RealmAccess.Roles {
			if role != "" {
				unique[role] = struct{}{}
			}
		}
	}
	for _, access := range claims.ResourceAccess {
		if access == nil {
			continue
		}
		for _, role := range access.Roles {
			if role != "" {
				unique[role] = struct{}{}
			}
		}
	}
	for _, permission := range claims.Permissions {
		if permission != "" {
			unique[permission] = struct{}{}
		}
	}
	roles := make([]string, 0, len(unique))
	for role := range unique {
		roles = append(roles, role)
	}
	sort.Strings(roles)
	return roles
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func requiredEnv(key string) string { return strings.TrimSpace(os.Getenv(key)) }
func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
