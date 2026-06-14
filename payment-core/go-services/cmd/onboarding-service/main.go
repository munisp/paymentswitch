// Package main provides the HTTP server for the onboarding service
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	. "github.com/payment-switch/go-services/internal/onboarding"
	"github.com/payment-switch/go-services/pkg/middleware"
)

// OnboardingServer is the main HTTP server
type OnboardingServer struct {
	service     *OnboardingService
	integration *IntegrationManager
	port        int
}

// NewOnboardingServer creates a new onboarding server
func NewOnboardingServer(port int) *OnboardingServer {
	config := DefaultIntegrationConfig()
	emitter := NewKafkaEventEmitter(config.Kafka)

	return &OnboardingServer{
		service:     NewOnboardingService(emitter),
		integration: NewIntegrationManager(config),
		port:        port,
	}
}

// Start starts the HTTP server
func (s *OnboardingServer) Start() error {
	mux := http.NewServeMux()

	// Health check
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/ready", s.handleReady)

	// Templates
	mux.HandleFunc("/api/v1/onboarding/templates", s.handleTemplates)

	// Cases - CRUD
	mux.HandleFunc("/api/v1/onboarding/cases", s.handleCases)

	// Case operations (using path prefix matching)
	mux.HandleFunc("/api/v1/onboarding/cases/", s.handleCaseOperations)

	// Stats
	mux.HandleFunc("/api/v1/onboarding/stats", s.handleStats)

	// RBAC auth middleware — skips health/ready endpoints
	rbac := middleware.NewRBACMiddleware(&middleware.RBACConfig{
		JWTSecret:          os.Getenv("JWT_SECRET"),
		JWTIssuer:          "payment-switch",
		SkipPaths:          []string{"/health", "/ready"},
		EnableAuditLogging: true,
	})

	// CORS + Auth middleware
	handler := corsMiddleware(rbac.Authenticate(mux))

	server := &http.Server{
		Addr:         fmt.Sprintf(":%d", s.port),
		Handler:      handler,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown
	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
		<-sigChan

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		log.Println("Shutting down server...")
		server.Shutdown(ctx)
	}()

	log.Printf("Onboarding service starting on port %d", s.port)
	return server.ListenAndServe()
}

// allowedOrigins returns the CORS allowed origins from environment or defaults
func allowedOrigins() []string {
	if origins := os.Getenv("CORS_ALLOWED_ORIGINS"); origins != "" {
		return strings.Split(origins, ",")
	}
	return []string{"https://app.paymentswitch.ng", "https://admin.paymentswitch.ng"}
}

// CORS middleware — restricted to configured origins (no wildcard)
func corsMiddleware(next http.Handler) http.Handler {
	allowed := allowedOrigins()
	allowedSet := make(map[string]bool, len(allowed))
	for _, o := range allowed {
		allowedSet[strings.TrimSpace(o)] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if allowedSet[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Max-Age", "86400")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// handleHealth handles health check
func (s *OnboardingServer) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "healthy"})
}

// handleReady handles readiness check
func (s *OnboardingServer) handleReady(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

// handleTemplates handles template operations
func (s *OnboardingServer) handleTemplates(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Check for specific template type
	stakeholderType := r.URL.Query().Get("type")
	if stakeholderType != "" {
		template, err := s.service.GetTemplate(StakeholderType(stakeholderType))
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, template)
		return
	}

	// Return all templates
	templates := s.service.GetAllTemplates()
	response := make([]map[string]interface{}, 0)
	for _, t := range templates {
		response = append(response, map[string]interface{}{
			"stakeholder_type":    string(t.StakeholderType),
			"name":                t.Name,
			"description":         t.Description,
			"requirement_count":   len(t.Requirements),
			"approval_steps":      len(t.ApprovalSteps),
			"certification_level": t.CertificationLevel,
			"estimated_days":      t.EstimatedDays,
		})
	}
	writeJSON(w, http.StatusOK, response)
}

