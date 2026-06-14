// Package onboarding provides authentication and authorization middleware
package onboarding

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// AuthConfig holds authentication configuration
type AuthConfig struct {
	KeycloakURL string
	Realm       string
	ClientID    string
	RequireAuth bool
	CacheTTL    time.Duration
}

// DefaultAuthConfig returns default auth configuration
func DefaultAuthConfig() *AuthConfig {
	return &AuthConfig{
		KeycloakURL: getEnv("KEYCLOAK_URL", "http://keycloak.payment-switch.svc.cluster.local:8080"),
		Realm:       getEnv("KEYCLOAK_REALM", "payment-switch"),
		ClientID:    getEnv("KEYCLOAK_CLIENT_ID", "onboarding-service"),
		RequireAuth: getEnv("REQUIRE_AUTH", "true") == "true",
		CacheTTL:    time.Hour,
	}
}

// OnboardingRole defines roles for onboarding operations
type OnboardingRole string

const (
	RoleApplicant    OnboardingRole = "onboarding-applicant"
	RoleReviewer     OnboardingRole = "onboarding-reviewer"
	RoleTechReviewer OnboardingRole = "onboarding-tech-reviewer"
	RoleGovernance   OnboardingRole = "onboarding-governance"
	RoleAdmin        OnboardingRole = "onboarding-admin"
)

// UserContext holds authenticated user information
type UserContext struct {
	UserID   string
	Username string
	Email    string
	Roles    []OnboardingRole
	Claims   map[string]interface{}
	TokenExp time.Time
}

// HasRole checks if user has a specific role
func (u *UserContext) HasRole(role OnboardingRole) bool {
	for _, r := range u.Roles {
		if r == role {
			return true
		}
	}
	return false
}

// HasAnyRole checks if user has any of the specified roles
func (u *UserContext) HasAnyRole(roles ...OnboardingRole) bool {
	for _, role := range roles {
		if u.HasRole(role) {
			return true
		}
	}
	return false
}

// contextKey is a custom type for context keys
type contextKey string

const userContextKey contextKey = "user"

// GetUserFromContext retrieves user context from request context
func GetUserFromContext(ctx context.Context) (*UserContext, bool) {
	user, ok := ctx.Value(userContextKey).(*UserContext)
	return user, ok
}

// AuthMiddleware provides JWT authentication middleware
type AuthMiddleware struct {
	config     *AuthConfig
	publicKeys map[string]*rsa.PublicKey
	keysMutex  sync.RWMutex
	keysExpiry time.Time
}

// NewAuthMiddleware creates a new auth middleware
func NewAuthMiddleware(config *AuthConfig) *AuthMiddleware {
	if config == nil {
		config = DefaultAuthConfig()
	}
	return &AuthMiddleware{
		config:     config,
		publicKeys: make(map[string]*rsa.PublicKey),
	}
}

// Middleware returns the HTTP middleware handler
func (m *AuthMiddleware) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip auth for health checks
		if r.URL.Path == "/health" || r.URL.Path == "/ready" {
			next.ServeHTTP(w, r)
			return
		}

		// Skip auth if not required (dev mode with limited permissions)
		if !m.config.RequireAuth {
			devUser := &UserContext{
				UserID:   "dev-user",
				Username: "developer",
				Email:    "dev@payment-switch.local",
				Roles:    []OnboardingRole{RoleReviewer},
			}
			ctx := context.WithValue(r.Context(), userContextKey, devUser)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		// Extract token from Authorization header
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			http.Error(w, `{"error": "missing authorization header"}`, http.StatusUnauthorized)
			return
		}

		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
			http.Error(w, `{"error": "invalid authorization header format"}`, http.StatusUnauthorized)
			return
		}

		tokenString := parts[1]

		// Validate token
		user, err := m.validateToken(tokenString)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error": "invalid token: %s"}`, err.Error()), http.StatusUnauthorized)
			return
		}

		// Add user to context
		ctx := context.WithValue(r.Context(), userContextKey, user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// validateToken validates a JWT token and extracts user information
func (m *AuthMiddleware) validateToken(tokenString string) (*UserContext, error) {
	// Parse token without validation first to get the key ID
	token, _, err := jwt.NewParser().ParseUnverified(tokenString, jwt.MapClaims{})
	if err != nil {
		return nil, fmt.Errorf("failed to parse token: %w", err)
	}

	// Get key ID from header
	kid, ok := token.Header["kid"].(string)
	if !ok {
		return nil, fmt.Errorf("missing key ID in token header")
	}

	// Get public key
	publicKey, err := m.getPublicKey(kid)
	if err != nil {
		return nil, fmt.Errorf("failed to get public key: %w", err)
	}

	// Parse and validate token
	token, err = jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return publicKey, nil
	})

	if err != nil {
		return nil, fmt.Errorf("token validation failed: %w", err)
	}

	if !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, fmt.Errorf("invalid claims format")
	}

	// Extract user information
	user := &UserContext{
		Claims: claims,
	}

	if sub, ok := claims["sub"].(string); ok {
		user.UserID = sub
	}
	if username, ok := claims["preferred_username"].(string); ok {
		user.Username = username
	}
	if email, ok := claims["email"].(string); ok {
		user.Email = email
	}
	if exp, ok := claims["exp"].(float64); ok {
		user.TokenExp = time.Unix(int64(exp), 0)
	}

	// Extract roles from realm_access and resource_access
	user.Roles = m.extractRoles(claims)

	return user, nil
}

