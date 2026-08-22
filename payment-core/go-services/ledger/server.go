package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/payment-switch/go-services/internal/database"
	"github.com/payment-switch/go-services/internal/integration"
	"github.com/payment-switch/go-services/internal/tigerbeetle"
	pb "github.com/payment-switch/go-services/pkg/grpc/ledger"
	grpcInterceptors "github.com/payment-switch/go-services/pkg/grpc/interceptors"
)

// server implements the LedgerService gRPC server
type server struct {
	pb.UnimplementedLedgerServiceServer
	tbClient *tigerbeetle.Client
	db       *database.DB
}

// CreateAccount creates a new account in the ledger
func (s *server) CreateAccount(ctx context.Context, req *pb.CreateAccountRequest) (*pb.CreateAccountResponse, error) {
	if req.Account == nil {
		return nil, status.Error(codes.InvalidArgument, "account is required")
	}

	// Generate TigerBeetle account ID
	tbAccountID := tigerbeetle.GenerateAccountID(req.Account.ParticipantId, req.Account.AccountId)

	// Create account in TigerBeetle
	account := tigerbeetle.Account{
		ID:     tbAccountID,
		Ledger: req.Account.Ledger,
		Code:   uint16(req.Account.Code),
		Flags:  uint16(req.Account.Flags),
	}

	if err := s.tbClient.CreateAccounts(ctx, []tigerbeetle.Account{account}); err != nil {
		log.Printf("Failed to create account in TigerBeetle: %v", err)
		return nil, status.Errorf(codes.Internal, "failed to create account: %v", err)
	}

	log.Printf("Created account %s in TigerBeetle with ID %d", req.Account.AccountId, tbAccountID)

	return &pb.CreateAccountResponse{
		Success:              true,
		Message:              "Account created successfully",
		TigerbeetleAccountId: fmt.Sprintf("%d", tbAccountID),
	}, nil
}

// CreateAccounts creates multiple accounts in a batch
func (s *server) CreateAccounts(ctx context.Context, req *pb.CreateAccountsRequest) (*pb.CreateAccountsResponse, error) {
	if len(req.Accounts) == 0 {
		return nil, status.Error(codes.InvalidArgument, "at least one account is required")
	}

	// Convert to TigerBeetle accounts
	accounts := make([]tigerbeetle.Account, len(req.Accounts))
	for i, acc := range req.Accounts {
		tbAccountID := tigerbeetle.GenerateAccountID(acc.ParticipantId, acc.AccountId)
		accounts[i] = tigerbeetle.Account{
			ID:     tbAccountID,
			Ledger: acc.Ledger,
			Code:   uint16(acc.Code),
			Flags:  uint16(acc.Flags),
		}
	}

	// Create accounts in TigerBeetle
	if err := s.tbClient.CreateAccounts(ctx, accounts); err != nil {
		log.Printf("Failed to create accounts in TigerBeetle: %v", err)
		return nil, status.Errorf(codes.Internal, "failed to create accounts: %v", err)
	}

	log.Printf("Created %d accounts in TigerBeetle", len(accounts))

	return &pb.CreateAccountsResponse{
		Success:      true,
		Message:      fmt.Sprintf("Created %d accounts successfully", len(accounts)),
		CreatedCount: int32(len(accounts)),
	}, nil
}

