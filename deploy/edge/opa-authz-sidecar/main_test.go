package main

import (
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func encodedClaims(t *testing.T, tenant string, acr any) string {
	t.Helper()
	value := map[string]any{
		"sub":       "subject-a",
		"tenant_id": tenant,
		"acr":       acr,
		"realm_access": map[string]any{
			"roles": []string{"admin"},
		},
	}
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(data)
}

func TestDecodeUserInfo(t *testing.T) {
	claims, err := decodeUserInfo(encodedClaims(t, "tenant-a", "2"))
	if err != nil {
		t.Fatal(err)
	}
	if claims.Subject != "subject-a" || claims.TenantID != "tenant-a" {
		t.Fatalf("unexpected claims: %#v", claims)
	}
	if !mfaVerified(claims) {
		t.Fatal("expected verified MFA")
	}
}

func TestRouteDecision(t *testing.T) {
	tests := []struct {
		method string
		path   string
		key    string
		action string
	}{
		{http.MethodGet, "/api/v1/payments/pay-a", "", "read"},
		{http.MethodPost, "/api/v1/payments", "idem-a", "write"},
		{http.MethodPost, "/api/v1/admin/payments/pay-a/approve", "", "approve_payment"},
	}
	for _, test := range tests {
		action, resource, id, _, err := routeDecision(test.method, test.path, "tenant-a", test.key)
		if err != nil {
			t.Fatalf("%s %s: %v", test.method, test.path, err)
		}
		if action != test.action || resource != "payment" || id == "" {
			t.Fatalf("unexpected decision: %s %s %s", action, resource, id)
		}
	}
	if _, _, _, _, err := routeDecision(http.MethodPost, "/api/v1/payments", "tenant-a", "invalid key"); err == nil {
		t.Fatal("expected invalid idempotency key to fail")
	}
}

func TestAuthorizeAllowsAndPropagatesDecision(t *testing.T) {
	opa := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/data/paymentswitch/authz/allow" {
			t.Fatalf("unexpected OPA path: %s", request.URL.Path)
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"result":true}`))
	}))
	defer opa.Close()
	service := &server{
		opaURL: opa.URL,
		client: &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}, // test server only
	}
	request := httptest.NewRequest(http.MethodGet, "/authorize", nil)
	request.Header.Set("X-Userinfo", encodedClaims(t, "tenant-a", "2"))
	request.Header.Set("X-Tenant-ID", "tenant-a")
	request.Header.Set("X-Forwarded-Method", http.MethodGet)
	request.Header.Set("X-Forwarded-Uri", "/api/v1/payments/pay-a")
	request.Header.Set("X-Request-ID", "request-1234")
	response := httptest.NewRecorder()
	service.authorize(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if response.Header().Get("X-Authorization-Decision-ID") != "authz:request-1234" {
		t.Fatalf("missing decision correlation: %s", response.Header().Get("X-Authorization-Decision-ID"))
	}
}

func TestAuthorizeDeniesTenantMismatch(t *testing.T) {
	service := &server{opaURL: "https://127.0.0.1:1", client: http.DefaultClient}
	request := httptest.NewRequest(http.MethodGet, "/authorize", nil)
	request.Header.Set("X-Userinfo", encodedClaims(t, "tenant-a", "2"))
	request.Header.Set("X-Tenant-ID", "tenant-b")
	request.Header.Set("X-Forwarded-Method", http.MethodGet)
	request.Header.Set("X-Forwarded-Uri", "/api/v1/payments/pay-a")
	response := httptest.NewRecorder()
	service.authorize(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", response.Code)
	}
}

func TestAuthorizeFailsClosedWhenOPAUnavailable(t *testing.T) {
	service := &server{opaURL: "https://127.0.0.1:1", client: http.DefaultClient}
	request := httptest.NewRequest(http.MethodGet, "/authorize", nil)
	request.Header.Set("X-Userinfo", encodedClaims(t, "tenant-a", "2"))
	request.Header.Set("X-Tenant-ID", "tenant-a")
	request.Header.Set("X-Forwarded-Method", http.MethodGet)
	request.Header.Set("X-Forwarded-Uri", "/api/v1/payments/pay-a")
	response := httptest.NewRecorder()
	service.authorize(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", response.Code)
	}
}
