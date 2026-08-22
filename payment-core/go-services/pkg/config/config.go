// Package config provides environment variable validation and configuration management
// Recommendation #3: Enforce Environment Variable Validation (fail-fast)
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds all application configuration
type Config struct {
	// Server
	ServerPort      int
	ServerHost      string
	Environment     string
	IntegrationMode string // "real" or "simulated"

	// Database
	DatabaseURL      string
	DatabaseMaxConns int
	DatabaseTimeout  time.Duration

	// Redis
	RedisURL      string
	RedisPassword string

	// Kafka
	KafkaBrokers []string
	KafkaGroupID string

	// Keycloak
	KeycloakURL          string
	KeycloakRealm        string
	KeycloakClientID     string
	KeycloakClientSecret string

	// APISIX
	APISIXAdminURL string
	APISIXAdminKey string

	// TigerBeetle
	TigerBeetleAddresses []string
	TigerBeetleClusterID uint64

	// Mojaloop
	MojaloopCentralLedgerURL string
	MojaloopAccountLookupURL string

	// Secrets
	JWTSecret         string
	EncryptionKey     string
	WebhookSigningKey string

	// Feature Flags
	EnableRealIntegrations bool
	EnableAuditLogging     bool
	EnableRateLimiting     bool
	EnableTracing          bool
}

// ValidationError represents a configuration validation error
type ValidationError struct {
	Field   string
	Message string
}

func (e ValidationError) Error() string {
	return fmt.Sprintf("config validation error: %s - %s", e.Field, e.Message)
}

// ValidationErrors is a collection of validation errors
type ValidationErrors []ValidationError

func (e ValidationErrors) Error() string {
	var msgs []string
	for _, err := range e {
		msgs = append(msgs, err.Error())
	}
	return strings.Join(msgs, "; ")
}

