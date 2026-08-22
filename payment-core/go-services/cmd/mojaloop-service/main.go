// Package main provides the entry point for the Mojaloop service
package main

import (
	"context"
	"encoding/json"
	"fmt"
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

	// Every financial instruction requires a realm role issued by Keycloak. A
	// valid bearer token alone is not authority to move funds, register an FSP,
	// inspect a balance, or generate a fulfillment-capable ILP packet.
	operators := []string{"operator", "admin"}
	regulators := []string{"admin", "cbn"}

	// ILP Protocol endpoints
	mux.HandleFunc("/api/v1/ilp/generate", requireLedgerRoles(generateILPHandler, operators...))
	mux.HandleFunc("/api/v1/ilp/verify", requireLedgerRoles(verifyFulfillmentHandler, operators...))

	// The legacy direct execution path uses an audited simulated adapter. Keep
	// the endpoint explicit but unavailable rather than risking fabricated or
	// non-durable money movement. Production uses Mojaloop prepare/fulfill/abort.
	mux.HandleFunc("/api/v1/transfers/execute", legacyLedgerEndpointDisabled)
	mux.HandleFunc("/api/v1/transfers/prepare", requireLedgerRoles(prepareTransferHandler, operators...))

	// Mojaloop Transfer Flow endpoints (TigerBeetle-backed)
	mux.HandleFunc("/api/v1/mojaloop/transfers/prepare", requireLedgerRoles(mojaloopPrepareHandler, operators...))
	mux.HandleFunc("/api/v1/mojaloop/transfers/fulfill", requireLedgerRoles(mojaloopFulfillHandler, operators...))
	mux.HandleFunc("/api/v1/mojaloop/transfers/abort", requireLedgerRoles(mojaloopAbortHandler, operators...))
	mux.HandleFunc("/api/v1/mojaloop/transfers/execute", legacyLedgerEndpointDisabled)
	mux.HandleFunc("/api/v1/mojaloop/participants/register", requireLedgerRoles(registerParticipantHandler, regulators...))
	mux.HandleFunc("/api/v1/mojaloop/participants/position", legacyLedgerEndpointDisabled)

	// Ledger endpoints
	mux.HandleFunc("/api/v1/ledger/reconcile", requireLedgerRoles(reconcileHandler, regulators...))
	mux.HandleFunc("/api/v1/ledger/balance", requireLedgerRoles(getBalanceHandler, operators...))

	// Raw TigerBeetle execution is disabled. Only the persisted Mojaloop state
	// machine may create, post, or void funds holds.
	mux.HandleFunc("/api/v1/tigerbeetle/transfer", legacyLedgerEndpointDisabled)

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
		Handler:      loggingMiddleware(corsMiddleware(auth.Middleware(bodyLimitMiddleware(mux)))),
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
const maxLedgerRequestBodyBytes int64 = 1 << 20

func bodyLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Body != nil {
			r.Body = http.MaxBytesReader(w, r.Body, maxLedgerRequestBodyBytes)
		}
		next.ServeHTTP(w, r)
	})
}

func validatePrepareRequest(transferID, payerFSP, payeeFSP string, amount uint64, currency, ilpPacket, condition string) error {
	if strings.TrimSpace(transferID) == "" || len(transferID) > 128 {
		return fmt.Errorf("transferId is required and must be at most 128 characters")
	}
	if strings.TrimSpace(payerFSP) == "" || strings.TrimSpace(payeeFSP) == "" || payerFSP == payeeFSP {
		return fmt.Errorf("payerFsp and distinct payeeFsp are required")
	}
	if amount == 0 {
		return fmt.Errorf("amount must be positive")
	}
	if _, err := mojaloop.RequireCurrencyLedger(currency); err != nil {
		return err
	}
	if strings.TrimSpace(ilpPacket) == "" || strings.TrimSpace(condition) == "" {
		return fmt.Errorf("ilpPacket and condition are required")
	}
	return nil
}

func legacyLedgerEndpointDisabled(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusServiceUnavailable, "Legacy ledger endpoint disabled", "Use the persisted Mojaloop prepare/fulfill/abort flow.")
}

func requireLedgerRoles(next http.HandlerFunc, roles ...string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := integration.GetClaimsFromContext(r.Context())
		if claims == nil {
			writeError(w, http.StatusUnauthorized, "Authentication context missing", "")
			return
		}
		for _, role := range roles {
			if claims.HasRole(role) {
				next(w, r)
				return
			}
		}
		writeError(w, http.StatusForbidden, "Insufficient ledger role", "")
	}
}

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

	// The fulfillment is a settlement secret and must never be returned through
	// an external generation endpoint. Only condition, packet, and expiry are
	// needed by the prepare-side caller.
	writeJSON(w, http.StatusOK, map[string]string{
		"ilpPacket":  result.ILPPacket,
		"condition":  result.Condition,
		"expiration": result.Expiration,
	})
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

	// Do not return the fulfillment secret to the prepare caller. Its disclosure
	// would permit a caller to complete a pending transfer outside the intended
	// counterparty fulfillment path.
	response := map[string]interface{}{
		"transferId": req.TransferID,
		"ilpPacket":  ilpResult.ILPPacket,
		"condition":  ilpResult.Condition,
		"expiration": ilpResult.Expiration,
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
	if err := validatePrepareRequest(req.TransferID, req.PayerFSP, req.PayeeFSP, req.Amount, req.Currency, req.ILPPacket, req.Condition); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid transfer preparation", err.Error())
		return
	}

	expiration, err := time.Parse("2006-01-02T15:04:05.000Z", req.Expiration)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid transfer expiration", "expiration must be an RFC3339 millisecond UTC timestamp")
		return
	}
	now := time.Now().UTC()
	if !expiration.After(now) || expiration.After(now.Add(5*time.Minute)) {
		writeError(w, http.StatusBadRequest, "Invalid transfer expiration", "expiration must be in the next five minutes")
		return
	}

	ctx := r.Context()
	// Use the durable adapter. A missing PostgreSQL store is a hard dependency
	// failure, not an opportunity to use an in-memory transfer path.
	adapter, err := mojaloop.GetProductionMojaloopAdapter()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "Transfer store unavailable", err.Error())
		return
	}
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
	if strings.TrimSpace(req.TransferID) == "" || strings.TrimSpace(req.Fulfillment) == "" {
		writeError(w, http.StatusBadRequest, "Invalid transfer fulfillment", "transferId and fulfillment are required")
		return
	}

	ctx := r.Context()
	adapter, err := mojaloop.GetProductionMojaloopAdapter()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "Transfer store unavailable", err.Error())
		return
	}
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
	if strings.TrimSpace(req.TransferID) == "" || strings.TrimSpace(req.ErrorCode) == "" {
		writeError(w, http.StatusBadRequest, "Invalid transfer abort", "transferId and errorCode are required")
		return
	}

	ctx := r.Context()
	adapter, err := mojaloop.GetProductionMojaloopAdapter()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "Transfer store unavailable", err.Error())
		return
	}
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
	if strings.TrimSpace(req.FSPID) == "" || req.AccountID == 0 {
		writeError(w, http.StatusBadRequest, "Invalid participant registration", "fspId and nonzero accountId are required")
		return
	}
	if _, err := mojaloop.RequireCurrencyLedger(req.Currency); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid participant registration", err.Error())
		return
	}

	ctx := r.Context()
	adapter, err := mojaloop.GetProductionMojaloopAdapter()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "Transfer store unavailable", err.Error())
		return
	}
	err = adapter.RegisterParticipant(ctx, req.FSPID, req.AccountID, req.Currency)

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
