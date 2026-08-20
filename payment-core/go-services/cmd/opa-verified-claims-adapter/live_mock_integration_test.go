package main

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/payment-switch/go-services/internal/integration"
)

func TestAdapterWithLiveMockKeycloakAndOPA(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	issuer := "http://keycloak.mock/realms/payment-switch"
	keycloak := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/realms/payment-switch/protocol/openid-connect/certs" {
			http.NotFound(w, r)
			return
		}
		writeMockJSON(w, map[string]interface{}{"keys": []map[string]string{{
			"kid": "mock-key-1", "kty": "RSA", "alg": "RS256", "use": "sig",
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.PublicKey.E)).Bytes()),
		}}})
	}))
	defer keycloak.Close()

	var policyInput opaRequest
	opa := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/data/payment/authorization" {
			http.NotFound(w, r)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&policyInput); err != nil {
			t.Fatalf("decode OPA input: %v", err)
		}
		writeMockJSON(w, opaResponse{Result: opaResult{Allow: true}})
	}))
	defer opa.Close()

	validator, err := integration.NewKeycloakJWTValidator(&integration.KeycloakConfig{
		BaseURL:             keycloak.URL,
		Realm:               "payment-switch",
		RequiredIssuer:      issuer,
		RequiredAudience:    "payment-switch-api",
		JWKSRefreshInterval: time.Hour,
		ClockSkew:           5 * time.Second,
	})
	if err != nil {
		t.Fatalf("create validator: %v", err)
	}
	adapter := &adapter{validator: validator, opaDecisionURL: opa.URL + "/v1/data/payment/authorization", httpClient: opa.Client(), maxRequestBytes: defaultMaxRequestBytes}

	token := signedMockToken(t, key, map[string]interface{}{
		"iss": issuer, "sub": "mock-subject", "aud": "payment-switch-api",
		"exp": time.Now().Add(5 * time.Minute).Unix(), "iat": time.Now().Add(-time.Minute).Unix(),
		"realm_access": map[string]interface{}{"roles": []string{"payment:process"}},
	})
	request := httptest.NewRequest(http.MethodPost, "/v1/data/payment/authorization", strings.NewReader(`{"input":{"request":{"method":"POST","path":"/api/v1/payments/process"},"verified_jwt":{"valid":false,"roles":["forged"]}}}`))
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	adapter.authorize(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("adapter response code = %d", response.Code)
	}
	if !policyInput.Input.VerifiedJWT.Valid || policyInput.Input.VerifiedJWT.Subject != "mock-subject" {
		t.Fatalf("OPA did not receive verified claims: %#v", policyInput.Input.VerifiedJWT)
	}
	if len(policyInput.Input.VerifiedJWT.Roles) != 1 || policyInput.Input.VerifiedJWT.Roles[0] != "payment:process" {
		t.Fatalf("OPA received unexpected roles: %#v", policyInput.Input.VerifiedJWT.Roles)
	}
}

func signedMockToken(t *testing.T, key *rsa.PrivateKey, claims map[string]interface{}) string {
	t.Helper()
	encode := func(value interface{}) string {
		bytes, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		return base64.RawURLEncoding.EncodeToString(bytes)
	}
	header := encode(map[string]string{"alg": "RS256", "kid": "mock-key-1", "typ": "JWT"})
	payload := encode(claims)
	digest := sha256.Sum256([]byte(header + "." + payload))
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, cryptoHashSHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return header + "." + payload + "." + base64.RawURLEncoding.EncodeToString(signature)
}

// Kept as a local alias to keep the test's signing intent explicit.
var cryptoHashSHA256 = crypto.SHA256

func writeMockJSON(w http.ResponseWriter, value interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}
