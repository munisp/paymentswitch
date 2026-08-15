// Package integration provides infrastructure integration components
package integration

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

// KeycloakJWTValidator validates JWTs issued by Keycloak
type KeycloakJWTValidator struct {
	config     *KeycloakConfig
	httpClient *http.Client
	jwks       *JWKS
	jwksMu     sync.RWMutex
	lastFetch  time.Time
	metrics    *JWTMetrics
}

// KeycloakConfig holds Keycloak configuration
type KeycloakConfig struct {
	BaseURL             string        `json:"base_url"`
	Realm               string        `json:"realm"`
	ClientID            string        `json:"client_id"`
	JWKSRefreshInterval time.Duration `json:"jwks_refresh_interval"`
	RequiredAudience    string        `json:"required_audience"`
	RequiredIssuer      string        `json:"required_issuer"`
	ClockSkew           time.Duration `json:"clock_skew"`
}

// DefaultKeycloakConfig returns default configuration
func DefaultKeycloakConfig() *KeycloakConfig {
	return &KeycloakConfig{
		BaseURL:             "http://keycloak.payment-switch.svc.cluster.local:8080",
		Realm:               "payment-switch",
		ClientID:            "payment-api",
		JWKSRefreshInterval: 5 * time.Minute,
		RequiredAudience:    "payment-api",
		RequiredIssuer:      "http://keycloak.payment-switch.svc.cluster.local:8080/realms/payment-switch",
		ClockSkew:           30 * time.Second,
	}
}

// JWKS represents a JSON Web Key Set
type JWKS struct {
	Keys []JWK `json:"keys"`
}

// JWK represents a JSON Web Key
type JWK struct {
	Kid string `json:"kid"`
	Kty string `json:"kty"`
	Alg string `json:"alg"`
	Use string `json:"use"`
	N   string `json:"n"`
	E   string `json:"e"`
}

// JWTClaims represents the claims in a JWT
type JWTClaims struct {
	Issuer    string      `json:"iss"`
	Subject   string      `json:"sub"`
	Audience  interface{} `json:"aud"`
	ExpiresAt int64       `json:"exp"`
	IssuedAt  int64       `json:"iat"`
	NotBefore int64       `json:"nbf,omitempty"`
	JTI       string      `json:"jti,omitempty"`

	// Keycloak-specific claims
	PreferredUsername string `json:"preferred_username,omitempty"`
	Email             string `json:"email,omitempty"`
	EmailVerified     bool   `json:"email_verified,omitempty"`
	Name              string `json:"name,omitempty"`
	GivenName         string `json:"given_name,omitempty"`
	FamilyName        string `json:"family_name,omitempty"`

	// Realm and resource access
	RealmAccess    *AccessClaim            `json:"realm_access,omitempty"`
	ResourceAccess map[string]*AccessClaim `json:"resource_access,omitempty"`

	// Custom claims
	OrganizationID string   `json:"organization_id,omitempty"`
	ParticipantID  string   `json:"participant_id,omitempty"`
	Permissions    []string `json:"permissions,omitempty"`

	// Raw claims for extension
	Raw map[string]interface{} `json:"-"`
}

// AccessClaim represents realm or resource access claims
type AccessClaim struct {
	Roles []string `json:"roles"`
}

// JWTMetrics tracks JWT validation metrics
type JWTMetrics struct {
	ValidationsTotal   int64   `json:"validations_total"`
	ValidationsSuccess int64   `json:"validations_success"`
	ValidationsFailed  int64   `json:"validations_failed"`
	JWKSRefreshes      int64   `json:"jwks_refreshes"`
	JWKSRefreshErrors  int64   `json:"jwks_refresh_errors"`
	AvgLatencyMs       float64 `json:"avg_latency_ms"`
	mu                 sync.RWMutex
}