// CreateTransfer creates a new transfer between accounts
func (s *server) CreateTransfer(ctx context.Context, req *pb.CreateTransferRequest) (*pb.CreateTransferResponse, error) {
	if req.Transfer == nil {
		return nil, status.Error(codes.InvalidArgument, "transfer is required")
	}

	// Generate TigerBeetle transfer ID
	tbTransferID := tigerbeetle.GenerateTransferID(req.Transfer.TransactionId)

	// Generate account IDs
	debitAccountID := tigerbeetle.GenerateAccountID("", req.Transfer.DebitAccountId)
	creditAccountID := tigerbeetle.GenerateAccountID("", req.Transfer.CreditAccountId)

	// Convert amount to cents
	amountCents, err := tigerbeetle.AmountToCents(req.Transfer.Amount)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid amount: %v", err)
	}

	// Create transfer in TigerBeetle
	transfer := tigerbeetle.Transfer{
		ID:              tbTransferID,
		DebitAccountID:  debitAccountID,
		CreditAccountID: creditAccountID,
		Amount:          amountCents,
		Ledger:          req.Transfer.Ledger,
		Code:            uint16(req.Transfer.Code),
		Flags:           uint16(req.Transfer.Flags),
	}

	if err := s.tbClient.CreateTransfers(ctx, []tigerbeetle.Transfer{transfer}); err != nil {
		log.Printf("Failed to create transfer in TigerBeetle: %v", err)
		return nil, status.Errorf(codes.Internal, "failed to create transfer: %v", err)
	}

	log.Printf("Created transfer %s in TigerBeetle with ID %d", req.Transfer.TransferId, tbTransferID)

	return &pb.CreateTransferResponse{
		Success:               true,
		Message:               "Transfer created successfully",
		TigerbeetleTransferId: fmt.Sprintf("%d", tbTransferID),
		CompletedAt:           timestamppb.Now(),
	}, nil
}

// CreateTransfers creates multiple transfers in a batch
func (s *server) CreateTransfers(ctx context.Context, req *pb.CreateTransfersRequest) (*pb.CreateTransfersResponse, error) {
	if len(req.Transfers) == 0 {
		return nil, status.Error(codes.InvalidArgument, "at least one transfer is required")
	}

	// Convert to TigerBeetle transfers
	transfers := make([]tigerbeetle.Transfer, len(req.Transfers))
	for i, t := range req.Transfers {
		tbTransferID := tigerbeetle.GenerateTransferID(t.TransactionId)
		debitAccountID := tigerbeetle.GenerateAccountID("", t.DebitAccountId)
		creditAccountID := tigerbeetle.GenerateAccountID("", t.CreditAccountId)

		amountCents, err := tigerbeetle.AmountToCents(t.Amount)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid amount for transfer %d: %v", i, err)
		}

		transfers[i] = tigerbeetle.Transfer{
			ID:              tbTransferID,
			DebitAccountID:  debitAccountID,
			CreditAccountID: creditAccountID,
			Amount:          amountCents,
			Ledger:          t.Ledger,
			Code:            uint16(t.Code),
			Flags:           uint16(t.Flags),
		}
	}

	// Create transfers in TigerBeetle
	if err := s.tbClient.CreateTransfers(ctx, transfers); err != nil {
		log.Printf("Failed to create transfers in TigerBeetle: %v", err)
		return nil, status.Errorf(codes.Internal, "failed to create transfers: %v", err)
	}

	log.Printf("Created %d transfers in TigerBeetle", len(transfers))

	return &pb.CreateTransfersResponse{
		Success:      true,
		Message:      fmt.Sprintf("Created %d transfers successfully", len(transfers)),
		CreatedCount: int32(len(transfers)),
	}, nil
}

// GetAccountBalance retrieves the balance of an account
func (s *server) GetAccountBalance(ctx context.Context, req *pb.GetAccountBalanceRequest) (*pb.GetAccountBalanceResponse, error) {
	if req.AccountId == "" {
		return nil, status.Error(codes.InvalidArgument, "account_id is required")
	}

	// Generate TigerBeetle account ID
	tbAccountID := tigerbeetle.GenerateAccountID("", req.AccountId)

	// Get balance from TigerBeetle
	balance, err := s.tbClient.GetAccountBalance(ctx, tbAccountID)
	if err != nil {
		log.Printf("Failed to get account balance from TigerBeetle: %v", err)
		return nil, status.Errorf(codes.Internal, "failed to get account balance: %v", err)
	}

	return &pb.GetAccountBalanceResponse{
		Success: true,
		Message: "Balance retrieved successfully",
		Balance: &pb.Balance{
			AccountId:        req.AccountId,
			AvailableBalance: tigerbeetle.CentsToAmount(uint64(balance.AvailableBalance)),
			PendingBalance:   tigerbeetle.CentsToAmount(uint64(balance.PendingBalance)),
			TotalBalance:     tigerbeetle.CentsToAmount(uint64(balance.AvailableBalance + balance.PendingBalance)),
			LastUpdated:      timestamppb.Now(),
		},
	}, nil
}