// extractRoles extracts onboarding roles from JWT claims
func (m *AuthMiddleware) extractRoles(claims jwt.MapClaims) []OnboardingRole {
	var roles []OnboardingRole
	roleSet := make(map[string]bool)

	// Extract from realm_access
	if realmAccess, ok := claims["realm_access"].(map[string]interface{}); ok {
		if realmRoles, ok := realmAccess["roles"].([]interface{}); ok {
			for _, r := range realmRoles {
				if role, ok := r.(string); ok {
					roleSet[role] = true
				}
			}
		}
	}

	// Extract from resource_access for this client
	if resourceAccess, ok := claims["resource_access"].(map[string]interface{}); ok {
		if clientAccess, ok := resourceAccess[m.config.ClientID].(map[string]interface{}); ok {
			if clientRoles, ok := clientAccess["roles"].([]interface{}); ok {
				for _, r := range clientRoles {
					if role, ok := r.(string); ok {
						roleSet[role] = true
					}
				}
			}
		}
	}

	// Map to OnboardingRole
	for role := range roleSet {
		switch role {
		case string(RoleApplicant):
			roles = append(roles, RoleApplicant)
		case string(RoleReviewer):
			roles = append(roles, RoleReviewer)
		case string(RoleTechReviewer):
			roles = append(roles, RoleTechReviewer)
		case string(RoleGovernance):
			roles = append(roles, RoleGovernance)
		case string(RoleAdmin):
			roles = append(roles, RoleAdmin)
		}
	}

	return roles
}

// getPublicKey retrieves the public key for a given key ID
func (m *AuthMiddleware) getPublicKey(kid string) (*rsa.PublicKey, error) {
	m.keysMutex.RLock()
	if key, ok := m.publicKeys[kid]; ok && time.Now().Before(m.keysExpiry) {
		m.keysMutex.RUnlock()
		return key, nil
	}
	m.keysMutex.RUnlock()

	// Fetch JWKS from Keycloak
	if err := m.refreshKeys(); err != nil {
		return nil, err
	}

	m.keysMutex.RLock()
	defer m.keysMutex.RUnlock()

	key, ok := m.publicKeys[kid]
	if !ok {
		return nil, fmt.Errorf("key not found: %s", kid)
	}

	return key, nil
}

