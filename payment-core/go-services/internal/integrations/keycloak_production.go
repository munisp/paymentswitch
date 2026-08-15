// Package integrations provides production-ready external system integrations
// This file implements a REAL Keycloak Admin REST API client
package integrations

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

// KeycloakConfig holds configuration for the Keycloak client
type KeycloakConfig struct {
	// Base URL (e.g., http://keycloak:8080)
	BaseURL string
	// Realm name
	Realm string
	// Admin credentials
	AdminUsername string
	AdminPassword string
	// Client credentials (for service account)
	ClientID     string
	ClientSecret string
	// Request timeout
	Timeout time.Duration
}

// DefaultKeycloakConfig returns sensible defaults — credentials MUST be set via environment variables
func DefaultKeycloakConfig() *KeycloakConfig {
	return &KeycloakConfig{
		BaseURL:       keycloakEnvOrDefault("KEYCLOAK_URL", "http://keycloak:8080"),
		Realm:         keycloakEnvOrDefault("KEYCLOAK_REALM", "payment-switch"),
		AdminUsername: keycloakEnvOrDefault("KEYCLOAK_ADMIN_USER", ""),
		AdminPassword: keycloakEnvOrDefault("KEYCLOAK_ADMIN_PASSWORD", ""),
		ClientID:      keycloakEnvOrDefault("KEYCLOAK_CLIENT_ID", "admin-cli"),
		Timeout:       30 * time.Second,
	}
}

func keycloakEnvOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ProductionKeycloakClient is a production-ready Keycloak Admin API client
type ProductionKeycloakClient struct {
	config      *KeycloakConfig
	httpClient  *http.Client
	accessToken string
	tokenExpiry time.Time
	mu          sync.RWMutex
}

// NewProductionKeycloakClient creates a new production Keycloak client
func NewProductionKeycloakClient(config *KeycloakConfig) *ProductionKeycloakClient {
	if config == nil {
		config = DefaultKeycloakConfig()
	}

	return &ProductionKeycloakClient{
		config: config,
		httpClient: &http.Client{
			Timeout: config.Timeout,
		},
	}
}

// TokenResponse represents the OAuth token response
type TokenResponse struct {
	AccessToken      string `json:"access_token"`
	ExpiresIn        int    `json:"expires_in"`
	RefreshExpiresIn int    `json:"refresh_expires_in"`
	RefreshToken     string `json:"refresh_token"`
	TokenType        string `json:"token_type"`
	NotBeforePolicy  int    `json:"not-before-policy"`
	SessionState     string `json:"session_state"`
	Scope            string `json:"scope"`
}

// KeycloakUser represents a Keycloak user
type KeycloakUser struct {
	ID                         string              `json:"id,omitempty"`
	Username                   string              `json:"username"`
	Email                      string              `json:"email,omitempty"`
	FirstName                  string              `json:"firstName,omitempty"`
	LastName                   string              `json:"lastName,omitempty"`
	Enabled                    bool                `json:"enabled"`
	EmailVerified              bool                `json:"emailVerified,omitempty"`
	Attributes                 map[string][]string `json:"attributes,omitempty"`
	Credentials                []Credential        `json:"credentials,omitempty"`
	RequiredActions            []string            `json:"requiredActions,omitempty"`
	RealmRoles                 []string            `json:"realmRoles,omitempty"`
	ClientRoles                map[string][]string `json:"clientRoles,omitempty"`
	Groups                     []string            `json:"groups,omitempty"`
	FederatedIdentities        []FederatedIdentity `json:"federatedIdentities,omitempty"`
	ServiceAccountClientId     string              `json:"serviceAccountClientId,omitempty"`
	Access                     map[string]bool     `json:"access,omitempty"`
	CreatedTimestamp           int64               `json:"createdTimestamp,omitempty"`
	Totp                       bool                `json:"totp,omitempty"`
	DisableableCredentialTypes []string            `json:"disableableCredentialTypes,omitempty"`
}

