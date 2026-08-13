// Package main provides the entry point for the Mojaloop service
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/payment-switch/go-services/internal/integration"
	"github.com/payment-switch/go-services/internal/mojaloop"
)

// Server configuration
var (
	port = getEnv("PORT", "8080")
)

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// API Request/Response types
type GenerateILPRequest struct {
	TransferID      string `json:"transferId"`
	Amount          int64  `json:"amount"`
	Currency        string `json:"currency"`
	PayerFSP        string `json:"payerFsp"`
	PayeeFSP        string `json:"payeeFsp"`
	PayeeIdentifier string `json:"payeeIdentifier"`
}

type VerifyFulfillmentRequest struct {
	Fulfillment string `json:"fulfillment"`
	Condition   string `json:"condition"`
}

type VerifyFulfillmentResponse struct {
	Valid bool   `json:"valid"`
	Error string `json:"error,omitempty"`
}

type ExecuteTransferRequest struct {
	TransferID     string `json:"transferId"`
	PayerAccountID uint64 `json:"payerAccountId"`
	PayeeAccountID uint64 `json:"payeeAccountId"`
	Amount         int64  `json:"amount"`
	Currency       string `json:"currency"`
	PayerFSP       string `json:"payerFsp"`
	PayeeFSP       string `json:"payeeFsp"`
	ILPPacket      string `json:"ilpPacket"`
	Condition      string `json:"condition"`
}

type ReconcileRequest struct {
	AccountID uint64 `json:"accountId"`
}

type HealthResponse struct {
	Status    string `json:"status"`
	Timestamp string `json:"timestamp"`
	Version   string `json:"version"`
}

type ErrorResponse struct {
	Error   string `json:"error"`
	Code    int    `json:"code"`
	Details string `json:"details,omitempty"`
}

