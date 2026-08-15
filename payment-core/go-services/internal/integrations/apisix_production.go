// Package integrations provides production-ready external system integrations
// This file implements a REAL APISIX Admin API client
package integrations

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// APISIXConfig holds configuration for the APISIX client
type APISIXConfig struct {
	// Admin API URL (e.g., http://apisix:9180)
	AdminURL string
	// Admin API Key
	APIKey string
	// Request timeout
	Timeout time.Duration
}

// DefaultAPISIXConfig returns sensible defaults
func DefaultAPISIXConfig() *APISIXConfig {
	return &APISIXConfig{
		AdminURL: "http://apisix:9180",
		APIKey:   "",
		Timeout:  30 * time.Second,
	}
}

// ProductionAPISIXClient is a production-ready APISIX Admin API client
type ProductionAPISIXClient struct {
	config     *APISIXConfig
	httpClient *http.Client
}

// NewProductionAPISIXClient creates a new production APISIX client
func NewProductionAPISIXClient(config *APISIXConfig) *ProductionAPISIXClient {
	if config == nil {
		config = DefaultAPISIXConfig()
	}

	return &ProductionAPISIXClient{
		config: config,
		httpClient: &http.Client{
			Timeout: config.Timeout,
		},
	}
}

// APISIXRoute represents an APISIX route
type APISIXRoute struct {
	ID              string                 `json:"id,omitempty"`
	Name            string                 `json:"name,omitempty"`
	Desc            string                 `json:"desc,omitempty"`
	URI             string                 `json:"uri,omitempty"`
	URIs            []string               `json:"uris,omitempty"`
	Host            string                 `json:"host,omitempty"`
	Hosts           []string               `json:"hosts,omitempty"`
	Methods         []string               `json:"methods,omitempty"`
	Priority        int                    `json:"priority,omitempty"`
	Plugins         map[string]interface{} `json:"plugins,omitempty"`
	Upstream        *APISIXUpstream        `json:"upstream,omitempty"`
	UpstreamID      string                 `json:"upstream_id,omitempty"`
	ServiceID       string                 `json:"service_id,omitempty"`
	Labels          map[string]string      `json:"labels,omitempty"`
	Timeout         *APISIXTimeout         `json:"timeout,omitempty"`
	EnableWebsocket bool                   `json:"enable_websocket,omitempty"`
	Status          int                    `json:"status,omitempty"`
}

// APISIXUpstream represents an APISIX upstream
type APISIXUpstream struct {
	ID            string               `json:"id,omitempty"`
	Name          string               `json:"name,omitempty"`
	Desc          string               `json:"desc,omitempty"`
	Type          string               `json:"type,omitempty"` // roundrobin, chash, ewma, least_conn
	Nodes         map[string]int       `json:"nodes,omitempty"`
	NodesList     []APISIXNode         `json:"nodes_list,omitempty"`
	Retries       int                  `json:"retries,omitempty"`
	RetryTimeout  int                  `json:"retry_timeout,omitempty"`
	Timeout       *APISIXTimeout       `json:"timeout,omitempty"`
	Scheme        string               `json:"scheme,omitempty"` // http, https, grpc, grpcs
	PassHost      string               `json:"pass_host,omitempty"`
	UpstreamHost  string               `json:"upstream_host,omitempty"`
	Labels        map[string]string    `json:"labels,omitempty"`
	Checks        *APISIXHealthCheck   `json:"checks,omitempty"`
	HashOn        string               `json:"hash_on,omitempty"`
	Key           string               `json:"key,omitempty"`
	KeepalivePool *APISIXKeepalivePool `json:"keepalive_pool,omitempty"`
	TLS           *APISIXUpstreamTLS   `json:"tls,omitempty"`
}

// APISIXNode represents an upstream node
type APISIXNode struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Weight   int    `json:"weight"`
	Priority int    `json:"priority,omitempty"`
}

// APISIXTimeout represents timeout configuration
type APISIXTimeout struct {
	Connect int `json:"connect,omitempty"`
	Send    int `json:"send,omitempty"`
	Read    int `json:"read,omitempty"`
}

// APISIXHealthCheck represents health check configuration
type APISIXHealthCheck struct {
	Active  *APISIXActiveHealthCheck  `json:"active,omitempty"`
	Passive *APISIXPassiveHealthCheck `json:"passive,omitempty"`
}

// APISIXActiveHealthCheck represents active health check configuration
type APISIXActiveHealthCheck struct {
	Type                   string                    `json:"type,omitempty"` // http, https, tcp
	Timeout                int                       `json:"timeout,omitempty"`
	Concurrency            int                       `json:"concurrency,omitempty"`
	HTTPPath               string                    `json:"http_path,omitempty"`
	Host                   string                    `json:"host,omitempty"`
	Port                   int                       `json:"port,omitempty"`
	HTTPSVerifyCertificate bool                      `json:"https_verify_certificate,omitempty"`
	ReqHeaders             []string                  `json:"req_headers,omitempty"`
	Healthy                *APISIXHealthyCondition   `json:"healthy,omitempty"`
	Unhealthy              *APISIXUnhealthyCondition `json:"unhealthy,omitempty"`
}

