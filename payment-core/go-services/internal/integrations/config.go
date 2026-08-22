// Package integrations provides production-ready external system integrations
// This file implements production configuration and environment validation
package integrations

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// ProductionConfig holds all configuration for production integrations
type ProductionConfig struct {
	// Environment mode
	Environment string // production, staging, development

	// TigerBeetle configuration
	TigerBeetle TigerBeetleConfig

	// Mojaloop configuration
	Mojaloop MojaloopConfig

	// Keycloak configuration
	Keycloak KeycloakConfig

	// APISIX configuration
	APISIX APISIXConfig

	// Health checker configuration
	HealthChecker HealthCheckerConfig

	// Feature flags
	Features FeatureFlags
}

// FeatureFlags controls which features are enabled
type FeatureFlags struct {
	EnableTigerBeetle bool
	EnableMojaloop    bool
	EnableKeycloak    bool
	EnableAPISIX      bool
	EnableHealthCheck bool
	SimulatedMode     bool // If true, use simulated integrations
}

// LoadProductionConfig loads configuration from environment variables
func LoadProductionConfig() (*ProductionConfig, error) {
	config := &ProductionConfig{
		Environment: getEnvOrDefault("ENVIRONMENT", "development"),
	}

		// Load TigerBeetle config. Development keeps a lightweight default; staging and
		// production are validated below and must provide explicit cluster identity.
		config.TigerBeetle = TigerBeetleConfig{
			Addresses:    strings.Split(getEnvOrDefault("TIGERBEETLE_ADDRESSES", "tigerbeetle:3000"), ","),
			ClusterID:    getEnvAsUint64("TIGERBEETLE_CLUSTER_ID", 0),
		ReadTimeout:  getEnvAsDuration("TIGERBEETLE_READ_TIMEOUT", 30*time.Second),
		WriteTimeout: getEnvAsDuration("TIGERBEETLE_WRITE_TIMEOUT", 30*time.Second),
		RetryCount:   getEnvAsInt("TIGERBEETLE_RETRY_COUNT", 3),
		RetryDelay:   getEnvAsDuration("TIGERBEETLE_RETRY_DELAY", 100*time.Millisecond),
	}

	// Load Mojaloop config
	config.Mojaloop = MojaloopConfig{
		CentralLedgerURL:  getEnvOrDefault("MOJALOOP_CENTRAL_LEDGER_URL", "http://central-ledger:3001"),
		ALSURL:            getEnvOrDefault("MOJALOOP_ALS_URL", "http://account-lookup-service:4002"),
		QuotingServiceURL: getEnvOrDefault("MOJALOOP_QUOTING_URL", "http://quoting-service:3002"),
		MLAPIAdapterURL:   getEnvOrDefault("MOJALOOP_ML_API_ADAPTER_URL", "http://ml-api-adapter:3000"),
		FSPID:             getEnvOrDefault("MOJALOOP_FSP_ID", "paymentswitch"),
		HubName:           getEnvOrDefault("MOJALOOP_HUB_NAME", "Hub"),
		Timeout:           getEnvAsDuration("MOJALOOP_TIMEOUT", 30*time.Second),
		TLSEnabled:        getEnvAsBool("MOJALOOP_TLS_ENABLED", false),
		TLSCert:           os.Getenv("MOJALOOP_TLS_CERT"),
		TLSKey:            os.Getenv("MOJALOOP_TLS_KEY"),
	}

	// Load Keycloak config
	config.Keycloak = KeycloakConfig{
		BaseURL:       getEnvOrDefault("KEYCLOAK_URL", "http://keycloak:8080"),
		Realm:         getEnvOrDefault("KEYCLOAK_REALM", "payment-switch"),
		AdminUsername: getEnvOrDefault("KEYCLOAK_ADMIN_USER", "admin"),
		AdminPassword: os.Getenv("KEYCLOAK_ADMIN_PASSWORD"),
		ClientID:      getEnvOrDefault("KEYCLOAK_CLIENT_ID", "admin-cli"),
		ClientSecret:  os.Getenv("KEYCLOAK_CLIENT_SECRET"),
		Timeout:       getEnvAsDuration("KEYCLOAK_TIMEOUT", 30*time.Second),
	}

	// Load APISIX config
	config.APISIX = APISIXConfig{
		AdminURL: getEnvOrDefault("APISIX_ADMIN_URL", "http://apisix:9180"),
		APIKey:   getEnvOrDefault("APISIX_API_KEY", ""),
		Timeout:  getEnvAsDuration("APISIX_TIMEOUT", 30*time.Second),
	}

	// Load health checker config
	config.HealthChecker = HealthCheckerConfig{
		CheckInterval: getEnvAsDuration("HEALTH_CHECK_INTERVAL", 30*time.Second),
		Timeout:       getEnvAsDuration("HEALTH_CHECK_TIMEOUT", 10*time.Second),
	}

	// Load feature flags
	config.Features = FeatureFlags{
		EnableTigerBeetle: getEnvAsBool("ENABLE_TIGERBEETLE", true),
		EnableMojaloop:    getEnvAsBool("ENABLE_MOJALOOP", true),
		EnableKeycloak:    getEnvAsBool("ENABLE_KEYCLOAK", true),
		EnableAPISIX:      getEnvAsBool("ENABLE_APISIX", true),
		EnableHealthCheck: getEnvAsBool("ENABLE_HEALTH_CHECK", true),
		SimulatedMode:     getEnvAsBool("SIMULATED_MODE", false),
	}

	return config, nil
}