func main() {
	log.Println("Starting Mojaloop Service (Go Implementation)")

	// Initialize services
	_ = mojaloop.GetILPCryptoService()
	_ = mojaloop.GetLedgerOrchestrator()
	_ = mojaloop.GetTigerBeetleClient()
	_ = mojaloop.GetMojaloopTigerBeetleAdapter()

	// Setup HTTP routes
	mux := http.NewServeMux()

	// Health endpoints
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/ready", readyHandler)

	// ILP Protocol endpoints
	mux.HandleFunc("/api/v1/ilp/generate", generateILPHandler)
	mux.HandleFunc("/api/v1/ilp/verify", verifyFulfillmentHandler)

	// Transfer endpoints
	mux.HandleFunc("/api/v1/transfers/execute", executeTransferHandler)
	mux.HandleFunc("/api/v1/transfers/prepare", prepareTransferHandler)

	// Mojaloop Transfer Flow endpoints (TigerBeetle-backed)
	mux.HandleFunc("/api/v1/mojaloop/transfers/prepare", mojaloopPrepareHandler)
	mux.HandleFunc("/api/v1/mojaloop/transfers/fulfill", mojaloopFulfillHandler)
	mux.HandleFunc("/api/v1/mojaloop/transfers/abort", mojaloopAbortHandler)
	mux.HandleFunc("/api/v1/mojaloop/transfers/execute", mojaloopExecuteHandler)
	mux.HandleFunc("/api/v1/mojaloop/participants/register", registerParticipantHandler)
	mux.HandleFunc("/api/v1/mojaloop/participants/position", getParticipantPositionHandler)

	// Ledger endpoints
	mux.HandleFunc("/api/v1/ledger/reconcile", reconcileHandler)
	mux.HandleFunc("/api/v1/ledger/balance", getBalanceHandler)

	// TigerBeetle endpoints
	mux.HandleFunc("/api/v1/tigerbeetle/transfer", tigerBeetleTransferHandler)

	// Every non-health ledger route independently verifies a Keycloak RS256
	// bearer token. APISIX remains the edge enforcement point, but no direct
	// internal request may substitute a shared-secret token.
	issuer := os.Getenv("KEYCLOAK_ISSUER_URL")
	if issuer == "" {
		log.Fatal("KEYCLOAK_ISSUER_URL is required for ledger authentication")
	}
	validator, err := integration.NewKeycloakJWTValidator(&integration.KeycloakConfig{
		BaseURL:             getEnv("KEYCLOAK_INTERNAL_URL", "http://keycloak:8080"),
		Realm:               getEnv("KEYCLOAK_REALM", "payment-switch"),
		ClientID:            getEnv("KEYCLOAK_LEDGER_CLIENT_ID", "payment-switch-api"),
		JWKSRefreshInterval: 5 * time.Minute,
		RequiredAudience:    getEnv("KEYCLOAK_LEDGER_AUDIENCE", "payment-switch-api"),
		RequiredIssuer:      issuer,
		ClockSkew:           30 * time.Second,
	})
	if err != nil {
		log.Fatalf("failed to initialize Keycloak JWT validator: %v", err)
	}
	auth := integration.NewJWTMiddleware(validator).
		ExcludePath("/health").
		ExcludePath("/ready")

	// Create server
	server := &http.Server{
		Addr:         ":" + port,
		Handler:      loggingMiddleware(corsMiddleware(auth.Middleware(mux))),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in goroutine
	go func() {
		log.Printf("Mojaloop Service listening on port %s", port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("Server exited")
}

// Middleware
func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
}

func corsMiddleware(next http.Handler) http.Handler {
	var allowed []string
	if origins := os.Getenv("CORS_ALLOWED_ORIGINS"); origins != "" {
		allowed = strings.Split(origins, ",")
	} else {
		allowed = []string{"https://app.paymentswitch.ng", "https://admin.paymentswitch.ng"}
	}
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
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Credentials", "true")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// Health handlers
func healthHandler(w http.ResponseWriter, r *http.Request) {
	response := HealthResponse{
		Status:    "healthy",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Version:   "1.0.0",
	}
	writeJSON(w, http.StatusOK, response)
}

func readyHandler(w http.ResponseWriter, r *http.Request) {
	response := HealthResponse{
		Status:    "ready",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Version:   "1.0.0",
	}
	writeJSON(w, http.StatusOK, response)
}

// ILP Protocol handlers
func generateILPHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed", "")
		return
	}

	var req GenerateILPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body", err.Error())
		return
	}

	result, err := mojaloop.GenerateTransferILP(
		req.TransferID,
		req.Amount,
		req.Currency,
		req.PayerFSP,
		req.PayeeFSP,
		req.PayeeIdentifier,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to generate ILP", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func verifyFulfillmentHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed", "")
		return
	}

	var req VerifyFulfillmentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body", err.Error())
		return
	}

	valid, err := mojaloop.VerifyTransferFulfillment(req.Fulfillment, req.Condition)

	response := VerifyFulfillmentResponse{Valid: valid}
	if err != nil {
		response.Error = err.Error()
	}

	writeJSON(w, http.StatusOK, response)
}

// Transfer handlers
func executeTransferHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed", "")
		return
	}

	var req ExecuteTransferRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body", err.Error())
		return
	}

	ctx := r.Context()
	success, record, err := mojaloop.ExecuteTransferWithStrategy(
		ctx,
		req.TransferID,
		req.PayerAccountID,
		req.PayeeAccountID,
		req.Amount,
		req.Currency,
		req.PayerFSP,
		req.PayeeFSP,
		req.ILPPacket,
		req.Condition,
	)

	if err != nil {
		writeError(w, http.StatusInternalServerError, "Transfer execution failed", err.Error())
		return
	}

	response := map[string]interface{}{
		"success": success,
		"record":  record,
	}
	writeJSON(w, http.StatusOK, response)
}

func prepareTransferHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed", "")
		return
	}

	var req GenerateILPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body", err.Error())
		return
	}

	// Generate ILP artifacts
	ilpResult, err := mojaloop.GenerateTransferILP(
		req.TransferID,
		req.Amount,
		req.Currency,
		req.PayerFSP,
		req.PayeeFSP,
		req.PayeeIdentifier,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to prepare transfer", err.Error())
		return
	}

	response := map[string]interface{}{
		"transferId":  req.TransferID,
		"ilpPacket":   ilpResult.ILPPacket,
		"condition":   ilpResult.Condition,
		"fulfillment": ilpResult.Fulfillment,
		"expiration":  ilpResult.Expiration,
	}
	writeJSON(w, http.StatusOK, response)
}

// Ledger handlers
func reconcileHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed", "")
		return
	}

	var req ReconcileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body", err.Error())
		return
	}

	ctx := r.Context()
	orchestrator := mojaloop.GetLedgerOrchestrator()
	result := orchestrator.ReconcileAccount(ctx, req.AccountID)

	writeJSON(w, http.StatusOK, result)
}

func getBalanceHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed", "")
		return
	}

	accountIDStr := r.URL.Query().Get("accountId")
	if accountIDStr == "" {
		writeError(w, http.StatusBadRequest, "Missing accountId parameter", "")
		return
	}

	accountID, err := strconv.ParseUint(accountIDStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid accountId", err.Error())
		return
	}

	ledgerType := r.URL.Query().Get("ledger")
	if ledgerType == "" {
		ledgerType = "tigerbeetle"
	}

	ctx := r.Context()
	orchestrator := mojaloop.GetLedgerOrchestrator()

	var lt mojaloop.LedgerType
	switch ledgerType {
	case "tigerbeetle":
		lt = mojaloop.LedgerTypeTigerBeetle
	case "mojaloop":
		lt = mojaloop.LedgerTypeMojaloop
	default:
		writeError(w, http.StatusBadRequest, "Invalid ledger", "ledger must be tigerbeetle or mojaloop")
		return
	}

	balance, err := orchestrator.GetBalance(ctx, accountID, lt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to get balance", err.Error())
		return
	}

	response := map[string]interface{}{
		"accountId": accountID,
		"balance":   balance,
		"ledger":    ledgerType,
	}
	writeJSON(w, http.StatusOK, response)
}