// APISIXPassiveHealthCheck represents passive health check configuration
type APISIXPassiveHealthCheck struct {
	Type      string                    `json:"type,omitempty"`
	Healthy   *APISIXHealthyCondition   `json:"healthy,omitempty"`
	Unhealthy *APISIXUnhealthyCondition `json:"unhealthy,omitempty"`
}

// APISIXHealthyCondition represents healthy condition
type APISIXHealthyCondition struct {
	Interval     int   `json:"interval,omitempty"`
	HTTPStatuses []int `json:"http_statuses,omitempty"`
	Successes    int   `json:"successes,omitempty"`
}

// APISIXUnhealthyCondition represents unhealthy condition
type APISIXUnhealthyCondition struct {
	Interval     int   `json:"interval,omitempty"`
	HTTPStatuses []int `json:"http_statuses,omitempty"`
	HTTPFailures int   `json:"http_failures,omitempty"`
	TCPFailures  int   `json:"tcp_failures,omitempty"`
	Timeouts     int   `json:"timeouts,omitempty"`
}

// APISIXKeepalivePool represents keepalive pool configuration
type APISIXKeepalivePool struct {
	Size        int `json:"size,omitempty"`
	IdleTimeout int `json:"idle_timeout,omitempty"`
	Requests    int `json:"requests,omitempty"`
}

// APISIXUpstreamTLS represents upstream TLS configuration
type APISIXUpstreamTLS struct {
	ClientCert string `json:"client_cert,omitempty"`
	ClientKey  string `json:"client_key,omitempty"`
}

// APISIXService represents an APISIX service
type APISIXService struct {
	ID              string                 `json:"id,omitempty"`
	Name            string                 `json:"name,omitempty"`
	Desc            string                 `json:"desc,omitempty"`
	Plugins         map[string]interface{} `json:"plugins,omitempty"`
	Upstream        *APISIXUpstream        `json:"upstream,omitempty"`
	UpstreamID      string                 `json:"upstream_id,omitempty"`
	Labels          map[string]string      `json:"labels,omitempty"`
	EnableWebsocket bool                   `json:"enable_websocket,omitempty"`
	Hosts           []string               `json:"hosts,omitempty"`
}

// APISIXConsumer represents an APISIX consumer
type APISIXConsumer struct {
	Username string                 `json:"username"`
	Desc     string                 `json:"desc,omitempty"`
	Plugins  map[string]interface{} `json:"plugins,omitempty"`
	Labels   map[string]string      `json:"labels,omitempty"`
	GroupID  string                 `json:"group_id,omitempty"`
}

// APISIXConsumerGroup represents an APISIX consumer group
type APISIXConsumerGroup struct {
	ID      string                 `json:"id,omitempty"`
	Desc    string                 `json:"desc,omitempty"`
	Plugins map[string]interface{} `json:"plugins,omitempty"`
	Labels  map[string]string      `json:"labels,omitempty"`
}

// APISIXPluginConfig represents an APISIX plugin config
type APISIXPluginConfig struct {
	ID      string                 `json:"id,omitempty"`
	Desc    string                 `json:"desc,omitempty"`
	Plugins map[string]interface{} `json:"plugins,omitempty"`
	Labels  map[string]string      `json:"labels,omitempty"`
}

// APISIXResponse represents a generic APISIX API response
type APISIXResponse struct {
	Key   string          `json:"key,omitempty"`
	Value json.RawMessage `json:"value,omitempty"`
	Node  *APISIXNode     `json:"node,omitempty"`
}

// doRequest performs an authenticated request to APISIX Admin API
func (c *ProductionAPISIXClient) doRequest(ctx context.Context, method, path string, body interface{}) (*http.Response, error) {
	url := c.config.AdminURL + "/apisix/admin" + path

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

	if strings.TrimSpace(c.config.APIKey) == "" {
		return nil, fmt.Errorf("APISIX admin API key is required")
	}
	req.Header.Set("X-API-KEY", c.config.APIKey)
	req.Header.Set("Content-Type", "application/json")

	return c.httpClient.Do(req)
}

// HealthCheck performs a health check against APISIX
func (c *ProductionAPISIXClient) HealthCheck(ctx context.Context) error {
	// Check control API health endpoint
	url := c.config.AdminURL + "/apisix/status"

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

// CreateRoute creates a new route
func (c *ProductionAPISIXClient) CreateRoute(ctx context.Context, route *APISIXRoute) (string, error) {
	path := "/routes"
	if route.ID != "" {
		path = "/routes/" + route.ID
	}

	method := "POST"
	if route.ID != "" {
		method = "PUT"
	}

	resp, err := c.doRequest(ctx, method, path, route)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("failed to create route with status %d: %s", resp.StatusCode, string(body))
	}

	var result APISIXResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	return result.Key, nil
}