// Credential represents a user credential
type Credential struct {
	Type      string `json:"type"`
	Value     string `json:"value,omitempty"`
	Temporary bool   `json:"temporary,omitempty"`
}

// FederatedIdentity represents a federated identity
type FederatedIdentity struct {
	IdentityProvider string `json:"identityProvider"`
	UserID           string `json:"userId"`
	UserName         string `json:"userName"`
}

// KeycloakClient represents a Keycloak client (application)
type KeycloakClient struct {
	ID                           string            `json:"id,omitempty"`
	ClientID                     string            `json:"clientId"`
	Name                         string            `json:"name,omitempty"`
	Description                  string            `json:"description,omitempty"`
	RootURL                      string            `json:"rootUrl,omitempty"`
	AdminURL                     string            `json:"adminUrl,omitempty"`
	BaseURL                      string            `json:"baseUrl,omitempty"`
	SurrogateAuthRequired        bool              `json:"surrogateAuthRequired,omitempty"`
	Enabled                      bool              `json:"enabled"`
	AlwaysDisplayInConsole       bool              `json:"alwaysDisplayInConsole,omitempty"`
	ClientAuthenticatorType      string            `json:"clientAuthenticatorType,omitempty"`
	Secret                       string            `json:"secret,omitempty"`
	RedirectUris                 []string          `json:"redirectUris,omitempty"`
	WebOrigins                   []string          `json:"webOrigins,omitempty"`
	NotBefore                    int               `json:"notBefore,omitempty"`
	BearerOnly                   bool              `json:"bearerOnly,omitempty"`
	ConsentRequired              bool              `json:"consentRequired,omitempty"`
	StandardFlowEnabled          bool              `json:"standardFlowEnabled,omitempty"`
	ImplicitFlowEnabled          bool              `json:"implicitFlowEnabled,omitempty"`
	DirectAccessGrantsEnabled    bool              `json:"directAccessGrantsEnabled,omitempty"`
	ServiceAccountsEnabled       bool              `json:"serviceAccountsEnabled,omitempty"`
	AuthorizationServicesEnabled bool              `json:"authorizationServicesEnabled,omitempty"`
	PublicClient                 bool              `json:"publicClient,omitempty"`
	FrontchannelLogout           bool              `json:"frontchannelLogout,omitempty"`
	Protocol                     string            `json:"protocol,omitempty"`
	Attributes                   map[string]string `json:"attributes,omitempty"`
	FullScopeAllowed             bool              `json:"fullScopeAllowed,omitempty"`
	NodeReRegistrationTimeout    int               `json:"nodeReRegistrationTimeout,omitempty"`
	DefaultClientScopes          []string          `json:"defaultClientScopes,omitempty"`
	OptionalClientScopes         []string          `json:"optionalClientScopes,omitempty"`
	Access                       map[string]bool   `json:"access,omitempty"`
}

// KeycloakRole represents a Keycloak role
type KeycloakRole struct {
	ID          string              `json:"id,omitempty"`
	Name        string              `json:"name"`
	Description string              `json:"description,omitempty"`
	Composite   bool                `json:"composite,omitempty"`
	ClientRole  bool                `json:"clientRole,omitempty"`
	ContainerID string              `json:"containerId,omitempty"`
	Attributes  map[string][]string `json:"attributes,omitempty"`
}

// KeycloakGroup represents a Keycloak group
type KeycloakGroup struct {
	ID          string              `json:"id,omitempty"`
	Name        string              `json:"name"`
	Path        string              `json:"path,omitempty"`
	SubGroups   []KeycloakGroup     `json:"subGroups,omitempty"`
	Attributes  map[string][]string `json:"attributes,omitempty"`
	RealmRoles  []string            `json:"realmRoles,omitempty"`
	ClientRoles map[string][]string `json:"clientRoles,omitempty"`
}