// GetAccountBalances retrieves balances for multiple accounts
func (s *server) GetAccountBalances(ctx context.Context, req *pb.GetAccountBalancesRequest) (*pb.GetAccountBalancesResponse, error) {
	if len(req.AccountIds) == 0 {
		return nil, status.Error(codes.InvalidArgument, "at least one account_id is required")
	}

	// Generate TigerBeetle account IDs
	tbAccountIDs := make([]uint64, len(req.AccountIds))
	for i, accountID := range req.AccountIds {
		tbAccountIDs[i] = tigerbeetle.GenerateAccountID("", accountID)
	}

	// Get accounts from TigerBeetle
	accounts, err := s.tbClient.LookupAccounts(ctx, tbAccountIDs)
	if err != nil {
		log.Printf("Failed to get account balances from TigerBeetle: %v", err)
		return nil, status.Errorf(codes.Internal, "failed to get account balances: %v", err)
	}

	// Convert to response format
	balances := make([]*pb.Balance, len(accounts))
	for i, account := range accounts {
		availableBalance := int64(account.CreditsPosted) - int64(account.DebitsPosted)
		pendingBalance := int64(account.CreditsPending) - int64(account.DebitsPending)

		balances[i] = &pb.Balance{
			AccountId:        req.AccountIds[i],
			AvailableBalance: tigerbeetle.CentsToAmount(uint64(availableBalance)),
			PendingBalance:   tigerbeetle.CentsToAmount(uint64(pendingBalance)),
			TotalBalance:     tigerbeetle.CentsToAmount(uint64(availableBalance + pendingBalance)),
			LastUpdated:      timestamppb.Now(),
		}
	}

	return &pb.GetAccountBalancesResponse{
		Success:  true,
		Message:  fmt.Sprintf("Retrieved %d balances successfully", len(balances)),
		Balances: balances,
	}, nil
}

// SyncBalanceToPostgres synchronizes an account balance to PostgreSQL
func (s *server) SyncBalanceToPostgres(ctx context.Context, req *pb.SyncBalanceRequest) (*pb.SyncBalanceResponse, error) {
	if req.AccountId == "" {
		return nil, status.Error(codes.InvalidArgument, "account_id is required")
	}

	// Generate TigerBeetle account ID
	tbAccountID := tigerbeetle.GenerateAccountID(req.ParticipantId, req.AccountId)

	// Get balance from TigerBeetle
	balance, err := s.tbClient.GetAccountBalance(ctx, tbAccountID)
	if err != nil {
		log.Printf("Failed to get account balance from TigerBeetle: %v", err)
		return nil, status.Errorf(codes.Internal, "failed to get account balance: %v", err)
	}

	// Sync to PostgreSQL
	accountBalance := &database.AccountBalance{
		AccountID:            req.AccountId,
		TigerBeetleAccountID: fmt.Sprintf("%d", tbAccountID),
		ParticipantID:        req.ParticipantId,
		Currency:             req.Currency,
		AvailableBalance:     tigerbeetle.CentsToAmount(uint64(balance.AvailableBalance)),
		PendingBalance:       tigerbeetle.CentsToAmount(uint64(balance.PendingBalance)),
		LedgerID:             1,
		Code:                 1,
	}

	if err := s.db.UpsertAccountBalance(ctx, accountBalance); err != nil {
		log.Printf("Failed to sync balance to PostgreSQL: %v", err)
		return nil, status.Errorf(codes.Internal, "failed to sync balance: %v", err)
	}

	log.Printf("Synced balance for account %s to PostgreSQL", req.AccountId)

	return &pb.SyncBalanceResponse{
		Success: true,
		Message: "Balance synced successfully",
	}, nil
}