// Load loads and validates configuration from environment variables
// Returns an error if any required configuration is missing or invalid
func Load() (*Config, error) {
	cfg := &Config{}
	var errors ValidationErrors

	// Server configuration
	cfg.ServerPort = getEnvInt("SERVER_PORT", 8080)
	cfg.ServerHost = getEnv("SERVER_HOST", "0.0.0.0")
	cfg.Environment = getEnv("ENVIRONMENT", "development")
	cfg.IntegrationMode = getEnv("INTEGRATION_MODE", "simulated")

	// Database - REQUIRED
	cfg.DatabaseURL = getEnv("DATABASE_URL", "")
	if cfg.DatabaseURL == "" {
		errors = append(errors, ValidationError{
			Field:   "DATABASE_URL",
			Message: "required environment variable is not set",
		})
	}
	cfg.DatabaseMaxConns = getEnvInt("DATABASE_MAX_CONNS", 25)
	cfg.DatabaseTimeout = time.Duration(getEnvInt("DATABASE_TIMEOUT_SECONDS", 30)) * time.Second

	// Redis
	cfg.RedisURL = getEnv("REDIS_URL", "")
	cfg.RedisPassword = getEnv("REDIS_PASSWORD", "")

	// Kafka
	kafkaBrokers := getEnv("KAFKA_BROKERS", "")
	if kafkaBrokers != "" {
		cfg.KafkaBrokers = strings.Split(kafkaBrokers, ",")
	}
	cfg.KafkaGroupID = getEnv("KAFKA_GROUP_ID", "payment-switch")

	// Keycloak
	cfg.KeycloakURL = getEnv("KEYCLOAK_URL", "")
	cfg.KeycloakRealm = getEnv("KEYCLOAK_REALM", "payment-switch")
	cfg.KeycloakClientID = getEnv("KEYCLOAK_CLIENT_ID", "")
	cfg.KeycloakClientSecret = getEnv("KEYCLOAK_CLIENT_SECRET", "")

	// APISIX
	cfg.APISIXAdminURL = getEnv("APISIX_ADMIN_URL", "")
	cfg.APISIXAdminKey = getEnv("APISIX_ADMIN_KEY", "")

	// TigerBeetle
	tbAddresses := getEnv("TIGERBEETLE_ADDRESSES", "")
	if tbAddresses != "" {
		cfg.TigerBeetleAddresses = strings.Split(tbAddresses, ",")
	}
	cfg.TigerBeetleClusterID = uint64(getEnvInt("TIGERBEETLE_CLUSTER_ID", 0))

	// Mojaloop
	cfg.MojaloopCentralLedgerURL = getEnv("MOJALOOP_CENTRAL_LEDGER_URL", "")
	cfg.MojaloopAccountLookupURL = getEnv("MOJALOOP_ACCOUNT_LOOKUP_URL", "")

	// Secrets - REQUIRED in production
	cfg.JWTSecret = getEnv("JWT_SECRET", "")
	cfg.EncryptionKey = getEnv("ENCRYPTION_KEY", "")
	cfg.WebhookSigningKey = getEnv("WEBHOOK_SIGNING_KEY", "")

	// Validate secrets in production
	if cfg.Environment == "production" {
		if cfg.JWTSecret == "" {
			errors = append(errors, ValidationError{
				Field:   "JWT_SECRET",
				Message: "required in production environment",
			})
		}
		if cfg.EncryptionKey == "" {
			errors = append(errors, ValidationError{
				Field:   "ENCRYPTION_KEY",
				Message: "required in production environment",
			})
		}
		if len(cfg.JWTSecret) < 32 {
			errors = append(errors, ValidationError{
				Field:   "JWT_SECRET",
				Message: "must be at least 32 characters",
			})
		}
		if len(cfg.EncryptionKey) < 32 {
			errors = append(errors, ValidationError{
				Field:   "ENCRYPTION_KEY",
				Message: "must be at least 32 characters",
			})
		}
		if len(cfg.WebhookSigningKey) < 32 {
			errors = append(errors, ValidationError{
				Field:   "WEBHOOK_SIGNING_KEY",
				Message: "must be at least 32 characters",
			})
		}
	}

	// Feature flags
	cfg.EnableRealIntegrations = getEnvBool("ENABLE_REAL_INTEGRATIONS", false)
	cfg.EnableAuditLogging = getEnvBool("ENABLE_AUDIT_LOGGING", true)
	cfg.EnableRateLimiting = getEnvBool("ENABLE_RATE_LIMITING", true)
	cfg.EnableTracing = getEnvBool("ENABLE_TRACING", true)

	// Recommendation #6: Hard runtime guard for simulated vs real mode
	if cfg.Environment == "production" && !cfg.EnableRealIntegrations {
		errors = append(errors, ValidationError{
			Field:   "ENABLE_REAL_INTEGRATIONS",
			Message: "must be true in production environment - simulated mode not allowed",
		})
	}

	// Validate integration dependencies when real integrations are enabled
	if cfg.EnableRealIntegrations {
				if cfg.RedisURL == "" {
			errors = append(errors, ValidationError{
			Field:   "REDIS_URL",
			Message: "required in production when distributed security controls are enabled",
		})
		}
		if cfg.KeycloakURL == "" {
			errors = append(errors, ValidationError{

				Field:   "KEYCLOAK_URL",
				Message: "required when ENABLE_REAL_INTEGRATIONS is true",
			})
		}
		if cfg.APISIXAdminURL == "" {
			errors = append(errors, ValidationError{
				Field:   "APISIX_ADMIN_URL",
				Message: "required when ENABLE_REAL_INTEGRATIONS is true",
			})
		}
		if cfg.APISIXAdminKey == "" {
			errors = append(errors, ValidationError{
				Field:   "APISIX_ADMIN_KEY",
				Message: "required when ENABLE_REAL_INTEGRATIONS is true",
			})
		}
		if cfg.KeycloakClientID == "" {
			errors = append(errors, ValidationError{
				Field:   "KEYCLOAK_CLIENT_ID",
				Message: "required when ENABLE_REAL_INTEGRATIONS is true",
			})
		}
		if len(cfg.TigerBeetleAddresses) < 3 {
			errors = append(errors, ValidationError{
				Field:   "TIGERBEETLE_ADDRESSES",
				Message: "at least three distinct replica addresses are required for production",
			})
		}
		if cfg.TigerBeetleClusterID == 0 {
			errors = append(errors, ValidationError{
				Field:   "TIGERBEETLE_CLUSTER_ID",
				Message: "must be non-zero when ENABLE_REAL_INTEGRATIONS is true",
			})
		}
	}

	if len(errors) > 0 {
		return nil, errors
	}

	return cfg, nil
}

// MustLoad loads configuration and panics on error
// Use this in main() for fail-fast behavior
func MustLoad() *Config {
	cfg, err := Load()
	if err != nil {
		panic(fmt.Sprintf("Failed to load configuration: %v", err))
	}
	return cfg
}

// IsProduction returns true if running in production environment
func (c *Config) IsProduction() bool {
	return c.Environment == "production"
}

// IsSimulatedMode returns true if running in simulated integration mode
func (c *Config) IsSimulatedMode() bool {
	return !c.EnableRealIntegrations
}

// Helper functions

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}

func getEnvBool(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		if boolValue, err := strconv.ParseBool(value); err == nil {
			return boolValue
		}
	}
	return defaultValue
}