// refreshKeys fetches public keys from Keycloak JWKS endpoint
func (m *AuthMiddleware) refreshKeys() error {
	m.keysMutex.Lock()
	defer m.keysMutex.Unlock()

	jwksURL := fmt.Sprintf("%s/realms/%s/protocol/openid-connect/certs", m.config.KeycloakURL, m.config.Realm)

	resp, err := http.Get(jwksURL)
	if err != nil {
		return fmt.Errorf("failed to fetch JWKS: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("JWKS endpoint returned status %d", resp.StatusCode)
	}

	var jwks struct {
		Keys []struct {
			Kid string `json:"kid"`
			Kty string `json:"kty"`
			Alg string `json:"alg"`
			Use string `json:"use"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return fmt.Errorf("failed to decode JWKS: %w", err)
	}

	m.publicKeys = make(map[string]*rsa.PublicKey)

	for _, key := range jwks.Keys {
		if key.Kty != "RSA" || key.Use != "sig" {
			continue
		}

		// Decode modulus
		nBytes, err := base64.RawURLEncoding.DecodeString(key.N)
		if err != nil {
			continue
		}
		n := new(big.Int).SetBytes(nBytes)

		// Decode exponent
		eBytes, err := base64.RawURLEncoding.DecodeString(key.E)
		if err != nil {
			continue
		}
		var e int
		for _, b := range eBytes {
			e = e<<8 + int(b)
		}

		m.publicKeys[key.Kid] = &rsa.PublicKey{N: n, E: e}
	}

	m.keysExpiry = time.Now().Add(m.config.CacheTTL)

	return nil
}

// RequireRole returns middleware that requires specific roles
func RequireRole(roles ...OnboardingRole) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, ok := GetUserFromContext(r.Context())
			if !ok {
				http.Error(w, `{"error": "unauthorized"}`, http.StatusUnauthorized)
				return
			}

			// Admin role bypasses all checks
			if user.HasRole(RoleAdmin) {
				next.ServeHTTP(w, r)
				return
			}

			if !user.HasAnyRole(roles...) {
				http.Error(w, `{"error": "forbidden: insufficient permissions"}`, http.StatusForbidden)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// MultiPartyApproval enforces two-person rule for critical operations
type MultiPartyApproval struct {
	store ApprovalStore
}

// ApprovalStore interface for storing approval records
type ApprovalStore interface {
	GetApprovals(ctx context.Context, caseID string, action string) ([]ApprovalRecord, error)
	AddApproval(ctx context.Context, record ApprovalRecord) error
}

// ApprovalRecord represents an approval action
type ApprovalRecord struct {
	ID        string    `json:"id"`
	CaseID    string    `json:"case_id"`
	Action    string    `json:"action"`
	UserID    string    `json:"user_id"`
	Username  string    `json:"username"`
	Role      string    `json:"role"`
	Approved  bool      `json:"approved"`
	Reason    string    `json:"reason"`
	Timestamp time.Time `json:"timestamp"`
}

// NewMultiPartyApproval creates a new multi-party approval enforcer
func NewMultiPartyApproval(store ApprovalStore) *MultiPartyApproval {
	return &MultiPartyApproval{store: store}
}

// RequiredApprovers defines how many approvers are needed for each action
var RequiredApprovers = map[string]int{
	"governance_approval":     2,
	"production_provisioning": 2,
	"activate_participant":    2,
	"suspend_participant":     1,
	"reject_application":      1,
}

// CheckApproval verifies if an action has sufficient approvals
func (m *MultiPartyApproval) CheckApproval(ctx context.Context, caseID string, action string, currentUser *UserContext) (bool, error) {
	required, ok := RequiredApprovers[action]
	if !ok {
		required = 1
	}

	approvals, err := m.store.GetApprovals(ctx, caseID, action)
	if err != nil {
		return false, err
	}

	// Count unique approvers (excluding current user for separation of duties)
	uniqueApprovers := make(map[string]bool)
	for _, approval := range approvals {
		if approval.Approved && approval.UserID != currentUser.UserID {
			uniqueApprovers[approval.UserID] = true
		}
	}

	// Current user's approval counts as well
	return len(uniqueApprovers)+1 >= required, nil
}

// SeparationOfDuties enforces that certain actions cannot be performed by the same user
type SeparationOfDuties struct {
	store AuditStore
}

// AuditStore interface for retrieving audit records
type AuditStore interface {
	GetCaseActions(ctx context.Context, caseID string) ([]AuditEntry, error)
}

// NewSeparationOfDuties creates a new separation of duties enforcer
func NewSeparationOfDuties(store AuditStore) *SeparationOfDuties {
	return &SeparationOfDuties{store: store}
}

// ConflictingActions defines actions that cannot be performed by the same user
var ConflictingActions = map[string][]string{
	"submit_application":      {"approve_due_diligence", "governance_approval"},
	"approve_due_diligence":   {"submit_application", "governance_approval"},
	"governance_approval":     {"submit_application", "approve_due_diligence"},
	"production_provisioning": {"submit_application"},
}

// CheckSeparation verifies that the current user hasn't performed conflicting actions
func (s *SeparationOfDuties) CheckSeparation(ctx context.Context, caseID string, action string, currentUser *UserContext) (bool, string, error) {
	conflicts, ok := ConflictingActions[action]
	if !ok {
		return true, "", nil
	}

	actions, err := s.store.GetCaseActions(ctx, caseID)
	if err != nil {
		return false, "", err
	}

	for _, entry := range actions {
		if entry.UserID == currentUser.UserID {
			for _, conflict := range conflicts {
				if entry.Action == conflict {
					return false, fmt.Sprintf("separation of duties violation: user already performed '%s'", conflict), nil
				}
			}
		}
	}

	return true, "", nil
}

// AuditEntry represents an audit log entry
type AuditEntry struct {
	ID        string                 `json:"id"`
	CaseID    string                 `json:"case_id"`
	Action    string                 `json:"action"`
	UserID    string                 `json:"user_id"`
	Username  string                 `json:"username"`
	Role      string                 `json:"role"`
	Details   map[string]interface{} `json:"details"`
	IPAddress string                 `json:"ip_address"`
	UserAgent string                 `json:"user_agent"`
	Timestamp time.Time              `json:"timestamp"`
}