// GetRoute gets a route by ID
func (c *ProductionAPISIXClient) GetRoute(ctx context.Context, routeID string) (*APISIXRoute, error) {
	resp, err := c.doRequest(ctx, "GET", "/routes/"+routeID, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 {
		return nil, fmt.Errorf("route not found: %s", routeID)
	}

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get route with status %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Value APISIXRoute `json:"value"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode route: %w", err)
	}

	return &result.Value, nil
}

// DeleteRoute deletes a route
func (c *ProductionAPISIXClient) DeleteRoute(ctx context.Context, routeID string) error {
	resp, err := c.doRequest(ctx, "DELETE", "/routes/"+routeID, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 && resp.StatusCode != 404 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to delete route with status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// CreateUpstream creates a new upstream
func (c *ProductionAPISIXClient) CreateUpstream(ctx context.Context, upstream *APISIXUpstream) (string, error) {
	path := "/upstreams"
	if upstream.ID != "" {
		path = "/upstreams/" + upstream.ID
	}

	method := "POST"
	if upstream.ID != "" {
		method = "PUT"
	}

	resp, err := c.doRequest(ctx, method, path, upstream)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("failed to create upstream with status %d: %s", resp.StatusCode, string(body))
	}

	var result APISIXResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	return result.Key, nil
}

// GetUpstream gets an upstream by ID
func (c *ProductionAPISIXClient) GetUpstream(ctx context.Context, upstreamID string) (*APISIXUpstream, error) {
	resp, err := c.doRequest(ctx, "GET", "/upstreams/"+upstreamID, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 {
		return nil, fmt.Errorf("upstream not found: %s", upstreamID)
	}

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get upstream with status %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Value APISIXUpstream `json:"value"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode upstream: %w", err)
	}

	return &result.Value, nil
}