// NewKeycloakJWTValidator creates a new JWT validator
func NewKeycloakJWTValidator(config *KeycloakConfig) (*KeycloakJWTValidator, error) {
	if config == nil {
		config = DefaultKeycloakConfig()
	}

	validator := &KeycloakJWTValidator{
		config: config,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		metrics: &JWTMetrics{},
	}

	// Initial JWKS fetch
	if err := validator.refreshJWKS(context.Background()); err != nil {
		return nil, fmt.Errorf("failed to fetch initial JWKS: %w", err)
	}

	// Start background refresh
	go validator.backgroundRefresh()

	return validator, nil
}

// ValidateToken validates a JWT token and returns the claims
func (v *KeycloakJWTValidator) ValidateToken(ctx context.Context, tokenString string) (*JWTClaims, error) {
	startTime := time.Now()

	v.metrics.mu.Lock()
	v.metrics.ValidationsTotal++
	v.metrics.mu.Unlock()

	// Parse token parts
	parts := strings.Split(tokenString, ".")
	if len(parts) != 3 {
		v.recordFailure()
		return nil, fmt.Errorf("invalid token format")
	}

	// Decode header
	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		v.recordFailure()
		return nil, fmt.Errorf("failed to decode header: %w", err)
	}

	var header struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
		Typ string `json:"typ"`
	}
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		v.recordFailure()
		return nil, fmt.Errorf("failed to parse header: %w", err)
	}

	// Validate algorithm
	if header.Alg != "RS256" {
		v.recordFailure()
		return nil, fmt.Errorf("unsupported algorithm: %s", header.Alg)
	}

	// Get public key
	publicKey, err := v.getPublicKey(header.Kid)
	if err != nil {
		v.recordFailure()
		return nil, fmt.Errorf("failed to get public key: %w", err)
	}

	// Verify signature
	if err := v.verifySignature(parts[0]+"."+parts[1], parts[2], publicKey); err != nil {
		v.recordFailure()
		return nil, fmt.Errorf("signature verification failed: %w", err)
	}

	// Decode claims
	claimsBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		v.recordFailure()
		return nil, fmt.Errorf("failed to decode claims: %w", err)
	}

	var claims JWTClaims
	if err := json.Unmarshal(claimsBytes, &claims); err != nil {
		v.recordFailure()
		return nil, fmt.Errorf("failed to parse claims: %w", err)
	}

	// Store raw claims
	var rawClaims map[string]interface{}
	json.Unmarshal(claimsBytes, &rawClaims)
	claims.Raw = rawClaims

	// Validate claims
	if err := v.validateClaims(&claims); err != nil {
		v.recordFailure()
		return nil, err
	}

	// Record success
	latency := time.Since(startTime).Milliseconds()
	v.metrics.mu.Lock()
	v.metrics.ValidationsSuccess++
	v.metrics.AvgLatencyMs = v.metrics.AvgLatencyMs*0.9 + float64(latency)*0.1
	v.metrics.mu.Unlock()

	return &claims, nil
}

// validateClaims validates the JWT claims
func (v *KeycloakJWTValidator) validateClaims(claims *JWTClaims) error {
	now := time.Now()

	// Check expiration
	if claims.ExpiresAt > 0 {
		expTime := time.Unix(claims.ExpiresAt, 0)
		if now.After(expTime.Add(v.config.ClockSkew)) {
			return fmt.Errorf("token expired")
		}
	}

	// Check not before
	if claims.NotBefore > 0 {
		nbfTime := time.Unix(claims.NotBefore, 0)
		if now.Before(nbfTime.Add(-v.config.ClockSkew)) {
			return fmt.Errorf("token not yet valid")
		}
	}

	// Check issued at
	if claims.IssuedAt > 0 {
		iatTime := time.Unix(claims.IssuedAt, 0)
		if now.Before(iatTime.Add(-v.config.ClockSkew)) {
			return fmt.Errorf("token issued in the future")
		}
	}

	// Check issuer
	if v.config.RequiredIssuer != "" && claims.Issuer != v.config.RequiredIssuer {
		return fmt.Errorf("invalid issuer: expected %s, got %s", v.config.RequiredIssuer, claims.Issuer)
	}

	// Check audience
	if v.config.RequiredAudience != "" {
		if !v.audienceContains(claims.Audience, v.config.RequiredAudience) {
			return fmt.Errorf("invalid audience")
		}
	}

	return nil
}

