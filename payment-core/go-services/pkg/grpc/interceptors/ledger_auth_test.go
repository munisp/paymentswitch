package interceptors

import (
	"context"
	"errors"
	"testing"

	"github.com/payment-switch/go-services/internal/integration"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

type fakeClaimsValidator struct {
	claims *integration.JWTClaims
	err    error
	token  string
}

func (f *fakeClaimsValidator) ValidateToken(_ context.Context, token string) (*integration.JWTClaims, error) {
	f.token = token
	return f.claims, f.err
}

func invokeAuth(t *testing.T, validator ClaimsValidator, method string, md metadata.MD, handler grpc.UnaryHandler) error {
	t.Helper()
	interceptor := LedgerUnaryAuthInterceptor(LedgerAuthConfig{Validator: validator})
	_, err := interceptor(metadata.NewIncomingContext(context.Background(), md), struct{}{}, &grpc.UnaryServerInfo{FullMethod: method}, handler)
	return err
}

func TestLedgerAuthRejectsMissingAuthorization(t *testing.T) {
	err := invokeAuth(t, &fakeClaimsValidator{}, "/ledger.Ledger/CreateTransfer", nil, func(context.Context, interface{}) (interface{}, error) { t.Fatal("handler called"); return nil, nil })
	if status.Code(err) != codes.Unauthenticated { t.Fatalf("code = %v, want Unauthenticated", status.Code(err)) }
}

func TestLedgerAuthRejectsInvalidToken(t *testing.T) {
	validator := &fakeClaimsValidator{err: errors.New("signature invalid")}
	err := invokeAuth(t, validator, "/ledger.Ledger/CreateTransfer", metadata.Pairs("authorization", "Bearer bad"), func(context.Context, interface{}) (interface{}, error) { t.Fatal("handler called"); return nil, nil })
	if status.Code(err) != codes.Unauthenticated { t.Fatalf("code = %v, want Unauthenticated", status.Code(err)) }
	if validator.token != "bad" { t.Fatalf("token = %q, want bad", validator.token) }
}

func TestLedgerAuthEnforcesMethodRoleAndAllowsPermission(t *testing.T) {
	validator := &fakeClaimsValidator{claims: &integration.JWTClaims{Subject: "u", RealmAccess: &integration.AccessClaim{Roles: []string{"ledger:read"}}}}
	called := false
	result, err := LedgerUnaryAuthInterceptor(LedgerAuthConfig{Validator: validator})(metadata.NewIncomingContext(context.Background(), metadata.Pairs("authorization", "Bearer valid")), struct{}{}, &grpc.UnaryServerInfo{FullMethod: "/ledger.Ledger/LookupAccounts"}, func(context.Context, interface{}) (interface{}, error) { called = true; return "ok", nil })
	if err != nil || result != "ok" || !called { t.Fatalf("authorized request result=%v err=%v called=%v", result, err, called) }
}

func TestLedgerAuthRejectsInsufficientRole(t *testing.T) {
	validator := &fakeClaimsValidator{claims: &integration.JWTClaims{Subject: "u", ResourceAccess: map[string]*integration.AccessClaim{"payment-api": {Roles: []string{"ledger:read"}}}}}
	err := invokeAuth(t, validator, "/ledger.Ledger/CreateTransfer", metadata.Pairs("authorization", "Bearer valid"), func(context.Context, interface{}) (interface{}, error) { t.Fatal("handler called"); return nil, nil })
	if status.Code(err) != codes.PermissionDenied { t.Fatalf("code = %v, want PermissionDenied", status.Code(err)) }
}

func TestLedgerAuthAcceptsPermissionClaim(t *testing.T) {
	validator := &fakeClaimsValidator{claims: &integration.JWTClaims{Subject: "u", Permissions: []string{"ledger:write"}}}
	err := invokeAuth(t, validator, "/ledger.Ledger/CreateTransfer", metadata.Pairs("authorization", "Bearer valid"), func(context.Context, interface{}) (interface{}, error) { return nil, nil })
	if err != nil { t.Fatalf("permission claim rejected: %v", err) }
}