// DeleteUpstream deletes an upstream
func (c *ProductionAPISIXClient) DeleteUpstream(ctx context.Context, upstreamID string) error {
	resp, err := c.doRequest(ctx, "DELETE", "/upstreams/"+upstreamID, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 && resp.StatusCode != 404 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to delete upstream with status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// CreateService creates a new service
func (c *ProductionAPISIXClient) CreateService(ctx context.Context, service *APISIXService) (string, error) {
	path := "/services"
	if service.ID != "" {
		path = "/services/" + service.ID
	}

	method := "POST"
	if service.ID != "" {
		method = "PUT"
	}

	resp, err := c.doRequest(ctx, method, path, service)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("failed to create service with status %d: %s", resp.StatusCode, string(body))
	}

	var result APISIXResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	return result.Key, nil
}

// CreateConsumer creates a new consumer
func (c *ProductionAPISIXClient) CreateConsumer(ctx context.Context, consumer *APISIXConsumer) error {
	resp, err := c.doRequest(ctx, "PUT", "/consumers/"+consumer.Username, consumer)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to create consumer with status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// GetConsumer gets a consumer by username
func (c *ProductionAPISIXClient) GetConsumer(ctx context.Context, username string) (*APISIXConsumer, error) {
	resp, err := c.doRequest(ctx, "GET", "/consumers/"+username, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 {
		return nil, fmt.Errorf("consumer not found: %s", username)
	}

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get consumer with status %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Value APISIXConsumer `json:"value"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode consumer: %w", err)
	}

	return &result.Value, nil
}

// DeleteConsumer deletes a consumer
func (c *ProductionAPISIXClient) DeleteConsumer(ctx context.Context, username string) error {
	resp, err := c.doRequest(ctx, "DELETE", "/consumers/"+username, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 && resp.StatusCode != 404 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to delete consumer with status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// EnableRateLimiting enables rate limiting on a route
func (c *ProductionAPISIXClient) EnableRateLimiting(ctx context.Context, routeID string, requestsPerSecond int) error {
	route, err := c.GetRoute(ctx, routeID)
	if err != nil {
		return err
	}

	if route.Plugins == nil {
		route.Plugins = make(map[string]interface{})
	}

	route.Plugins["limit-req"] = map[string]interface{}{
		"rate":          requestsPerSecond,
		"burst":         requestsPerSecond * 2,
		"rejected_code": 429,
		"key_type":      "var",
		"key":           "remote_addr",
	}

	_, err = c.CreateRoute(ctx, route)
	return err
}

// EnableJWTAuth enables JWT authentication on a route
func (c *ProductionAPISIXClient) EnableJWTAuth(ctx context.Context, routeID string) error {
	route, err := c.GetRoute(ctx, routeID)
	if err != nil {
		return err
	}

	if route.Plugins == nil {
		route.Plugins = make(map[string]interface{})
	}

	route.Plugins["jwt-auth"] = map[string]interface{}{}

	_, err = c.CreateRoute(ctx, route)
	return err
}

// EnableKeyAuth enables API key authentication on a route
func (c *ProductionAPISIXClient) EnableKeyAuth(ctx context.Context, routeID string) error {
	route, err := c.GetRoute(ctx, routeID)
	if err != nil {
		return err
	}

	if route.Plugins == nil {
		route.Plugins = make(map[string]interface{})
	}

	route.Plugins["key-auth"] = map[string]interface{}{}

	_, err = c.CreateRoute(ctx, route)
	return err
}

// EnableCORS enables CORS on a route
func (c *ProductionAPISIXClient) EnableCORS(ctx context.Context, routeID string, origins []string) error {
	route, err := c.GetRoute(ctx, routeID)
	if err != nil {
		return err
	}

	if route.Plugins == nil {
		route.Plugins = make(map[string]interface{})
	}

	route.Plugins["cors"] = map[string]interface{}{
		"allow_origins":    origins,
		"allow_methods":    "*",
		"allow_headers":    "*",
		"expose_headers":   "*",
		"max_age":          3600,
		"allow_credential": true,
	}

	_, err = c.CreateRoute(ctx, route)
	return err
}

// ProvisionParticipantRoutes provisions routes for a participant
func (c *ProductionAPISIXClient) ProvisionParticipantRoutes(ctx context.Context, participantID string, backendHost string, backendPort int) (*ParticipantRoutesResult, error) {
	result := &ParticipantRoutesResult{
		ParticipantID: participantID,
	}

	// Create upstream for the participant
	upstream := &APISIXUpstream{
		ID:   participantID + "-upstream",
		Name: participantID + " Upstream",
		Type: "roundrobin",
		Nodes: map[string]int{
			fmt.Sprintf("%s:%d", backendHost, backendPort): 1,
		},
		Retries: 3,
		Timeout: &APISIXTimeout{
			Connect: 6,
			Send:    6,
			Read:    6,
		},
		Checks: &APISIXHealthCheck{
			Active: &APISIXActiveHealthCheck{
				Type:     "http",
				HTTPPath: "/health",
				Timeout:  5,
				Healthy: &APISIXHealthyCondition{
					Interval:     2,
					HTTPStatuses: []int{200, 302},
					Successes:    2,
				},
				Unhealthy: &APISIXUnhealthyCondition{
					Interval:     1,
					HTTPStatuses: []int{429, 500, 503},
					HTTPFailures: 3,
					Timeouts:     3,
				},
			},
		},
	}

	upstreamKey, err := c.CreateUpstream(ctx, upstream)
	if err != nil {
		return nil, fmt.Errorf("failed to create upstream: %w", err)
	}
	result.UpstreamID = upstreamKey

	// Create API route for the participant
	apiRoute := &APISIXRoute{
		ID:         participantID + "-api",
		Name:       participantID + " API Route",
		URI:        "/api/v1/participants/" + participantID + "/*",
		Methods:    []string{"GET", "POST", "PUT", "DELETE", "PATCH"},
		UpstreamID: participantID + "-upstream",
		Plugins: map[string]interface{}{
			"proxy-rewrite": map[string]interface{}{
				"regex_uri": []string{
					"^/api/v1/participants/" + participantID + "/(.*)",
					"/api/v1/$1",
				},
			},
			"limit-req": map[string]interface{}{
				"rate":          100,
				"burst":         200,
				"rejected_code": 429,
				"key_type":      "var",
				"key":           "remote_addr",
			},
		},
		Labels: map[string]string{
			"participant": participantID,
			"type":        "api",
		},
	}

	apiRouteKey, err := c.CreateRoute(ctx, apiRoute)
	if err != nil {
		return nil, fmt.Errorf("failed to create API route: %w", err)
	}
	result.APIRouteID = apiRouteKey

	// Create consumer for the participant
	consumer := &APISIXConsumer{
		Username: participantID,
		Desc:     participantID + " API Consumer",
		Plugins: map[string]interface{}{
			"key-auth": map[string]interface{}{
				"key": participantID + "-api-key",
			},
		},
		Labels: map[string]string{
			"participant": participantID,
		},
	}

	if err := c.CreateConsumer(ctx, consumer); err != nil {
		return nil, fmt.Errorf("failed to create consumer: %w", err)
	}
	result.ConsumerUsername = participantID

	result.Success = true
	return result, nil
}

// ParticipantRoutesResult contains the result of provisioning participant routes
type ParticipantRoutesResult struct {
	ParticipantID    string
	UpstreamID       string
	APIRouteID       string
	ConsumerUsername string
	Success          bool
}