func main() {
	// Get configuration from environment
	port := os.Getenv("LEDGER_SERVICE_PORT")
	if port == "" {
		port = "50051"
	}

	tbHost := os.Getenv("TIGERBEETLE_HOST")
	if tbHost == "" {
		tbHost = "tigerbeetle.payment-switch"
	}

	tbPort := os.Getenv("TIGERBEETLE_PORT")
	if tbPort == "" {
		tbPort = "3000"
	}

	// Initialize TigerBeetle client
	tbClient, err := tigerbeetle.NewClient(
		0, // cluster ID
		[]string{fmt.Sprintf("%s:%s", tbHost, tbPort)},
		20, // max connections
	)
	if err != nil {
		log.Fatalf("Failed to create TigerBeetle client: %v", err)
	}
	defer tbClient.Close()

	// Initialize database connection
	dbConfig := &database.Config{
		Host:        os.Getenv("POSTGRES_HOST"),
		Port:        5432,
		Database:    os.Getenv("POSTGRES_DB"),
		User:        os.Getenv("POSTGRES_USER"),
		Password:    os.Getenv("POSTGRES_PASSWORD"),
		MinConns:    20,
		MaxConns:    100,
		MaxIdleTime: 5 * time.Minute,
		MaxLifetime: 30 * time.Minute,
	}

	db, err := database.NewDB(dbConfig)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	keycloakConfig := integration.DefaultKeycloakConfig()
	if value := os.Getenv("KEYCLOAK_URL"); value != "" { keycloakConfig.BaseURL = value }
	if value := os.Getenv("KEYCLOAK_REALM"); value != "" { keycloakConfig.Realm = value }
	if value := os.Getenv("KEYCLOAK_CLIENT_ID"); value != "" { keycloakConfig.ClientID = value }
	if value := os.Getenv("KEYCLOAK_REQUIRED_AUDIENCE"); value != "" { keycloakConfig.RequiredAudience = value }
	if value := os.Getenv("KEYCLOAK_REQUIRED_ISSUER"); value != "" { keycloakConfig.RequiredIssuer = value }
	keycloakValidator, err := integration.NewKeycloakJWTValidator(keycloakConfig)
	if err != nil { log.Fatalf("Failed to initialize Keycloak JWT validator: %v", err) }

	// Create gRPC server
	lis, err := net.Listen("tcp", fmt.Sprintf(":%s", port))
	if err != nil {
		log.Fatalf("Failed to listen: %v", err)
	}

	grpcServer := grpc.NewServer(
		grpc.MaxRecvMsgSize(10*1024*1024), // 10MB
		grpc.MaxSendMsgSize(10*1024*1024), // 10MB
			grpc.ChainUnaryInterceptor(
				grpcInterceptors.ServerUnaryRecoveryInterceptor(),
				grpcInterceptors.ServerUnaryLoggingInterceptor(),
				grpcInterceptors.LedgerUnaryAuthInterceptor(grpcInterceptors.LedgerAuthConfig{Validator: keycloakValidator}),
			),
		grpc.KeepaliveParams(keepalive.ServerParameters{
			MaxConnectionIdle:     5 * time.Minute,
			MaxConnectionAge:      30 * time.Minute,
			MaxConnectionAgeGrace: 10 * time.Second,
			Time:                  30 * time.Second,
			Timeout:               10 * time.Second,
		}),
		grpc.KeepaliveEnforcementPolicy(keepalive.EnforcementPolicy{
			MinTime:             10 * time.Second,
			PermitWithoutStream: true,
		}),
	)

	pb.RegisterLedgerServiceServer(grpcServer, &server{
		tbClient: tbClient,
		db:       db,
	})

	log.Printf("Ledger gRPC server listening on port %s", port)

	// Graceful shutdown
	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
		<-sigChan

		log.Println("Shutting down gRPC server...")
		grpcServer.GracefulStop()
	}()

	// Start server
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatalf("Failed to serve: %v", err)
	}
}
