package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/payment-switch/go-services/internal/integration"
)

func TestLegacyLedgerEndpointDisabled(t *testing.T) {
	recorder := httptest.NewRecorder()
	legacyLedgerEndpointDisabled(recorder, httptest.NewRequest(http.MethodPost, "/api/v1/transfers/execute", nil))
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected legacy endpoint to be unavailable, got %d", recorder.Code)
	}
}

func TestRequireLedgerRolesRejectsMissingClaims(t *testing.T) {
	called := false
	handler := requireLedgerRoles(func(http.ResponseWriter, *http.Request) { called = true }, "operator")
	recorder := httptest.NewRecorder()
	handler(recorder, httptest.NewRequest(http.MethodPost, "/api/v1/mojaloop/transfers/prepare", nil))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected missing claims to be rejected, got %d", recorder.Code)
	}
	if called {
		t.Fatal("protected handler must not run without claims")
	}
}

func TestRequireLedgerRolesAllowsOperator(t *testing.T) {
	called := false
	handler := requireLedgerRoles(func(http.ResponseWriter, *http.Request) { called = true }, "operator")
	request := httptest.NewRequest(http.MethodPost, "/api/v1/mojaloop/transfers/prepare", nil)
	claims := &integration.JWTClaims{RealmAccess: &integration.AccessClaim{Roles: []string{"operator"}}}
	request = request.WithContext(context.WithValue(request.Context(), "jwt_claims", claims))
	recorder := httptest.NewRecorder()
	handler(recorder, request)
	if !called {
		t.Fatal("operator role should reach protected handler")
	}
}

func TestBodyLimitMiddlewareRejectsOversizedPayload(t *testing.T) {
	handler := bodyLimitMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf := make([]byte, maxLedgerRequestBodyBytes+1)
		_, err := r.Body.Read(buf)
		if err == nil {
			t.Fatal("expected body limit read to fail")
		}
		w.WriteHeader(http.StatusRequestEntityTooLarge)
	}))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/v1/mojaloop/transfers/prepare", strings.NewReader(strings.Repeat("a", int(maxLedgerRequestBodyBytes+1)))))
	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413 after oversized body, got %d", recorder.Code)
	}
}
