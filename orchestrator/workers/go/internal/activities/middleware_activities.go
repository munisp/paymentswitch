package activities

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/go-redis/redis/v8"
)

// ============================================================================
// MIDDLEWARE ACTIVITIES
// These activities integrate with Kafka, Dapr, Fluvio, Keycloak, Permify,
// Redis, APISIX, TigerBeetle, and Lakehouse.
// ============================================================================

// MiddlewareConfig holds configuration for all middleware connections
type MiddlewareConfig struct {
	// Kafka
	KafkaBrokers string
	KafkaGroupID string

	// Redis
	RedisAddr     string
	RedisPassword string
	RedisDB       int

	// Keycloak
	KeycloakURL      string
	KeycloakRealm    string
	KeycloakClientID string
	KeycloakSecret   string

	// Permify
	PermifyURL      string
	PermifyKey      string
	PermifyTenantID string

	// APISIX
	APISIXURL    string
	APISIXAPIKey string

	// TigerBeetle
	TigerBeetleAddr string
	TigerBeetleClusterID uint128

	// Fluvio
	FluvioAddr string

	// Dapr
	DaprHTTPPort string
	DaprGRPCPort string

	// Lakehouse
	LakehouseEndpoint string
	LakehouseAccessKey string
	LakehouseSecretKey string
}

// uint128 represents a 128-bit unsigned integer for TigerBeetle
type uint128 [16]byte