// Validate validates the configuration
func (c *ProductionConfig) Validate() error {
	var errors []string

	// Validate environment
	validEnvs := map[string]bool{"production": true, "staging": true, "development": true}
	if !validEnvs[c.Environment] {
		errors = append(errors, fmt.Sprintf("invalid environment: %s", c.Environment))
	}

	// Production-specific validations
		if c.Environment == "production" || c.Environment == "staging" {
			// TigerBeetle validation. Defaults are intentionally not acceptable for
			// deployed environments: a wrong endpoint can make a service look ready
			// while all ledger writes fail at runtime.
			if c.Features.EnableTigerBeetle && !c.Features.SimulatedMode {
				if strings.TrimSpace(os.Getenv("TIGERBEETLE_ADDRESSES")) == "" {
					errors = append(errors, "TIGERBEETLE_ADDRESSES must be explicitly configured in staging/production")
				}
				if strings.TrimSpace(os.Getenv("TIGERBEETLE_CLUSTER_ID")) == "" {
					errors = append(errors, "TIGERBEETLE_CLUSTER_ID must be explicitly configured in staging/production")
				}
				if len(c.TigerBeetle.Addresses) == 0 {
					errors = append(errors, "TIGERBEETLE_ADDRESSES must contain at least one address")
				}
				for _, address := range c.TigerBeetle.Addresses {
					parts := strings.Split(strings.TrimSpace(address), ":")
					if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" {
						errors = append(errors, fmt.Sprintf("invalid TigerBeetle address %q; expected host:port", address))
						continue
					}
					port, parseErr := strconv.Atoi(parts[1])
					if parseErr != nil || port < 1 || port > 65535 {
						errors = append(errors, fmt.Sprintf("invalid TigerBeetle port in address %q", address))
					}
				}
			}

		// Keycloak validation
		if c.Features.EnableKeycloak && !c.Features.SimulatedMode {
			if c.Keycloak.AdminPassword == "" {
				errors = append(errors, "KEYCLOAK_ADMIN_PASSWORD is required in production")
			}
		}

		// APISIX validation
		if c.Features.EnableAPISIX && !c.Features.SimulatedMode {
			if c.APISIX.APIKey == "" {
				errors = append(errors, "APISIX_API_KEY is required in production")
			}
		}

		// Simulated mode should not be enabled in production
		if c.Features.SimulatedMode {
			errors = append(errors, "SIMULATED_MODE should not be enabled in production")
		}
	}

	if len(errors) > 0 {
		return fmt.Errorf("configuration validation failed:\n  - %s", strings.Join(errors, "\n  - "))
	}

	return nil
}

// IsProduction returns true if running in production mode
func (c *ProductionConfig) IsProduction() bool {
	return c.Environment == "production"
}