// handleCases handles case listing and creation
func (s *OnboardingServer) handleCases(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	switch r.Method {
	case http.MethodGet:
		filters := CaseFilters{
			StakeholderType: StakeholderType(r.URL.Query().Get("stakeholder_type")),
			Status:          OnboardingStatus(r.URL.Query().Get("status")),
			Jurisdiction:    r.URL.Query().Get("jurisdiction"),
		}

		cases, err := s.service.ListCases(ctx, filters)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, cases)

	case http.MethodPost:
		var req CreateCaseRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		newCase, err := s.service.CreateCase(ctx, req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, http.StatusCreated, newCase)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleCaseOperations handles operations on specific cases
func (s *OnboardingServer) handleCaseOperations(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Parse path: /api/v1/onboarding/cases/{caseId}/...
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/onboarding/cases/")
	parts := strings.Split(path, "/")

	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, "Case ID required", http.StatusBadRequest)
		return
	}

	caseID := parts[0]
	operation := ""
	if len(parts) > 1 {
		operation = parts[1]
	}

	switch operation {
	case "":
		// Get case
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		c, err := s.service.GetCase(ctx, caseID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, c)

	case "submit":
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			SubmittedBy string `json:"submitted_by"`
		}
		json.NewDecoder(r.Body).Decode(&req)

		if err := s.service.SubmitCase(ctx, caseID, req.SubmittedBy); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "submitted"})

	case "evidence":
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var evidence EvidenceItem
		if err := json.NewDecoder(r.Body).Decode(&evidence); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		if err := s.service.UploadEvidence(ctx, caseID, evidence); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"status": "uploaded"})

	case "technical-profile":
		if r.Method != http.MethodPut {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var profile TechnicalProfile
		if err := json.NewDecoder(r.Body).Decode(&profile); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		if err := s.service.SetTechnicalProfile(ctx, caseID, profile); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})

	case "approvals":
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var approval Approval
		if err := json.NewDecoder(r.Body).Decode(&approval); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		if err := s.service.AddApproval(ctx, caseID, approval); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"status": "approval_added"})

	case "transition":
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			NewStatus OnboardingStatus `json:"new_status"`
			ChangedBy string           `json:"changed_by"`
			Reason    string           `json:"reason"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		if err := s.service.TransitionStatus(ctx, caseID, req.NewStatus, req.ChangedBy, req.Reason); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "transitioned"})

	case "provision":
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Get environment from path
		env := "sandbox"
		if len(parts) > 2 {
			env = parts[2]
		}

		c, err := s.service.GetCase(ctx, caseID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}

		// Provision resources
		provReq := ProvisionRequest{
			CaseID:           caseID,
			OrganizationID:   c.OrganizationID,
			OrganizationName: c.OrganizationName,
			Environment:      strings.ToUpper(env),
			StakeholderType:  string(c.StakeholderType),
			RateLimitTPS:     100,
			Roles:            []string{"participant"},
		}

		if c.TechnicalProfile != nil {
			provReq.BaseURL = c.TechnicalProfile.BaseURL
			provReq.CallbackURL = c.TechnicalProfile.CallbackURL
			provReq.MTLSEnabled = c.TechnicalProfile.MTLSEnabled
			provReq.RateLimitTPS = c.TechnicalProfile.RateLimitTPS
		}

		result, err := s.integration.ProvisionParticipant(ctx, provReq)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Update case with provisioned resources
		if env == "sandbox" {
			s.service.ProvisionSandbox(ctx, caseID)
		} else {
			limits := ResourceLimits{
				MaxTPS:                 provReq.RateLimitTPS,
				DailyTransactionLimit:  10000000,
				SingleTransactionLimit: 100000,
				NetDebitCap:            1000000,
			}
			s.service.ProvisionProduction(ctx, caseID, limits)
		}

		writeJSON(w, http.StatusCreated, result)

	case "notes":
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var note CaseNote
		if err := json.NewDecoder(r.Body).Decode(&note); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		if err := s.service.AddNote(ctx, caseID, note); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"status": "note_added"})

	case "requirements":
		// Handle requirement review: /cases/{caseId}/requirements/{reqId}/review
		if len(parts) < 4 || parts[3] != "review" {
			http.Error(w, "Invalid path", http.StatusBadRequest)
			return
		}
		reqID := parts[2]

		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			ReviewerID string `json:"reviewer_id"`
			Decision   string `json:"decision"`
			Notes      string `json:"notes"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		if err := s.service.ReviewRequirement(ctx, caseID, reqID, req.ReviewerID, req.Decision, req.Notes); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "reviewed"})

	default:
		http.Error(w, "Unknown operation", http.StatusNotFound)
	}
}

// handleStats handles statistics
func (s *OnboardingServer) handleStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()
	cases, _ := s.service.ListCases(ctx, CaseFilters{})

	stats := map[string]interface{}{
		"total_cases":    len(cases),
		"by_status":      make(map[string]int),
		"by_stakeholder": make(map[string]int),
	}

	byStatus := stats["by_status"].(map[string]int)
	byStakeholder := stats["by_stakeholder"].(map[string]int)

	for _, c := range cases {
		byStatus[string(c.Status)]++
		byStakeholder[string(c.StakeholderType)]++
	}

	writeJSON(w, http.StatusOK, stats)
}

// writeJSON writes a JSON response
func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func main() {
	port := 8082
	if portStr := os.Getenv("PORT"); portStr != "" {
		fmt.Sscanf(portStr, "%d", &port)
	}

	server := NewOnboardingServer(port)
	if err := server.Start(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server failed: %v", err)
	}
}