// getAccessToken gets or refreshes the access token
func (c *ProductionKeycloakClient) getAccessToken(ctx context.Context) (string, error) {
	c.mu.RLock()
	if c.accessToken != "" && time.Now().Before(c.tokenExpiry) {
		token := c.accessToken
		c.mu.RUnlock()
		return token, nil
	}
	c.mu.RUnlock()

	c.mu.Lock()
	defer c.mu.Unlock()

	// Double-check after acquiring write lock
	if c.accessToken != "" && time.Now().Before(c.tokenExpiry) {
		return c.accessToken, nil
	}

	// Get new token
	tokenURL := fmt.Sprintf("%s/realms/master/protocol/openid-connect/token", c.config.BaseURL)

	data := url.Values{}
	data.Set("grant_type", "password")
	data.Set("client_id", c.config.ClientID)
	data.Set("username", c.config.AdminUsername)
	data.Set("password", c.config.AdminPassword)

	if c.config.ClientSecret != "" {
		data.Set("client_secret", c.config.ClientSecret)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", tokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return "", fmt.Errorf("failed to create token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to get token: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("token request failed with status %d: %s", resp.StatusCode, string(body))
	}

	var tokenResp TokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return "", fmt.Errorf("failed to decode token response: %w", err)
	}

	c.accessToken = tokenResp.AccessToken
	c.tokenExpiry = time.Now().Add(time.Duration(tokenResp.ExpiresIn-30) * time.Second)

	return c.accessToken, nil
}

// doRequest performs an authenticated request
func (c *ProductionKeycloakClient) doRequest(ctx context.Context, method, path string, body interface{}) (*http.Response, error) {
	token, err := c.getAccessToken(ctx)
	if err != nil {
		return nil, err
	}

	url := fmt.Sprintf("%s/admin/realms/%s%s", c.config.BaseURL, c.config.Realm, path)

	var reqBody io.Reader
	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		reqBody = bytes.NewReader(jsonBody)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	return c.httpClient.Do(req)
}

// HealthCheck performs a health check against Keycloak
func (c *ProductionKeycloakClient) HealthCheck(ctx context.Context) error {
	url := fmt.Sprintf("%s/health/ready", c.config.BaseURL)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return fmt.Errorf("failed to create health check request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("health check failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("unhealthy status: %d", resp.StatusCode)
	}

	return nil
}

// CreateUser creates a new user
func (c *ProductionKeycloakClient) CreateUser(ctx context.Context, user *KeycloakUser) (string, error) {
	resp, err := c.doRequest(ctx, "POST", "/users", user)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode == 409 {
		return "", fmt.Errorf("user already exists: %s", user.Username)
	}

	if resp.StatusCode != 201 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("failed to create user with status %d: %s", resp.StatusCode, string(body))
	}

	// Extract user ID from Location header
	location := resp.Header.Get("Location")
	parts := strings.Split(location, "/")
	if len(parts) > 0 {
		return parts[len(parts)-1], nil
	}

	return "", nil
}

// GetUser gets a user by ID
func (c *ProductionKeycloakClient) GetUser(ctx context.Context, userID string) (*KeycloakUser, error) {
	resp, err := c.doRequest(ctx, "GET", "/users/"+userID, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 {
		return nil, fmt.Errorf("user not found: %s", userID)
	}

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get user with status %d: %s", resp.StatusCode, string(body))
	}

	var user KeycloakUser
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return nil, fmt.Errorf("failed to decode user: %w", err)
	}

	return &user, nil
}

// GetUserByUsername gets a user by username
func (c *ProductionKeycloakClient) GetUserByUsername(ctx context.Context, username string) (*KeycloakUser, error) {
	resp, err := c.doRequest(ctx, "GET", "/users?username="+url.QueryEscape(username)+"&exact=true", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to search users with status %d: %s", resp.StatusCode, string(body))
	}

	var users []KeycloakUser
	if err := json.NewDecoder(resp.Body).Decode(&users); err != nil {
		return nil, fmt.Errorf("failed to decode users: %w", err)
	}

	if len(users) == 0 {
		return nil, fmt.Errorf("user not found: %s", username)
	}

	return &users[0], nil
}