// TigerBeetle handlers
func tigerBeetleTransferHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed", "")
		return
	}

	var req struct {
		TransferID     string `json:"transferId"`
		PayerAccountID uint64 `json:"payerAccountId"`
		PayeeAccountID uint64 `json:"payeeAccountId"`
		Amount         uint64 `json:"amount"`
		CurrencyLedger uint32 `json:"currencyLedger"`
		TwoPhase       bool   `json:"twoPhase"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body", err.Error())
		return
	}

	ctx := r.Context()
	result, err := mojaloop.ExecutePaymentTransfer(
		ctx,
		req.TransferID,
		req.PayerAccountID,
		req.PayeeAccountID,
		req.Amount,
		req.CurrencyLedger,
		req.TwoPhase,
	)

	if err != nil {
		writeError(w, http.StatusInternalServerError, "Transfer failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// Mojaloop Transfer Flow handlers (TigerBeetle-backed with PostgreSQL persistence)
// FIXED: Uses ProductionMojaloopAdapter for durable storage instead of in-memory
func mojaloopPrepareHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed", "")
		return
	}

	var req struct {
		TransferID string `json:"transferId"`
		PayerFSP   string `json:"payerFsp"`
		PayeeFSP   string `json:"payeeFsp"`
		Amount     uint64 `json:"amount"`
		Currency   string `json:"currency"`
		ILPPacket  string `json:"ilpPacket"`
		Condition  string `json:"condition"`
		Expiration string `json:"expiration"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body", err.Error())
		return
	}

	expiration, _ := time.Parse("2006-01-02T15:04:05.000Z", req.Expiration)
	if expiration.IsZero() {
		expiration = time.Now().UTC().Add(30 * time.Second)
	}

	ctx := r.Context()
	// FIXED: Use production adapter with PostgreSQL persistence
	adapter := mojaloop.GetProductionMojaloopAdapter()
	result, err := adapter.PrepareTransfer(ctx, &mojaloop.PrepareTransferRequest{
		TransferID: req.TransferID,
		PayerFSP:   req.PayerFSP,
		PayeeFSP:   req.PayeeFSP,
		Amount:     req.Amount,
		Currency:   req.Currency,
		ILPPacket:  req.ILPPacket,
		Condition:  req.Condition,
		Expiration: expiration,
	})

	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to prepare transfer", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func mojaloopFulfillHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed", "")
		return
	}

	var req struct {
		TransferID  string `json:"transferId"`
		Fulfillment string `json:"fulfillment"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body", err.Error())
		return
	}

	ctx := r.Context()
	// FIXED: Use production adapter with PostgreSQL persistence
	adapter := mojaloop.GetProductionMojaloopAdapter()
	result, err := adapter.FulfillTransfer(ctx, &mojaloop.FulfillTransferRequest{
		TransferID:  req.TransferID,
		Fulfillment: req.Fulfillment,
	})

	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to fulfill transfer", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func mojaloopAbortHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed", "")
		return
	}

	var req struct {
		TransferID       string `json:"transferId"`
		ErrorCode        string `json:"errorCode"`
		ErrorDescription string `json:"errorDescription"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body", err.Error())
		return
	}

	ctx := r.Context()
	// FIXED: Use production adapter with PostgreSQL persistence
	adapter := mojaloop.GetProductionMojaloopAdapter()
	result, err := adapter.AbortTransfer(ctx, &mojaloop.AbortTransferRequest{
		TransferID:       req.TransferID,
		ErrorCode:        req.ErrorCode,
		ErrorDescription: req.ErrorDescription,
	})

	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to abort transfer", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func mojaloopExecuteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed", "")
		return
	}

	var req struct {
		TransferID      string `json:"transferId"`
		PayerFSP        string `json:"payerFsp"`
		PayeeFSP        string `json:"payeeFsp"`
		PayeeIdentifier string `json:"payeeIdentifier"`
		Amount          uint64 `json:"amount"`
		Currency        string `json:"currency"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body", err.Error())
		return
	}

	ctx := r.Context()
	flow := mojaloop.NewMojaloopTransferFlow()
	result, err := flow.ExecuteTransfer(
		ctx,
		req.TransferID,
		req.PayerFSP,
		req.PayeeFSP,
		req.PayeeIdentifier,
		req.Amount,
		req.Currency,
	)

	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to execute transfer", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func registerParticipantHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed", "")
		return
	}

	var req struct {
		FSPID     string `json:"fspId"`
		AccountID uint64 `json:"accountId"`
		Currency  string `json:"currency"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body", err.Error())
		return
	}

	ctx := r.Context()
	// FIXED: Use production adapter with PostgreSQL persistence
	adapter := mojaloop.GetProductionMojaloopAdapter()
	err := adapter.RegisterParticipant(ctx, req.FSPID, req.AccountID, req.Currency)

	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to register participant", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success":   true,
		"fspId":     req.FSPID,
		"accountId": req.AccountID,
		"currency":  req.Currency,
	})
}

func getParticipantPositionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed", "")
		return
	}

	fspID := r.URL.Query().Get("fspId")
	if fspID == "" {
		writeError(w, http.StatusBadRequest, "Missing fspId parameter", "")
		return
	}

	ctx := r.Context()
	adapter := mojaloop.GetMojaloopTigerBeetleAdapter()
	position, err := adapter.GetParticipantPosition(ctx, fspID)

	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to get position", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"fspId":    fspID,
		"position": position,
	})
}

// Helper functions
func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message, details string) {
	response := ErrorResponse{
		Error:   message,
		Code:    status,
		Details: details,
	}
	writeJSON(w, status, response)
}
