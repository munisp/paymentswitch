package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

type config struct {
	ListenAddress string
	OPAURL        string
	CACert        string
	ClientCert    string
	ClientKey     string
}

type userInfo struct {
	Subject     string `json:"sub"`
	TenantID    string `json:"tenant_id"`
	ACR         any    `json:"acr"`
	AMR         []any  `json:"amr"`
	RealmAccess struct {
		Roles []string `json:"roles"`
	} `json:"realm_access"`
}

type opaInput struct {
	Subject struct {
		ID          string   `json:"id"`
		Roles       []string `json:"roles"`
		TenantID    string   `json:"tenantId"`
		TenantSnake string   `json:"tenant_id"`
		MFAVerified bool     `json:"mfa_verified"`
	} `json:"subject"`
	Action   string `json:"action"`
	Resource struct {
		Type        string `json:"type"`
		ID          string `json:"id"`
		TenantID    string `json:"tenantId"`
		TenantSnake string `json:"tenant_id"`
	} `json:"resource"`
	TenantID string `json:"tenantId"`
	Source   string `json:"source"`
}

type opaRequest struct {
	Input opaInput `json:"input"`
}

type opaResponse struct {
	Result *bool `json:"result"`
}

type server struct {
	opaURL string
	client *http.Client
}

func requiredEnv(name string) (string, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return "", fmt.Errorf("%s is required", name)
	}
	return value, nil
}

func loadConfig() (config, error) {
	opaURL, err := requiredEnv("OPA_URL")
	if err != nil {
		return config{}, err
	}
	ca, err := requiredEnv("OPA_CA_CERT")
	if err != nil {
		return config{}, err
	}
	cert, err := requiredEnv("OPA_CLIENT_CERT")
	if err != nil {
		return config{}, err
	}
	key, err := requiredEnv("OPA_CLIENT_KEY")
	if err != nil {
		return config{}, err
	}
	return config{
		ListenAddress: envOr("LISTEN_ADDRESS", "127.0.0.1:9444"),
		OPAURL:        strings.TrimRight(opaURL, "/"),
		CACert:        ca,
		ClientCert:    cert,
		ClientKey:     key,
	}, nil
}