// IsSimulated returns true if running in simulated mode
func (c *ProductionConfig) IsSimulated() bool {
	return c.Features.SimulatedMode
}

// GetProvisioningMode returns the appropriate provisioning mode
func (c *ProductionConfig) GetProvisioningMode() ProvisioningMode {
	if c.Features.SimulatedMode {
		return ModeSimulated
	}
	if c.Environment == "production" {
		return ModeProduction
	}
	return ModeSimulated
}

// Helper functions for environment variable parsing

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvAsInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}

func getEnvAsUint64(key string, defaultValue uint64) uint64 {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.ParseUint(value, 10, 64); err == nil {
			return intValue
		}
	}
	return defaultValue
}

func getEnvAsBool(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		if boolValue, err := strconv.ParseBool(value); err == nil {
			return boolValue
		}
	}
	return defaultValue
}

func getEnvAsDuration(key string, defaultValue time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		if duration, err := time.ParseDuration(value); err == nil {
			return duration
		}
	}
	return defaultValue
}

// IntegrationManager manages all production integrations
type IntegrationManager struct {
	Config        *ProductionConfig
	TigerBeetle   *ProductionTigerBeetleClient
	Mojaloop      *ProductionMojaloopClient
	Keycloak      *ProductionKeycloakClient
	APISIX        *ProductionAPISIXClient
	HealthChecker *ProductionHealthChecker
	Orchestrator  *ProductionProvisioningOrchestrator
}

// NewIntegrationManager creates a new integration manager from config
func NewIntegrationManager(config *ProductionConfig) (*IntegrationManager, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}

	manager := &IntegrationManager{
		Config: config,
	}

	// Initialize TigerBeetle client
	if config.Features.EnableTigerBeetle {
		manager.TigerBeetle = NewProductionTigerBeetleClient(&config.TigerBeetle)
	}

	// Initialize Mojaloop client
	if config.Features.EnableMojaloop {
		manager.Mojaloop = NewProductionMojaloopClient(&config.Mojaloop)
	}

	// Initialize Keycloak client
	if config.Features.EnableKeycloak {
		manager.Keycloak = NewProductionKeycloakClient(&config.Keycloak)
	}

	// Initialize APISIX client
	if config.Features.EnableAPISIX {
		manager.APISIX = NewProductionAPISIXClient(&config.APISIX)
	}

	// Initialize health checker
	if config.Features.EnableHealthCheck {
		manager.HealthChecker = NewProductionHealthChecker(
			manager.TigerBeetle,
			manager.Mojaloop,
			manager.Keycloak,
			manager.APISIX,
			&config.HealthChecker,
		)
	}

	// Initialize provisioning orchestrator
	manager.Orchestrator = NewProductionProvisioningOrchestrator(
		manager.TigerBeetle,
		manager.Mojaloop,
		manager.Keycloak,
		manager.APISIX,
		manager.HealthChecker,
	)

	return manager, nil
}

// Start starts all background services
func (m *IntegrationManager) Start() {
	if m.HealthChecker != nil {
		m.HealthChecker.Start()
	}
}

// Stop stops all background services
func (m *IntegrationManager) Stop() {
	if m.HealthChecker != nil {
		m.HealthChecker.Stop()
	}

	if m.TigerBeetle != nil {
		m.TigerBeetle.Disconnect()
	}
}

// GetStatus returns the current status of all integrations
func (m *IntegrationManager) GetStatus() map[string]interface{} {
	status := map[string]interface{}{
		"environment":    m.Config.Environment,
		"simulated_mode": m.Config.Features.SimulatedMode,
	}

	if m.HealthChecker != nil {
		status["health"] = m.HealthChecker.GetOverallHealth()
	}

	status["features"] = map[string]bool{
		"tigerbeetle":  m.Config.Features.EnableTigerBeetle,
		"mojaloop":     m.Config.Features.EnableMojaloop,
		"keycloak":     m.Config.Features.EnableKeycloak,
		"apisix":       m.Config.Features.EnableAPISIX,
		"health_check": m.Config.Features.EnableHealthCheck,
	}

	return status
}