// audienceContains checks if the audience contains the required value
func (v *KeycloakJWTValidator) audienceContains(aud interface{}, required string) bool {
	switch a := aud.(type) {
	case string:
		return a == required
	case []interface{}:
		for _, v := range a {
			if s, ok := v.(string); ok && s == required {
				return true
			}
		}
	case []string:
		for _, s := range a {
			if s == required {
				return true
			}
		}
	}
	return false
}

// getPublicKey retrieves the public key for the given key ID
func (v *KeycloakJWTValidator) getPublicKey(kid string) (*rsa.PublicKey, error) {
	v.jwksMu.RLock()
	defer v.jwksMu.RUnlock()

	if v.jwks == nil {
		return nil, fmt.Errorf("JWKS not loaded")
	}

	for _, key := range v.jwks.Keys {
		if key.Kid == kid {
			return v.parseRSAPublicKey(&key)
		}
	}

	return nil, fmt.Errorf("key not found: %s", kid)
}

// parseRSAPublicKey parses a JWK into an RSA public key
func (v *KeycloakJWTValidator) parseRSAPublicKey(jwk *JWK) (*rsa.PublicKey, error) {
	if jwk.Kty != "RSA" {
		return nil, fmt.Errorf("unsupported key type: %s", jwk.Kty)
	}

	// Decode modulus
	nBytes, err := base64.RawURLEncoding.DecodeString(jwk.N)
	if err != nil {
		return nil, fmt.Errorf("failed to decode modulus: %w", err)
	}
	n := new(big.Int).SetBytes(nBytes)

	// Decode exponent
	eBytes, err := base64.RawURLEncoding.DecodeString(jwk.E)
	if err != nil {
		return nil, fmt.Errorf("failed to decode exponent: %w", err)
	}
	var e int
	for _, b := range eBytes {
		e = e<<8 + int(b)
	}

	return &rsa.PublicKey{N: n, E: e}, nil
}

// verifySignature verifies the JWT signature
func (v *KeycloakJWTValidator) verifySignature(message, signature string, publicKey *rsa.PublicKey) error {
	// Decode signature
	sigBytes, err := base64.RawURLEncoding.DecodeString(signature)
	if err != nil {
		return fmt.Errorf("failed to decode signature: %w", err)
	}

			digest := sha256.Sum256([]byte(message))
		if err := rsa.VerifyPKCS1v15(publicKey, crypto.SHA256, digest[:], sigBytes); err != nil {
			return fmt.Errorf("invalid JWT signature: %w", err)
		}

		return nil

}