// UpdateUser updates a user
func (c *ProductionKeycloakClient) UpdateUser(ctx context.Context, userID string, user *KeycloakUser) error {
	resp, err := c.doRequest(ctx, "PUT", "/users/"+userID, user)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 204 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to update user with status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// DeleteUser deletes a user
func (c *ProductionKeycloakClient) DeleteUser(ctx context.Context, userID string) error {
	resp, err := c.doRequest(ctx, "DELETE", "/users/"+userID, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 204 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to delete user with status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// SetUserPassword sets a user's password
func (c *ProductionKeycloakClient) SetUserPassword(ctx context.Context, userID, password string, temporary bool) error {
	cred := Credential{
		Type:      "password",
		Value:     password,
		Temporary: temporary,
	}

	resp, err := c.doRequest(ctx, "PUT", "/users/"+userID+"/reset-password", cred)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 204 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to set password with status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// AssignRealmRoles assigns realm roles to a user
func (c *ProductionKeycloakClient) AssignRealmRoles(ctx context.Context, userID string, roles []KeycloakRole) error {
	resp, err := c.doRequest(ctx, "POST", "/users/"+userID+"/role-mappings/realm", roles)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 204 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to assign roles with status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// CreateClient creates a new client
func (c *ProductionKeycloakClient) CreateClient(ctx context.Context, client *KeycloakClient) (string, error) {
	resp, err := c.doRequest(ctx, "POST", "/clients", client)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode == 409 {
		return "", fmt.Errorf("client already exists: %s", client.ClientID)
	}

	if resp.StatusCode != 201 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("failed to create client with status %d: %s", resp.StatusCode, string(body))
	}

	// Extract client ID from Location header
	location := resp.Header.Get("Location")
	parts := strings.Split(location, "/")
	if len(parts) > 0 {
		return parts[len(parts)-1], nil
	}

	return "", nil
}

// GetClientByClientID gets a client by client ID
func (c *ProductionKeycloakClient) GetClientByClientID(ctx context.Context, clientID string) (*KeycloakClient, error) {
	resp, err := c.doRequest(ctx, "GET", "/clients?clientId="+url.QueryEscape(clientID), nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to search clients with status %d: %s", resp.StatusCode, string(body))
	}

	var clients []KeycloakClient
	if err := json.NewDecoder(resp.Body).Decode(&clients); err != nil {
		return nil, fmt.Errorf("failed to decode clients: %w", err)
	}

	if len(clients) == 0 {
		return nil, fmt.Errorf("client not found: %s", clientID)
	}

	return &clients[0], nil
}

// GetClientSecret gets a client's secret
func (c *ProductionKeycloakClient) GetClientSecret(ctx context.Context, clientUUID string) (string, error) {
	resp, err := c.doRequest(ctx, "GET", "/clients/"+clientUUID+"/client-secret", nil)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("failed to get client secret with status %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Value string `json:"value"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode client secret: %w", err)
	}

	return result.Value, nil
}

// CreateRole creates a new realm role
func (c *ProductionKeycloakClient) CreateRole(ctx context.Context, role *KeycloakRole) error {
	resp, err := c.doRequest(ctx, "POST", "/roles", role)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == 409 {
		return fmt.Errorf("role already exists: %s", role.Name)
	}

	if resp.StatusCode != 201 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to create role with status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// GetRole gets a role by name
func (c *ProductionKeycloakClient) GetRole(ctx context.Context, roleName string) (*KeycloakRole, error) {
	resp, err := c.doRequest(ctx, "GET", "/roles/"+url.PathEscape(roleName), nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 {
		return nil, fmt.Errorf("role not found: %s", roleName)
	}

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get role with status %d: %s", resp.StatusCode, string(body))
	}

	var role KeycloakRole
	if err := json.NewDecoder(resp.Body).Decode(&role); err != nil {
		return nil, fmt.Errorf("failed to decode role: %w", err)
	}

	return &role, nil
}

// CreateGroup creates a new group
func (c *ProductionKeycloakClient) CreateGroup(ctx context.Context, group *KeycloakGroup) (string, error) {
	resp, err := c.doRequest(ctx, "POST", "/groups", group)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode == 409 {
		return "", fmt.Errorf("group already exists: %s", group.Name)
	}

	if resp.StatusCode != 201 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("failed to create group with status %d: %s", resp.StatusCode, string(body))
	}

	// Extract group ID from Location header
	location := resp.Header.Get("Location")
	parts := strings.Split(location, "/")
	if len(parts) > 0 {
		return parts[len(parts)-1], nil
	}

	return "", nil
}

// AddUserToGroup adds a user to a group
func (c *ProductionKeycloakClient) AddUserToGroup(ctx context.Context, userID, groupID string) error {
	resp, err := c.doRequest(ctx, "PUT", "/users/"+userID+"/groups/"+groupID, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 204 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to add user to group with status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// Enable2FA enables TOTP 2FA for a user
func (c *ProductionKeycloakClient) Enable2FA(ctx context.Context, userID string) error {
	user, err := c.GetUser(ctx, userID)
	if err != nil {
		return err
	}

	// Add CONFIGURE_TOTP to required actions
	user.RequiredActions = append(user.RequiredActions, "CONFIGURE_TOTP")

	return c.UpdateUser(ctx, userID, user)
}

// ProvisionParticipant provisions a complete participant setup in Keycloak
func (c *ProductionKeycloakClient) ProvisionParticipant(ctx context.Context, participantID, participantName, adminEmail, adminPassword string) (*KeycloakProvisionResult, error) {
	result := &KeycloakProvisionResult{
		ParticipantID: participantID,
	}

	// 1. Create client for the participant
	client := &KeycloakClient{
		ClientID:                  participantID + "-client",
		Name:                      participantName + " Client",
		Enabled:                   true,
		StandardFlowEnabled:       true,
		DirectAccessGrantsEnabled: false,
		ServiceAccountsEnabled:    true,
		PublicClient:              false,
		Protocol:                  "openid-connect",
		RedirectUris:              []string{},
		WebOrigins:                []string{},
	}

	clientUUID, err := c.CreateClient(ctx, client)
	if err != nil {
		return nil, fmt.Errorf("failed to create client: %w", err)
	}
	result.ClientUUID = clientUUID

	// Get client secret
	secret, err := c.GetClientSecret(ctx, clientUUID)
	if err != nil {
		return nil, fmt.Errorf("failed to get client secret: %w", err)
	}
	result.ClientSecret = secret

	// 2. Create admin user for the participant
	adminUser := &KeycloakUser{
		Username:      participantID + "-admin",
		Email:         adminEmail,
		Enabled:       true,
		EmailVerified: true,
		Credentials: []Credential{
			{
				Type:      "password",
				Value:     adminPassword,
				Temporary: false,
			},
		},
		Attributes: map[string][]string{
			"participant_id": {participantID},
		},
	}

	userID, err := c.CreateUser(ctx, adminUser)
	if err != nil {
		return nil, fmt.Errorf("failed to create admin user: %w", err)
	}
	result.AdminUserID = userID

	// 3. Assign participant_admin role
	role, err := c.GetRole(ctx, "participant_admin")
	if err != nil {
		// Create the role if it doesn't exist
		err = c.CreateRole(ctx, &KeycloakRole{
			Name:        "participant_admin",
			Description: "Participant administrator role",
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create participant_admin role: %w", err)
		}
		role, _ = c.GetRole(ctx, "participant_admin")
	}

	if role != nil {
		if err := c.AssignRealmRoles(ctx, userID, []KeycloakRole{*role}); err != nil {
			return nil, fmt.Errorf("failed to assign role: %w", err)
		}
	}

	result.Success = true
	return result, nil
}

// KeycloakProvisionResult contains the result of provisioning a participant in Keycloak
type KeycloakProvisionResult struct {
	ParticipantID string
	ClientUUID    string
	ClientSecret  string
	AdminUserID   string
	Success       bool
}
