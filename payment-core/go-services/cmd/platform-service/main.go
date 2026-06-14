// Package main provides the unified entry point for the payment switch platform
// This service wires together all internal packages into a single deployable binary
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/payment-switch/go-services/internal/integration"
	"github.com/payment-switch/go-services/pkg/middleware"
)

var port = getEnv("PLATFORM_PORT", "8081")

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func main() {
	log.Printf("[platform-service] Starting on port %s", port)

	// Initialize service mesh (connects all middleware)
	meshCfg := integration.DefaultServiceMeshConfig()
	mesh := integration.NewServiceMesh(meshCfg)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := mesh.Initialize(ctx); err != nil {
		log.Printf("[platform-service] Warning: partial initialization: %v", err)
	}

	// Health checker
	healthCfg := integration.DefaultMiddlewareHealthConfig()
	health := integration.NewMiddlewareHealth(healthCfg)

	// HTTP routes
	mux := http.NewServeMux()

	// Health endpoint
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "service": "platform-service"})
	})

	// Middleware health check
	mux.HandleFunc("/health/middleware", health.HTTPHandler())

	// Smoke test endpoint
	mux.HandleFunc("/smoke-test", func(w http.ResponseWriter, r *http.Request) {
		report, err := mesh.RunSmokeTests(r.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(report)
	})

	// Seed data endpoint
	mux.HandleFunc("/admin/seed", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST required", http.StatusMethodNotAllowed)
			return
		}
		seeder := integration.NewSeedDataService(nil)
		results, err := seeder.SeedAll(r.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		data, _ := seeder.ToJSON(results)
		w.Header().Set("Content-Type", "application/json")
		w.Write(data)
	})

	// RBAC auth middleware — skips health endpoints
	rbac := middleware.NewRBACMiddleware(&middleware.RBACConfig{
		JWTSecret:          getEnv("JWT_SECRET", "payment-switch-secret"),
		JWTIssuer:          getEnv("JWT_ISSUER", "payment-switch"),
		SkipPaths:          []string{"/health", "/smoke-test"},
		EnableAuditLogging: true,
	})

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      rbac.Authenticate(mux),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("[platform-service] Shutting down...")
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()
		server.Shutdown(shutdownCtx)
	}()

	log.Printf("[platform-service] Listening on :%s", port)
	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("[platform-service] Server error: %v", err)
	}
}