// refreshJWKS fetches the JWKS from Keycloak
func (v *KeycloakJWTValidator) refreshJWKS(ctx context.Context) error {
	url := fmt.Sprintf("%s/realms/%s/protocol/openid-connect/certs",
		v.config.BaseURL, v.config.Realm)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := v.httpClient.Do(req)
	if err != nil {
		v.metrics.mu.Lock()
		v.metrics.JWKSRefreshErrors++
		v.metrics.mu.Unlock()
		return fmt.Errorf("failed to fetch JWKS: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		v.metrics.mu.Lock()
		v.metrics.JWKSRefreshErrors++
		v.metrics.mu.Unlock()
		return fmt.Errorf("JWKS endpoint returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response: %w", err)
	}

	var jwks JWKS
	if err := json.Unmarshal(body, &jwks); err != nil {
		return fmt.Errorf("failed to parse JWKS: %w", err)
	}

	v.jwksMu.Lock()
	v.jwks = &jwks
	v.lastFetch = time.Now()
	v.jwksMu.Unlock()

	v.metrics.mu.Lock()
	v.metrics.JWKSRefreshes++
	v.metrics.mu.Unlock()

	return nil
}

// backgroundRefresh periodically refreshes the JWKS
func (v *KeycloakJWTValidator) backgroundRefresh() {
	ticker := time.NewTicker(v.config.JWKSRefreshInterval)
	defer ticker.Stop()

	for range ticker.C {
		if err := v.refreshJWKS(context.Background()); err != nil {
			// Log error but continue
			fmt.Printf("Failed to refresh JWKS: %v\n", err)
		}
	}
}

// recordFailure records a validation failure
func (v *KeycloakJWTValidator) recordFailure() {
	v.metrics.mu.Lock()
	v.metrics.ValidationsFailed++
	v.metrics.mu.Unlock()
}

// GetMetrics returns current JWT validation metrics
func (v *KeycloakJWTValidator) GetMetrics() *JWTMetrics {
	v.metrics.mu.RLock()
	defer v.metrics.mu.RUnlock()

	return &JWTMetrics{
		ValidationsTotal:   v.metrics.ValidationsTotal,
		ValidationsSuccess: v.metrics.ValidationsSuccess,
		ValidationsFailed:  v.metrics.ValidationsFailed,
		JWKSRefreshes:      v.metrics.JWKSRefreshes,
		JWKSRefreshErrors:  v.metrics.JWKSRefreshErrors,
		AvgLatencyMs:       v.metrics.AvgLatencyMs,
	}
}

// HasRole checks if the claims contain a specific realm role
func (claims *JWTClaims) HasRole(role string) bool {
	if claims.RealmAccess == nil {
		return false
	}
	for _, r := range claims.RealmAccess.Roles {
		if r == role {
			return true
		}
	}
	return false
}

// HasResourceRole checks if the claims contain a specific resource role
func (claims *JWTClaims) HasResourceRole(resource, role string) bool {
	if claims.ResourceAccess == nil {
		return false
	}
	access, ok := claims.ResourceAccess[resource]
	if !ok {
		return false
	}
	for _, r := range access.Roles {
		if r == role {
			return true
		}
	}
	return false
}

// HasPermission checks if the claims contain a specific permission
func (claims *JWTClaims) HasPermission(permission string) bool {
	for _, p := range claims.Permissions {
		if p == permission {
			return true
		}
	}
	return false
}

// JWTMiddleware provides HTTP middleware for JWT validation
type JWTMiddleware struct {
	validator     *KeycloakJWTValidator
	excludePaths  map[string]bool
	requiredRoles []string
}

// NewJWTMiddleware creates a new JWT middleware
func NewJWTMiddleware(validator *KeycloakJWTValidator) *JWTMiddleware {
	return &JWTMiddleware{
		validator:    validator,
		excludePaths: make(map[string]bool),
	}
}

// ExcludePath excludes a path from JWT validation
func (m *JWTMiddleware) ExcludePath(path string) *JWTMiddleware {
	m.excludePaths[path] = true
	return m
}

// RequireRoles requires specific roles for access
func (m *JWTMiddleware) RequireRoles(roles ...string) *JWTMiddleware {
	m.requiredRoles = roles
	return m
}

// Middleware returns the HTTP middleware handler
func (m *JWTMiddleware) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check if path is excluded
		if m.excludePaths[r.URL.Path] {
			next.ServeHTTP(w, r)
			return
		}

		// Extract token from Authorization header
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			http.Error(w, "Missing authorization header", http.StatusUnauthorized)
			return
		}

		if !strings.HasPrefix(authHeader, "Bearer ") {
			http.Error(w, "Invalid authorization header format", http.StatusUnauthorized)
			return
		}

		token := strings.TrimPrefix(authHeader, "Bearer ")

		// Validate token
		claims, err := m.validator.ValidateToken(r.Context(), token)
		if err != nil {
			http.Error(w, fmt.Sprintf("Invalid token: %v", err), http.StatusUnauthorized)
			return
		}

		// Check required roles
		if len(m.requiredRoles) > 0 {
			hasRole := false
			for _, role := range m.requiredRoles {
				if claims.HasRole(role) {
					hasRole = true
					break
				}
			}
			if !hasRole {
				http.Error(w, "Insufficient permissions", http.StatusForbidden)
				return
			}
		}

		// Add claims to request context
		ctx := context.WithValue(r.Context(), "jwt_claims", claims)
		ctx = context.WithValue(ctx, "user_id", claims.Subject)
		ctx = context.WithValue(ctx, "username", claims.PreferredUsername)

		// Set headers for downstream services
		r.Header.Set("X-User-ID", claims.Subject)
		r.Header.Set("X-User-Type", "user")
		r.Header.Set("X-Username", claims.PreferredUsername)
		if claims.OrganizationID != "" {
			r.Header.Set("X-Organization-ID", claims.OrganizationID)
		}
		if claims.ParticipantID != "" {
			r.Header.Set("X-Participant-ID", claims.ParticipantID)
		}

		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// GetClaimsFromContext retrieves JWT claims from the request context