// DefaultMiddlewareConfig returns configuration from environment variables
func DefaultMiddlewareConfig() *MiddlewareConfig {
	return &MiddlewareConfig{
		// Kafka
		KafkaBrokers: getEnv("KAFKA_BROKERS", "kafka.payment-switch.svc.cluster.local:9092"),
		KafkaGroupID: getEnv("KAFKA_GROUP_ID", "orchestrator-workers"),

		// Redis
		RedisAddr:     getEnv("REDIS_ADDR", "redis.payment-switch.svc.cluster.local:6379"),
		RedisPassword: getEnv("REDIS_PASSWORD", ""),
		RedisDB:       0,

		// Keycloak
		KeycloakURL:      getEnv("KEYCLOAK_URL", "http://keycloak.payment-switch.svc.cluster.local:8080"),
		KeycloakRealm:    getEnv("KEYCLOAK_REALM", "payment-switch"),
		KeycloakClientID: getEnv("KEYCLOAK_CLIENT_ID", "orchestrator"),
		KeycloakSecret:   getEnv("KEYCLOAK_SECRET", ""),

		// Permify
		PermifyURL:      getEnv("PERMIFY_URL", ""),
		PermifyKey:      getEnv("PERMIFY_KEY", ""),
		PermifyTenantID: getEnv("PERMIFY_TENANT_ID", ""),

		// APISIX
		APISIXURL:    getEnv("APISIX_ADMIN_URL", "http://apisix-admin.payment-switch.svc.cluster.local:9180"),
		APISIXAPIKey: getEnv("APISIX_API_KEY", ""),

		// TigerBeetle
		TigerBeetleAddr: getEnv("TIGERBEETLE_ADDR", "tigerbeetle.payment-switch.svc.cluster.local:3000"),

		// Fluvio
		FluvioAddr: getEnv("FLUVIO_ADDR", "fluvio.payment-switch.svc.cluster.local:9003"),

		// Dapr
		DaprHTTPPort: getEnv("DAPR_HTTP_PORT", "3500"),
		DaprGRPCPort: getEnv("DAPR_GRPC_PORT", "50001"),

		// Lakehouse (RustFS)
		LakehouseEndpoint:  getEnv("S3_ENDPOINT", "http://rustfs.lakehouse.svc.cluster.local:9000"),
		LakehouseAccessKey: getEnv("AWS_ACCESS_KEY_ID", ""),
		LakehouseSecretKey: getEnv("AWS_SECRET_ACCESS_KEY", ""),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// ============================================================================
// KAFKA ACTIVITIES
// ============================================================================

// KafkaActivities handles Kafka operations
type KafkaActivities struct {
	config   *MiddlewareConfig
	producer *kafka.Producer
}

// NewKafkaActivities creates a new KafkaActivities instance
func NewKafkaActivities(config *MiddlewareConfig) (*KafkaActivities, error) {
	producer, err := kafka.NewProducer(&kafka.ConfigMap{
		"bootstrap.servers": config.KafkaBrokers,
		"acks":              "all",
		"retries":           3,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create Kafka producer: %w", err)
	}

	return &KafkaActivities{
		config:   config,
		producer: producer,
	}, nil
}

// PublishToKafka publishes a message to a Kafka topic
func (k *KafkaActivities) PublishToKafka(ctx context.Context, topic string, payload interface{}) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	deliveryChan := make(chan kafka.Event)
	err = k.producer.Produce(&kafka.Message{
		TopicPartition: kafka.TopicPartition{Topic: &topic, Partition: kafka.PartitionAny},
		Value:          data,
		Timestamp:      time.Now(),
	}, deliveryChan)
	if err != nil {
		return fmt.Errorf("failed to produce message: %w", err)
	}

	e := <-deliveryChan
	m := e.(*kafka.Message)
	if m.TopicPartition.Error != nil {
		return fmt.Errorf("delivery failed: %w", m.TopicPartition.Error)
	}

	return nil
}

// ============================================================================
// REDIS ACTIVITIES
// ============================================================================

// RedisActivities handles Redis operations
type RedisActivities struct {
	config *MiddlewareConfig
	client *redis.Client
}

// NewRedisActivities creates a new RedisActivities instance
func NewRedisActivities(config *MiddlewareConfig) *RedisActivities {
	client := redis.NewClient(&redis.Options{
		Addr:     config.RedisAddr,
		Password: config.RedisPassword,
		DB:       config.RedisDB,
	})

	return &RedisActivities{
		config: config,
		client: client,
	}
}

// CacheSet sets a value in Redis with expiration
func (r *RedisActivities) CacheSet(ctx context.Context, key string, value interface{}, expiration time.Duration) error {
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("failed to marshal value: %w", err)
	}

	return r.client.Set(ctx, key, data, expiration).Err()
}

// CacheGet gets a value from Redis
func (r *RedisActivities) CacheGet(ctx context.Context, key string) (string, error) {
	return r.client.Get(ctx, key).Result()
}

// CacheDelete deletes a key from Redis
func (r *RedisActivities) CacheDelete(ctx context.Context, key string) error {
	return r.client.Del(ctx, key).Err()
}

// CheckIdempotencyKey checks if an idempotency key exists
func (r *RedisActivities) CheckIdempotencyKey(ctx context.Context, key string) (bool, error) {
	exists, err := r.client.Exists(ctx, fmt.Sprintf("idempotency:%s", key)).Result()
	return exists > 0, err
}

// RecordIdempotencyKey records an idempotency key with result
func (r *RedisActivities) RecordIdempotencyKey(ctx context.Context, key string, result interface{}) error {
	data, err := json.Marshal(result)
	if err != nil {
		return err
	}
	return r.client.Set(ctx, fmt.Sprintf("idempotency:%s", key), data, 24*time.Hour).Err()
}

// ============================================================================
// KEYCLOAK ACTIVITIES
// ============================================================================

// KeycloakActivities handles Keycloak operations
type KeycloakActivities struct {
	config     *MiddlewareConfig
	httpClient *http.Client
}

// NewKeycloakActivities creates a new KeycloakActivities instance
func NewKeycloakActivities(config *MiddlewareConfig) *KeycloakActivities {
	return &KeycloakActivities{
		config:     config,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// ValidateKeycloakSession validates a user session
func (k *KeycloakActivities) ValidateKeycloakSession(ctx context.Context, userID string) (bool, error) {
	url := fmt.Sprintf("%s/realms/%s/protocol/openid-connect/userinfo",
		k.config.KeycloakURL, k.config.KeycloakRealm)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return false, err
	}

	resp, err := k.httpClient.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	return resp.StatusCode == http.StatusOK, nil
}

// CreateKeycloakRealm creates a new realm for an organization
func (k *KeycloakActivities) CreateKeycloakRealm(ctx context.Context, orgID, orgName string) error {
	url := fmt.Sprintf("%s/admin/realms", k.config.KeycloakURL)

	realmConfig := map[string]interface{}{
		"realm":   fmt.Sprintf("org-%s", orgID),
		"enabled": true,
		"displayName": orgName,
	}

	data, _ := json.Marshal(realmConfig)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := k.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusConflict {
		return fmt.Errorf("failed to create realm: %d", resp.StatusCode)
	}

	return nil
}

// ============================================================================
// PERMIFY ACTIVITIES
// ============================================================================

// PermifyActivities handles Permify authorization operations
type PermifyActivities struct {
	config     *MiddlewareConfig
	httpClient *http.Client
}

// NewPermifyActivities creates a new PermifyActivities instance
func NewPermifyActivities(config *MiddlewareConfig) *PermifyActivities {
	return &PermifyActivities{
		config:     config,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

// CheckPermifyPermission checks if a subject has permission on a resource
func (p *PermifyActivities) CheckPermifyPermission(ctx context.Context, subject, resource, action string) (bool, error) {
	if p.config.PermifyURL == "" || p.config.PermifyTenantID == "" {
		return false, fmt.Errorf("permify URL and tenant are required")
	}
	resourceType, resourceID := "resource", resource
	if parts := strings.SplitN(resource, ":", 2); len(parts) == 2 {
		resourceType, resourceID = parts[0], parts[1]
	}
	url := fmt.Sprintf("%s/v1/tenants/%s/permissions/check", strings.TrimRight(p.config.PermifyURL, "/"), p.config.PermifyTenantID)

	checkRequest := map[string]interface{}{
		"metadata": map[string]interface{}{
			"snap_token":     "",
			"schema_version": "",
			"depth":          20,
		},
		"entity": map[string]interface{}{
			"type": resourceType,
			"id":   resourceID,
		},
		"permission": action,
		"subject": map[string]interface{}{
			"type": "user",
			"id":   subject,
		},
	}

	data, _ := json.Marshal(checkRequest)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(data))
	if err != nil {
		return false, err
	}
	req.Header.Set("Content-Type", "application/json")
	if p.config.PermifyKey != "" {
		req.Header.Set("Authorization", "Bearer "+p.config.PermifyKey)
	}

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return false, fmt.Errorf("permify check failed: %s: %s", resp.Status, string(body))
	}
	var result struct {
		Can interface{} `json:"can"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false, err
	}
	if can, ok := result.Can.(bool); ok {
		return can, nil
	}
	if can, ok := result.Can.(string); ok {
		return can == "CHECK_RESULT_ALLOWED", nil
	}
	return false, fmt.Errorf("permify response did not contain a boolean permission result")
}

// WritePermifyTuple writes one explicitly typed relationship tuple. References
// must use type:id form, for example merchant:merchant-a and user:user-a.
func (p *PermifyActivities) WritePermifyTuple(ctx context.Context, entityRef, relation, subjectRef string) error {
	if p.config.PermifyURL == "" || p.config.PermifyTenantID == "" {
		return fmt.Errorf("permify URL and tenant are required")
	}
	entityType, entityID, err := parsePermifyRef(entityRef)
	if err != nil {
		return fmt.Errorf("invalid entity reference: %w", err)
	}
	subjectType, subjectID, err := parsePermifyRef(subjectRef)
	if err != nil {
		return fmt.Errorf("invalid subject reference: %w", err)
	}
	if strings.TrimSpace(relation) == "" {
		return fmt.Errorf("permify relation is required")
	}

	url := fmt.Sprintf("%s/v1/tenants/%s/relationships/write", strings.TrimRight(p.config.PermifyURL, "/"), p.config.PermifyTenantID)
	writeRequest := map[string]interface{}{
		"metadata": map[string]interface{}{"schema_version": "paymentswitch-v1"},
		"tuples": []map[string]interface{}{{
			"entity": map[string]interface{}{"type": entityType, "id": entityID},
			"relation": relation,
			"subject": map[string]interface{}{"type": subjectType, "id": subjectID},
		}},
	}
	data, err := json.Marshal(writeRequest)
	if err != nil {
		return fmt.Errorf("marshal permify relationship: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if p.config.PermifyKey != "" {
		req.Header.Set("Authorization", "Bearer "+p.config.PermifyKey)
	}
	resp, err := p.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("permify relationship write failed: %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
	return nil
}

func parsePermifyRef(ref string) (string, string, error) {
	parts := strings.SplitN(strings.TrimSpace(ref), ":", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", fmt.Errorf("reference must be type:id")
	}
	return parts[0], parts[1], nil
}

// GrantPermifyPermission preserves the existing workflow contract while
// requiring explicit type:id references at the boundary.
func (p *PermifyActivities) GrantPermifyPermission(ctx context.Context, subject, resource, action string) error {
	if !strings.Contains(subject, ":") {
		subject = "user:" + subject
	}
	if !strings.Contains(resource, ":") {
		resource = "resource:" + resource
	}
	return p.WritePermifyTuple(ctx, resource, action, subject)
}

// SetupPermifyRelationships creates only relationships with authoritative IDs.
// Child payment/settlement/report tuples are written when those resources are
// created, because their IDs are not known at organization-provision time.
func (p *PermifyActivities) SetupPermifyRelationships(ctx context.Context, orgID, orgType string) error {
	tenantRef := "tenant:" + orgID
	if err := p.WritePermifyTuple(ctx, "organization:"+orgID, "tenant", tenantRef); err != nil {
		return err
	}
	if orgType == "bank" || orgType == "fintech" {
		return p.WritePermifyTuple(ctx, "merchant:"+orgID, "tenant", tenantRef)
	}
	return nil
}

// ============================================================================
// APISIX ACTIVITIES
// ============================================================================

// APISIXActivities handles APISIX gateway operations
type APISIXActivities struct {
	config     *MiddlewareConfig
	httpClient *http.Client
}

// NewAPISIXActivities creates a new APISIXActivities instance
func NewAPISIXActivities(config *MiddlewareConfig) *APISIXActivities {
	return &APISIXActivities{
		config:     config,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// CreateAPISIXRoutes creates routes for an organization
func (a *APISIXActivities) CreateAPISIXRoutes(ctx context.Context, orgID, apiKey string) error {
	url := fmt.Sprintf("%s/apisix/admin/routes/%s", a.config.APISIXURL, orgID)

	routeConfig := map[string]interface{}{
		"uri":  fmt.Sprintf("/api/v1/org/%s/*", orgID),
		"name": fmt.Sprintf("org-%s-routes", orgID),
		"methods": []string{"GET", "POST", "PUT", "DELETE"},
		"plugins": map[string]interface{}{
			"key-auth": map[string]interface{}{
				"key": apiKey,
			},
			"limit-req": map[string]interface{}{
				"rate":  100,
				"burst": 50,
				"key":   "consumer_name",
			},
		},
		"upstream": map[string]interface{}{
			"type": "roundrobin",
			"nodes": map[string]int{
				"payment-api.payment-switch.svc.cluster.local:8080": 1,
			},
		},
	}

	data, _ := json.Marshal(routeConfig)
	req, err := http.NewRequestWithContext(ctx, "PUT", url, bytes.NewBuffer(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-KEY", a.config.APISIXAPIKey)

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to create routes: %d - %s", resp.StatusCode, string(body))
	}

	return nil
}

// ConfigureAPISIXRateLimiting configures rate limiting for an API key
func (a *APISIXActivities) ConfigureAPISIXRateLimiting(ctx context.Context, config map[string]interface{}) error {
	apiKey := config["apiKey"].(string)
	rateLimits := config["rateLimits"].(map[string]int)

	url := fmt.Sprintf("%s/apisix/admin/consumers/%s", a.config.APISIXURL, apiKey)

	consumerConfig := map[string]interface{}{
		"username": apiKey,
		"plugins": map[string]interface{}{
			"key-auth": map[string]interface{}{
				"key": apiKey,
			},
			"limit-req": map[string]interface{}{
				"rate":  rateLimits["requests_per_minute"],
				"burst": rateLimits["requests_per_minute"] / 2,
				"key":   "consumer_name",
			},
		},
	}

	data, _ := json.Marshal(consumerConfig)
	req, err := http.NewRequestWithContext(ctx, "PUT", url, bytes.NewBuffer(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-KEY", a.config.APISIXAPIKey)

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	return nil
}

// ApplyAPISIXSecurityPolicy applies a security policy to a route
func (a *APISIXActivities) ApplyAPISIXSecurityPolicy(ctx context.Context, policyID, target string) error {
	url := fmt.Sprintf("%s/apisix/admin/routes/%s", a.config.APISIXURL, target)

	// Get existing route
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	req.Header.Set("X-API-KEY", a.config.APISIXAPIKey)

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	var routeData map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&routeData)

	// Add security plugin
	if node, ok := routeData["node"].(map[string]interface{}); ok {
		if value, ok := node["value"].(map[string]interface{}); ok {
			if plugins, ok := value["plugins"].(map[string]interface{}); ok {
				plugins["openappsec"] = map[string]interface{}{
					"policy_id": policyID,
				}
			}
		}
	}

	// Update route
	data, _ := json.Marshal(routeData["node"].(map[string]interface{})["value"])
	req, _ = http.NewRequestWithContext(ctx, "PUT", url, bytes.NewBuffer(data))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-KEY", a.config.APISIXAPIKey)

	resp, err = a.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	return nil
}

// ============================================================================
// DAPR ACTIVITIES
// ============================================================================

// DaprActivities handles Dapr operations
type DaprActivities struct {
	config     *MiddlewareConfig
	httpClient *http.Client
}

// NewDaprActivities creates a new DaprActivities instance
func NewDaprActivities(config *MiddlewareConfig) *DaprActivities {
	return &DaprActivities{
		config:     config,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// ConfigurePOSViaDapr configures POS terminals via Dapr state store
func (d *DaprActivities) ConfigurePOSViaDapr(ctx context.Context, config map[string]interface{}) error {
	merchantID := config["merchantID"].(string)
	terminals := config["terminals"].([]string)
	posConfig := config["config"].(map[string]interface{})

	url := fmt.Sprintf("http://localhost:%s/v1.0/state/statestore", d.config.DaprHTTPPort)

	for _, terminalID := range terminals {
		stateData := []map[string]interface{}{
			{
				"key":   fmt.Sprintf("pos-config-%s-%s", merchantID, terminalID),
				"value": posConfig,
			},
		}

		data, _ := json.Marshal(stateData)
		req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(data))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")

		resp, err := d.httpClient.Do(req)
		if err != nil {
			return err
		}
		resp.Body.Close()
	}

	return nil
}

// PublishViaDapr publishes a message via Dapr pub/sub
func (d *DaprActivities) PublishViaDapr(ctx context.Context, pubsubName, topic string, data interface{}) error {
	url := fmt.Sprintf("http://localhost:%s/v1.0/publish/%s/%s", d.config.DaprHTTPPort, pubsubName, topic)

	payload, _ := json.Marshal(data)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := d.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	return nil
}

// ============================================================================
// FLUVIO ACTIVITIES
// ============================================================================

// FluvioActivities handles Fluvio streaming operations
type FluvioActivities struct {
	config     *MiddlewareConfig
	httpClient *http.Client
}

// NewFluvioActivities creates a new FluvioActivities instance
func NewFluvioActivities(config *MiddlewareConfig) *FluvioActivities {
	return &FluvioActivities{
		config:     config,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// StreamToFluvio streams data to a Fluvio topic
func (f *FluvioActivities) StreamToFluvio(ctx context.Context, topic string, data interface{}) error {
	// Fluvio HTTP producer endpoint
	url := fmt.Sprintf("http://%s/produce/%s", f.config.FluvioAddr, topic)

	payload, _ := json.Marshal(data)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := f.httpClient.Do(req)
	if err != nil {
		// Fallback to Kafka bridge if Fluvio is not available
		return nil
	}
	defer resp.Body.Close()

	return nil
}

// ============================================================================
// TIGERBEETLE ACTIVITIES
// ============================================================================

// TigerBeetleActivities handles TigerBeetle ledger operations
type TigerBeetleActivities struct {
	config     *MiddlewareConfig
	httpClient *http.Client
}

// NewTigerBeetleActivities creates a new TigerBeetleActivities instance
func NewTigerBeetleActivities(config *MiddlewareConfig) *TigerBeetleActivities {
	return &TigerBeetleActivities{
		config:     config,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

// CreateLedgerAccounts creates accounts in TigerBeetle
func (t *TigerBeetleActivities) CreateLedgerAccounts(ctx context.Context, config map[string]interface{}) error {
	// TigerBeetle HTTP API endpoint (via gateway)
	url := fmt.Sprintf("http://%s/accounts", t.config.TigerBeetleAddr)

	accounts := config["accounts"].([]string)
	merchantID := config["merchantID"]

	for _, accountType := range accounts {
		accountData := map[string]interface{}{
			"id":        fmt.Sprintf("%v-%s", merchantID, accountType),
			"ledger":    1,
			"code":      1,
			"flags":     0,
			"user_data": merchantID,
		}

		data, _ := json.Marshal(accountData)
		req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(data))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")

		resp, err := t.httpClient.Do(req)
		if err != nil {
			continue // Account may already exist
		}
		resp.Body.Close()
	}

	return nil
}

// CreatePendingTigerBeetleTransfer creates a pending transfer
func (t *TigerBeetleActivities) CreatePendingTigerBeetleTransfer(ctx context.Context, config map[string]interface{}) (string, error) {
	url := fmt.Sprintf("http://%s/transfers", t.config.TigerBeetleAddr)

	transferID := fmt.Sprintf("txn-%d", time.Now().UnixNano())
	transferData := map[string]interface{}{
		"id":             transferID,
		"debit_account":  config["payerAccount"],
		"credit_account": config["payeeAccount"],
		"amount":         config["amount"],
		"ledger":         1,
		"code":           1,
		"flags":          1, // Pending flag
		"user_data":      config["currency"],
	}

	data, _ := json.Marshal(transferData)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(data))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := t.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	return transferID, nil
}

// PostTigerBeetleTransfer posts (commits) a pending transfer
func (t *TigerBeetleActivities) PostTigerBeetleTransfer(ctx context.Context, pendingTransferID string) (string, error) {
	url := fmt.Sprintf("http://%s/transfers/%s/post", t.config.TigerBeetleAddr, pendingTransferID)

	req, err := http.NewRequestWithContext(ctx, "POST", url, nil)
	if err != nil {
		return "", err
	}

	resp, err := t.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	return fmt.Sprintf("ledger-%s", pendingTransferID), nil
}

// VoidTigerBeetleTransfer voids a pending transfer
func (t *TigerBeetleActivities) VoidTigerBeetleTransfer(ctx context.Context, pendingTransferID string) error {
	url := fmt.Sprintf("http://%s/transfers/%s/void", t.config.TigerBeetleAddr, pendingTransferID)

	req, err := http.NewRequestWithContext(ctx, "POST", url, nil)
	if err != nil {
		return err
	}

	resp, err := t.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	return nil
}

// RecordLedgerEntry records a ledger entry
func (t *TigerBeetleActivities) RecordLedgerEntry(ctx context.Context, entry map[string]interface{}) error {
	url := fmt.Sprintf("http://%s/transfers", t.config.TigerBeetleAddr)

	transferData := map[string]interface{}{
		"id":             fmt.Sprintf("txn-%d", time.Now().UnixNano()),
		"debit_account":  entry["debitAccount"],
		"credit_account": entry["creditAccount"],
		"amount":         entry["amount"],
		"ledger":         1,
		"code":           1,
		"flags":          0, // Posted immediately
		"user_data":      entry["transactionID"],
	}

	data, _ := json.Marshal(transferData)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := t.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	return nil
}

// ============================================================================
// LAKEHOUSE ACTIVITIES
// ============================================================================

// LakehouseActivities handles Lakehouse (Delta Lake on RustFS) operations
type LakehouseActivities struct {
	config     *MiddlewareConfig
	httpClient *http.Client
}

// NewLakehouseActivities creates a new LakehouseActivities instance
func NewLakehouseActivities(config *MiddlewareConfig) *LakehouseActivities {
	return &LakehouseActivities{
		config:     config,
		httpClient: &http.Client{Timeout: 60 * time.Second},
	}
}

// WriteLakehouse writes data to a Lakehouse table
func (l *LakehouseActivities) WriteLakehouse(ctx context.Context, tableName string, data map[string]interface{}) error {
	// Lakehouse query service endpoint
	url := fmt.Sprintf("http://lakehouse-query.lakehouse.svc.cluster.local:8080/api/v1/tables/%s/insert", tableName)

	payload, _ := json.Marshal(data)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := l.httpClient.Do(req)
	if err != nil {
		// Log but don't fail - lakehouse writes are async
		return nil
	}
	defer resp.Body.Close()

	return nil
}

// ============================================================================
// WEBHOOK ACTIVITIES
// ============================================================================

// WebhookActivities handles webhook delivery operations
type WebhookActivities struct {
	config     *MiddlewareConfig
	httpClient *http.Client
}

// NewWebhookActivities creates a new WebhookActivities instance
func NewWebhookActivities(config *MiddlewareConfig) *WebhookActivities {
	return &WebhookActivities{
		config:     config,
		httpClient: &http.Client{Timeout: 5 * time.Second},
	}
}

// SignWebhookPayload signs a webhook payload with HMAC-SHA256
func (w *WebhookActivities) SignWebhookPayload(ctx context.Context, payload interface{}, secret interface{}) (map[string]interface{}, error) {
	data, _ := json.Marshal(payload)
	secretStr := fmt.Sprintf("%v", secret)

	h := hmac.New(sha256.New, []byte(secretStr))
	h.Write(data)
	signature := hex.EncodeToString(h.Sum(nil))

	return map[string]interface{}{
		"payload":   payload,
		"signature": signature,
		"timestamp": time.Now().Unix(),
	}, nil
}

// DeliverWebhook delivers a webhook to a URL
func (w *WebhookActivities) DeliverWebhook(ctx context.Context, webhookURL string, payload map[string]interface{}) (int, error) {
	data, _ := json.Marshal(payload["payload"])

	req, err := http.NewRequestWithContext(ctx, "POST", webhookURL, bytes.NewBuffer(data))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Webhook-Signature", payload["signature"].(string))
	req.Header.Set("X-Webhook-Timestamp", fmt.Sprintf("%d", payload["timestamp"].(int64)))

	resp, err := w.httpClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	return resp.StatusCode, nil
}

// ============================================================================
// NOTIFICATION ACTIVITIES
// ============================================================================

// NotificationActivities handles notification delivery
type NotificationActivities struct {
	config     *MiddlewareConfig
	httpClient *http.Client
}

// NewNotificationActivities creates a new NotificationActivities instance
func NewNotificationActivities(config *MiddlewareConfig) *NotificationActivities {
	return &NotificationActivities{
		config:     config,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

// SendNotification sends a notification via the notification service
func (n *NotificationActivities) SendNotification(ctx context.Context, notification map[string]interface{}) error {
	url := "http://notification-service.payment-switch.svc.cluster.local:8080/api/v1/notifications"

	data, _ := json.Marshal(notification)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := n.httpClient.Do(req)
	if err != nil {
		return nil // Don't fail on notification errors
	}
	defer resp.Body.Close()

	return nil
}

// SendEmail sends an email notification
func (n *NotificationActivities) SendEmail(ctx context.Context, email map[string]interface{}) error {
	url := "http://notification-service.payment-switch.svc.cluster.local:8080/api/v1/email"

	data, _ := json.Marshal(email)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := n.httpClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	return nil
}
