package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/payment-switch/go-services/internal/integration"
)

type fakeValidator struct {
	claims *integration.JWTClaims
	err    error
	token  string
}

func (f *fakeValidator) ValidateToken(_ context.Context, token string) (*integration.JWTClaims, error) {
	f.token = token
	if f.err != nil {
		return nil, f.err
	}
	return f.claims, nil
}

func TestAdapterForwardsOnlyVerifiedClaims(t *testing.T) {
	var received opaRequest
	opa := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("decode OPA request: %v", err)
		}
		_ = json.NewEncoder(w).Encode(opaResponse{Result: opaResult{Allow: true}})
	}))
	defer opa.Close()

	validator := &fakeValidator{claims: &integration.JWTClaims{
		Issuer: "https://issuer.example/realms/payment-switch", Subject: "trusted-subject", ExpiresAt: 2_000_000_000,
		Audience:    []interface{}{"payment-switch-api"},
		RealmAccess: &integration.AccessClaim{Roles: []string{"operator", "payment:process"}},
		Permissions: []string{"payment:query"},
	}}
	adapter := &adapter{validator: validator, opaDecisionURL: opa.URL, httpClient: opa.Client(), maxRequestBytes: defaultMaxRequestBytes}

	request := httptest.NewRequest(http.MethodPost, "/v1/data/payment/authorization", strings.NewReader(`{"input":{"request":{"method":"POST","path":"/api/v1/payments/process","headers":{"x-userinfo":"forged"}},"verified_jwt":{"valid":true,"roles":["admin"]}}}`))
	request.Header.Set("Authorization", "Bearer independently-validated-token")
	response := httptest.NewRecorder()
	adapter.authorize(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	if validator.token != "independently-validated-token" {
		t.Fatalf("validator token = %q", validator.token)
	}
	if !received.Input.VerifiedJWT.Valid || received.Input.VerifiedJWT.Subject != "trusted-subject" {
		t.Fatalf("verified claims = %#v", received.Input.VerifiedJWT)
	}
	for _, role := range received.Input.VerifiedJWT.Roles {
		if role == "admin" {
			t.Fatalf("caller-provided admin role leaked into OPA input")
		}
	}
	if got := string(received.Input.Request); !strings.Contains(got, `"path":"/api/v1/payments/process"`) {
		t.Fatalf("request envelope was not preserved: %s", got)
	}
}

func TestAdapterFailsClosedForInvalidToken(t *testing.T) {
	adapter := &adapter{validator: &fakeValidator{err: errors.New("signature invalid")}, maxRequestBytes: defaultMaxRequestBytes}
	request := httptest.NewRequest(http.MethodPost, "/v1/data/payment/authorization", strings.NewReader(`{"input":{"request":{"method":"POST","path":"/api/v1/payments/process"}}}`))
	request.Header.Set("Authorization", "Bearer forged")
	response := httptest.NewRecorder()
	adapter.authorize(response, request)

	var got opaResponse
	if err := json.NewDecoder(response.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Result.Allow || got.Result.StatusCode != http.StatusUnauthorized || got.Result.Reason != "invalid_token" {
		t.Fatalf("unexpected invalid-token response: %#v", got)
	}
}

func TestAdapterFailsClosedWhenOPAUnavailable(t *testing.T) {
	validator := &fakeValidator{claims: &integration.JWTClaims{Issuer: "issuer", Subject: "sub", ExpiresAt: 2_000_000_000}}
	adapter := &adapter{validator: validator, opaDecisionURL: "http://127.0.0.1:1", httpClient: http.DefaultClient, maxRequestBytes: defaultMaxRequestBytes}
	request := httptest.NewRequest(http.MethodPost, "/v1/data/payment/authorization", strings.NewReader(`{"input":{"request":{"method":"POST","path":"/api/v1/payments/process"}}}`))
	request.Header.Set("Authorization", "Bearer token")
	response := httptest.NewRecorder()
	adapter.authorize(response, request)

	var got opaResponse
	if err := json.NewDecoder(response.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Result.Allow || got.Result.StatusCode != http.StatusServiceUnavailable || got.Result.Reason != "policy_unavailable" {
		t.Fatalf("unexpected unavailable-policy response: %#v", got)
	}
}

func TestBearerTokenRejectsMalformedHeaders(t *testing.T) {
	for _, value := range []string{"", "Basic abc", "Bearer", "Bearer a b"} {
		if _, err := bearerToken(value); err == nil {
			t.Fatalf("bearerToken(%q) unexpectedly succeeded", value)
		}
	}
}