func GetClaimsFromContext(ctx context.Context) *JWTClaims {
	claims, ok := ctx.Value("jwt_claims").(*JWTClaims)
	if !ok {
		return nil
	}
	return claims
}

// APISIXJWTPluginConfig generates APISIX JWT plugin configuration
func APISIXJWTPluginConfig(config *KeycloakConfig) map[string]interface{} {
	return map[string]interface{}{
		"key":       config.ClientID,
		"secret":    "PLACEHOLDER_FROM_VAULT",
		"algorithm": "RS256",
		"public_key": fmt.Sprintf("%s/realms/%s/protocol/openid-connect/certs",
			config.BaseURL, config.Realm),
		"claims_to_verify": map[string]interface{}{
			"exp": true,
			"nbf": true,
		},
		"header": "Authorization",
		"query":  "token",
		"cookie": "jwt",
	}
}

// APISIXKeycloakAuthzConfig generates APISIX Keycloak authz plugin configuration
func APISIXKeycloakAuthzConfig(config *KeycloakConfig) map[string]interface{} {
	return map[string]interface{}{
		"discovery": fmt.Sprintf("%s/realms/%s/.well-known/openid-configuration",
			config.BaseURL, config.Realm),
		"client_id":                          config.ClientID,
		"client_secret":                      "PLACEHOLDER_FROM_VAULT",
		"bearer_only":                        true,
		"realm":                              config.Realm,
		"introspection_endpoint_auth_method": "client_secret_post",
		"token_endpoint_auth_method":         "client_secret_post",
		"ssl_verify":                         true,
		"timeout":                            10000,
		"cache_ttl_seconds":                  300,
		"keepalive":                          true,
		"keepalive_timeout":                  60000,
		"keepalive_pool":                     5,
	}
}

// KeycloakJWTSchema returns PostgreSQL schema for JWT audit
func KeycloakJWTSchema() string {
	return `
-- JWT validation audit log
CREATE TABLE IF NOT EXISTS jwt_validations (
    id SERIAL PRIMARY KEY,
    jti VARCHAR(64),
    subject VARCHAR(255) NOT NULL,
    issuer VARCHAR(255) NOT NULL,
    audience TEXT,
    issued_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    validated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    valid BOOLEAN NOT NULL,
    error_message TEXT,
    ip_address VARCHAR(45),
    user_agent TEXT,
    request_path TEXT
);

-- Index for JWT audit queries
CREATE INDEX IF NOT EXISTS idx_jwt_validations_subject 
ON jwt_validations(subject, validated_at DESC);

CREATE INDEX IF NOT EXISTS idx_jwt_validations_jti 
ON jwt_validations(jti) WHERE jti IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jwt_validations_failed 
ON jwt_validations(validated_at DESC) WHERE valid = FALSE;

-- Active sessions tracking
CREATE TABLE IF NOT EXISTS active_sessions (
    jti VARCHAR(64) PRIMARY KEY,
    subject VARCHAR(255) NOT NULL,
    issued_at TIMESTAMP WITH TIME ZONE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    revoked BOOLEAN DEFAULT FALSE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    revoked_reason TEXT
);

-- Index for session queries
CREATE INDEX IF NOT EXISTS idx_active_sessions_subject 
ON active_sessions(subject, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_active_sessions_expiry 
ON active_sessions(expires_at) WHERE revoked = FALSE;
`
}