func envOr(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func newOPAClient(cfg config) (*http.Client, error) {
	caPEM, err := os.ReadFile(cfg.CACert)
	if err != nil {
		return nil, fmt.Errorf("read OPA CA: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		return nil, errors.New("OPA CA file contains no valid certificate")
	}
	certificate, err := tls.LoadX509KeyPair(cfg.ClientCert, cfg.ClientKey)
	if err != nil {
		return nil, fmt.Errorf("load OPA client certificate: %w", err)
	}
	transport := &http.Transport{
		TLSClientConfig: &tls.Config{
			MinVersion:   tls.VersionTLS12,
			RootCAs:      pool,
			Certificates: []tls.Certificate{certificate},
		},
		ForceAttemptHTTP2: true,
	}
	return &http.Client{Transport: transport, Timeout: 2 * time.Second}, nil
}

func decodeUserInfo(encoded string) (userInfo, error) {
	encoded = strings.TrimSpace(encoded)
	if encoded == "" {
		return userInfo{}, errors.New("X-Userinfo is missing")
	}
	var decoded []byte
	var err error
	for _, encoding := range []*base64.Encoding{
		base64.StdEncoding,
		base64.RawStdEncoding,
		base64.URLEncoding,
		base64.RawURLEncoding,
	} {
		decoded, err = encoding.DecodeString(encoded)
		if err == nil {
			break
		}
	}
	if err != nil {
		return userInfo{}, errors.New("X-Userinfo is not valid base64")
	}
	var claims userInfo
	if err := json.Unmarshal(decoded, &claims); err != nil {
		return userInfo{}, errors.New("X-Userinfo is not valid JSON")
	}
	claims.Subject = strings.TrimSpace(claims.Subject)
	claims.TenantID = strings.TrimSpace(claims.TenantID)
	if claims.Subject == "" || claims.TenantID == "" {
		return userInfo{}, errors.New("verified userinfo is missing subject or tenant")
	}
	return claims, nil
}

func mfaVerified(claims userInfo) bool {
	switch value := claims.ACR.(type) {
	case string:
		level, err := strconv.Atoi(value)
		if err == nil && level >= 2 {
			return true
		}
	case float64:
		if value >= 2 {
			return true
		}
	}
	for _, raw := range claims.AMR {
		method, ok := raw.(string)
		if ok && (method == "mfa" || method == "otp" || method == "hwk" || method == "swk") {
			return true
		}
	}
	return false
}

func routeDecision(method, path, tenant, idempotencyKey string) (action, resourceType, resourceID, source string, err error) {
	method = strings.ToUpper(strings.TrimSpace(method))
	path = strings.SplitN(path, "?", 2)[0]
	const adminPrefix = "/api/v1/admin/payments/"
	const paymentPrefix = "/api/v1/payments/"
	if method == http.MethodPost && strings.HasPrefix(path, adminPrefix) && strings.HasSuffix(path, "/approve") {
		id := strings.TrimSuffix(strings.TrimPrefix(path, adminPrefix), "/approve")
		if id == "" || strings.Contains(id, "/") {
			return "", "", "", "", errors.New("invalid admin payment path")
		}
		return "approve_payment", "payment", id, "admin", nil
	}
	if method == http.MethodPost && path == "/api/v1/payments" {
		if !validIdempotencyKey(idempotencyKey) {
			return "", "", "", "", errors.New("valid Idempotency-Key is required")
		}
		digest := sha256.Sum256([]byte(tenant + ":" + idempotencyKey))
		return "write", "payment", "new:" + hex.EncodeToString(digest[:16]), "api", nil
	}
	if method == http.MethodGet && strings.HasPrefix(path, paymentPrefix) {
		id := strings.TrimPrefix(path, paymentPrefix)
		if id == "" || strings.Contains(id, "/") {
			return "", "", "", "", errors.New("invalid payment path")
		}
		return "read", "payment", id, "api", nil
	}
	return "", "", "", "", errors.New("route is not authorized by this sidecar")
}

func validIdempotencyKey(value string) bool {
	if len(value) < 1 || len(value) > 255 {
		return false
	}
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '-' || char == '_' {
			continue
		}
		return false
	}
	return true
}

func decisionID(request *http.Request) string {
	if value := strings.TrimSpace(request.Header.Get("X-Request-ID")); len(value) >= 8 && len(value) <= 128 {
		return "authz:" + value
	}
	digest := sha256.Sum256([]byte(time.Now().UTC().String() + request.RemoteAddr))
	return "authz:" + hex.EncodeToString(digest[:16])
}

func (s *server) authorize(response http.ResponseWriter, request *http.Request) {
	id := decisionID(request)
	response.Header().Set("X-Authorization-Decision-ID", id)
	if traceparent := strings.TrimSpace(request.Header.Get("Traceparent")); traceparent != "" {
		response.Header().Set("Traceparent", traceparent)
	}
	if request.Method != http.MethodGet {
		http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	claims, err := decodeUserInfo(request.Header.Get("X-Userinfo"))
	if err != nil {
		http.Error(response, "verified identity is required", http.StatusUnauthorized)
		return
	}
	requestedTenant := strings.TrimSpace(request.Header.Get("X-Tenant-ID"))
	if requestedTenant == "" {
		requestedTenant = claims.TenantID
	}
	if requestedTenant != claims.TenantID {
		http.Error(response, "tenant mismatch", http.StatusForbidden)
		return
	}
	action, resourceType, resourceID, source, err := routeDecision(
		request.Header.Get("X-Forwarded-Method"),
		request.Header.Get("X-Forwarded-Uri"),
		claims.TenantID,
		request.Header.Get("Idempotency-Key"),
	)
	if err != nil {
		http.Error(response, "route is not authorized", http.StatusForbidden)
		return
	}

	input := opaInput{Action: action, TenantID: claims.TenantID, Source: source}
	input.Subject.ID = claims.Subject
	input.Subject.Roles = claims.RealmAccess.Roles
	input.Subject.TenantID = claims.TenantID
	input.Subject.TenantSnake = claims.TenantID
	input.Subject.MFAVerified = mfaVerified(claims)
	input.Resource.Type = resourceType
	input.Resource.ID = resourceID
	input.Resource.TenantID = claims.TenantID
	input.Resource.TenantSnake = claims.TenantID
	payload, err := json.Marshal(opaRequest{Input: input})
	if err != nil {
		http.Error(response, "authorization dependency unavailable", http.StatusServiceUnavailable)
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), 2*time.Second)
	defer cancel()
	opaRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, s.opaURL+"/v1/data/paymentswitch/authz/allow", bytes.NewReader(payload))
	if err != nil {
		http.Error(response, "authorization dependency unavailable", http.StatusServiceUnavailable)
		return
	}
	opaRequest.Header.Set("Content-Type", "application/json")
	if traceparent := request.Header.Get("Traceparent"); traceparent != "" {
		opaRequest.Header.Set("Traceparent", traceparent)
	}
	opaResponseValue, err := s.client.Do(opaRequest)
	if err != nil {
		http.Error(response, "authorization dependency unavailable", http.StatusServiceUnavailable)
		return
	}
	defer opaResponseValue.Body.Close()
	body, err := io.ReadAll(io.LimitReader(opaResponseValue.Body, 64*1024))
	if err != nil || opaResponseValue.StatusCode < 200 || opaResponseValue.StatusCode >= 300 {
		http.Error(response, "authorization dependency unavailable", http.StatusServiceUnavailable)
		return
	}
	var decision opaResponse
	if err := json.Unmarshal(body, &decision); err != nil || decision.Result == nil {
		http.Error(response, "authorization dependency unavailable", http.StatusServiceUnavailable)
		return
	}
	if !*decision.Result {
		http.Error(response, "forbidden", http.StatusForbidden)
		return
	}
	response.WriteHeader(http.StatusOK)
}

func healthcheck(address string) error {
	client := &http.Client{Timeout: time.Second}
	response, err := client.Get("http://" + address + "/healthz")
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("health check returned HTTP %d", response.StatusCode)
	}
	return nil
}

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--healthcheck" {
		if err := healthcheck(envOr("LISTEN_ADDRESS", "127.0.0.1:9444")); err != nil {
			log.Fatal(err)
		}
		return
	}
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}
	client, err := newOPAClient(cfg)
	if err != nil {
		log.Fatal(err)
	}
	service := &server{opaURL: cfg.OPAURL, client: client}
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("/authorize", service.authorize)
	httpServer := &http.Server{
		Addr:              cfg.ListenAddress,
		Handler:           mux,
		ReadHeaderTimeout: 2 * time.Second,
		ReadTimeout:       3 * time.Second,
		WriteTimeout:      3 * time.Second,
		IdleTimeout:       30 * time.Second,
		MaxHeaderBytes:    32 * 1024,
	}
	log.Printf("OPA authorization sidecar listening on %s", cfg.ListenAddress)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
