package interceptors

import (
	"context"
	"fmt"
	"strings"

	"github.com/payment-switch/go-services/internal/integration"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// LedgerAuthConfig defines the minimum role required by each ledger RPC family.
type ClaimsValidator interface {
	ValidateToken(context.Context, string) (*integration.JWTClaims, error)
}

type LedgerAuthConfig struct {
	Validator ClaimsValidator
	Roles     map[string]string
}

func LedgerUnaryAuthInterceptor(config LedgerAuthConfig) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
		token, err := incomingBearer(ctx)
		if err != nil {
			return nil, status.Error(codes.Unauthenticated, err.Error())
		}
		if config.Validator == nil {
			return nil, status.Error(codes.Internal, "ledger authentication is not configured")
		}
		claims, err := config.Validator.ValidateToken(ctx, token)
		if err != nil || claims == nil || claims.Subject == "" {
			return nil, status.Error(codes.Unauthenticated, "invalid bearer token")
		}
		required := requiredRole(info.FullMethod, config.Roles)
		if required != "" && !hasRole(claims, required) {
			return nil, status.Errorf(codes.PermissionDenied, "missing required role %q", required)
		}
		return handler(ctx, req)
	}
}

func incomingBearer(ctx context.Context) (string, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok { return "", fmt.Errorf("authorization metadata is required") }
	values := md.Get("authorization")
	if len(values) != 1 { return "", fmt.Errorf("exactly one authorization header is required") }
	parts := strings.Fields(values[0])
	if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") || parts[1] == "" { return "", fmt.Errorf("malformed bearer token") }
	return parts[1], nil
}

func requiredRole(method string, roles map[string]string) string {
	if role, ok := roles[method]; ok { return role }
	if strings.Contains(method, "CreateTransfer") || strings.Contains(method, "CreateAccount") || strings.Contains(method, "SyncBalance") { return "ledger:write" }
	if strings.Contains(method, "Lookup") || strings.Contains(method, "Balance") { return "ledger:read" }
	return "ledger:operator"
}

func hasRole(claims *integration.JWTClaims, required string) bool {
	if claims.RealmAccess != nil { for _, role := range claims.RealmAccess.Roles { if role == required { return true } } }
	for _, access := range claims.ResourceAccess { if access != nil { for _, role := range access.Roles { if role == required { return true } } } }
	for _, role := range claims.Permissions { if role == required { return true } }
	return false
}
