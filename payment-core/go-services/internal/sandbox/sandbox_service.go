package sandbox

import (
	"crypto/rand"
	"errors"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

type SandboxEnvironment struct {
	ID             string                 `json:"id"`
	OrganizationID string                 `json:"organizationId"`
	Name           string                 `json:"name"`
	Status         string                 `json:"status"`
	Config         *SandboxConfig         `json:"config"`
	CreatedAt      time.Time              `json:"createdAt"`
	ExpiresAt      *time.Time             `json:"expiresAt,omitempty"`
	Metadata       map[string]interface{} `json:"metadata,omitempty"`
}

type SandboxConfig struct {
	EnableMockResponses bool                   `json:"enableMockResponses"`
	SimulateLatency     bool                   `json:"simulateLatency"`
	LatencyMinMs        int                    `json:"latencyMinMs"`
	LatencyMaxMs        int                    `json:"latencyMaxMs"`
	FailureRate         float64                `json:"failureRate"`
	WebhookURL          string                 `json:"webhookUrl"`
	AutoApproveKYC      bool                   `json:"autoApproveKyc"`
	DefaultCurrency     string                 `json:"defaultCurrency"`
	ProviderOverrides   map[string]interface{} `json:"providerOverrides,omitempty"`
}

type TestAccount struct {
	ID            string    `json:"id"`
	EnvironmentID string    `json:"environmentId"`
	AccountNumber string    `json:"accountNumber"`
	AccountName   string    `json:"accountName"`
	BankCode      string    `json:"bankCode"`
	BankName      string    `json:"bankName"`
	Balance       float64   `json:"balance"`
	Currency      string    `json:"currency"`
	AccountType   string    `json:"accountType"`
	Status        string    `json:"status"`
	CreatedAt     time.Time `json:"createdAt"`
}

type TestBeneficiary struct {
	ID              string    `json:"id"`
	EnvironmentID   string    `json:"environmentId"`
	Name            string    `json:"name"`
	AccountNumber   string    `json:"accountNumber"`
	BankCode        string    `json:"bankCode"`
	BankName        string    `json:"bankName"`
	PhoneNumber     string    `json:"phoneNumber,omitempty"`
	Email           string    `json:"email,omitempty"`
	BeneficiaryType string    `json:"beneficiaryType"`
	CreatedAt       time.Time `json:"createdAt"`
}

type TestTransaction struct {
	ID            string                 `json:"id"`
	EnvironmentID string                 `json:"environmentId"`
	Type          string                 `json:"type"`
	Amount        float64                `json:"amount"`
	Currency      string                 `json:"currency"`
	SourceAccount string                 `json:"sourceAccount"`
	DestAccount   string                 `json:"destAccount"`
	Status        string                 `json:"status"`
	Reference     string                 `json:"reference"`
	ProviderRef   string                 `json:"providerRef,omitempty"`
	CreatedAt     time.Time              `json:"createdAt"`
	CompletedAt   *time.Time             `json:"completedAt,omitempty"`
	Metadata      map[string]interface{} `json:"metadata,omitempty"`
}

type TestWebhook struct {
	ID            string                 `json:"id"`
	EnvironmentID string                 `json:"environmentId"`
	EventType     string                 `json:"eventType"`
	Payload       map[string]interface{} `json:"payload"`
	URL           string                 `json:"url"`
	Status        string                 `json:"status"`
	Attempts      int                    `json:"attempts"`
	LastAttemptAt *time.Time             `json:"lastAttemptAt,omitempty"`
	DeliveredAt   *time.Time             `json:"deliveredAt,omitempty"`
	CreatedAt     time.Time              `json:"createdAt"`
}

type MockProviderResponse struct {
	Provider     string                 `json:"provider"`
	Endpoint     string                 `json:"endpoint"`
	StatusCode   int                    `json:"statusCode"`
	ResponseBody map[string]interface{} `json:"responseBody"`
	Delay        int                    `json:"delay"`
	ErrorMessage string                 `json:"errorMessage,omitempty"`
}

type SandboxStats struct {
	EnvironmentID     string    `json:"environmentId"`
	TotalTransactions int       `json:"totalTransactions"`
	SuccessfulTxns    int       `json:"successfulTransactions"`
	FailedTxns        int       `json:"failedTransactions"`
	TotalVolume       float64   `json:"totalVolume"`
	WebhooksDelivered int       `json:"webhooksDelivered"`
	WebhooksFailed    int       `json:"webhooksFailed"`
	APICallsCount     int       `json:"apiCallsCount"`
	LastActivityAt    time.Time `json:"lastActivityAt"`
}

type SandboxService struct {
	mu                sync.RWMutex
	environments      map[string]*SandboxEnvironment
	testAccounts      map[string]*TestAccount
	testBeneficiaries map[string]*TestBeneficiary
	testTransactions  map[string]*TestTransaction
	testWebhooks      map[string]*TestWebhook
	mockResponses     map[string]*MockProviderResponse
	stats             map[string]*SandboxStats
}

func NewSandboxService() *SandboxService {
	s := &SandboxService{
		environments:      make(map[string]*SandboxEnvironment),
		testAccounts:      make(map[string]*TestAccount),
		testBeneficiaries: make(map[string]*TestBeneficiary),
		testTransactions:  make(map[string]*TestTransaction),
		testWebhooks:      make(map[string]*TestWebhook),
		mockResponses:     make(map[string]*MockProviderResponse),
		stats:             make(map[string]*SandboxStats),
	}
	s.initializeDefaultMockResponses()
	return s
}

func (s *SandboxService) initializeDefaultMockResponses() {
	s.mockResponses["nibss_transfer_success"] = &MockProviderResponse{
		Provider:   "nibss",
		Endpoint:   "/transfer",
		StatusCode: 200,
		ResponseBody: map[string]interface{}{
			"status":       "success",
			"responseCode": "00",
			"message":      "Transaction successful",
			"reference":    "NIBSS_TEST_REF",
		},
		Delay: 500,
	}

	s.mockResponses["nibss_transfer_failed"] = &MockProviderResponse{
		Provider:   "nibss",
		Endpoint:   "/transfer",
		StatusCode: 400,
		ResponseBody: map[string]interface{}{
			"status":       "failed",
			"responseCode": "51",
			"message":      "Insufficient funds",
		},
		Delay:        200,
		ErrorMessage: "Insufficient funds",
	}

	s.mockResponses["nibss_account_verify"] = &MockProviderResponse{
		Provider:   "nibss",
		Endpoint:   "/account/verify",
		StatusCode: 200,
		ResponseBody: map[string]interface{}{
			"status":        "success",
			"accountName":   "TEST ACCOUNT HOLDER",
			"accountNumber": "0123456789",
			"bankCode":      "058",
		},
		Delay: 300,
	}

	s.mockResponses["coinbase_payment_success"] = &MockProviderResponse{
		Provider:   "coinbase",
		Endpoint:   "/charges",
		StatusCode: 201,
		ResponseBody: map[string]interface{}{
			"data": map[string]interface{}{
				"id":     "COINBASE_TEST_CHARGE",
				"status": "COMPLETED",
				"pricing": map[string]interface{}{
					"local": map[string]interface{}{
						"amount":   "100.00",
						"currency": "USD",
					},
				},
			},
		},
		Delay: 1000,
	}

	s.mockResponses["circle_usdc_transfer"] = &MockProviderResponse{
		Provider:   "circle",
		Endpoint:   "/transfers",
		StatusCode: 201,
		ResponseBody: map[string]interface{}{
			"data": map[string]interface{}{
				"id":     "CIRCLE_TEST_TRANSFER",
				"status": "complete",
				"amount": map[string]interface{}{
					"amount":   "100.00",
					"currency": "USD",
				},
			},
		},
		Delay: 800,
	}

	s.mockResponses["mobile_money_success"] = &MockProviderResponse{
		Provider:   "mobile_money",
		Endpoint:   "/transfer",
		StatusCode: 200,
		ResponseBody: map[string]interface{}{
			"status":        "success",
			"reference":     "MM_TEST_REF",
			"message":       "Transfer completed",
			"recipientName": "TEST RECIPIENT",
		},
		Delay: 600,
	}

	s.mockResponses["kyc_verify_success"] = &MockProviderResponse{
		Provider:   "smile_identity",
		Endpoint:   "/verify",
		StatusCode: 200,
		ResponseBody: map[string]interface{}{
			"status":     "verified",
			"confidence": 0.95,
			"result": map[string]interface{}{
				"firstName":   "TEST",
				"lastName":    "USER",
				"dateOfBirth": "1990-01-01",
				"idNumber":    "12345678901",
			},
		},
		Delay: 2000,
	}
}

func (s *SandboxService) CreateEnvironment(orgID, name string, config *SandboxConfig) (*SandboxEnvironment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if config == nil {
		return nil, errors.New("sandbox configuration is required; mock responses and automatic KYC approval must be explicitly configured")
	}

	env := &SandboxEnvironment{
		ID:             s.generateID("sbx"),
		OrganizationID: orgID,
		Name:           name,
		Status:         "active",
		Config:         config,
		CreatedAt:      time.Now(),
	}

	s.environments[env.ID] = env
	s.stats[env.ID] = &SandboxStats{
		EnvironmentID:  env.ID,
		LastActivityAt: time.Now(),
	}

	s.seedTestData(env.ID)

	return env, nil
}

func (s *SandboxService) seedTestData(envID string) {
	testAccounts := []struct {
		number   string
		name     string
		bankCode string
		bankName string
		balance  float64
	}{
		{"0123456789", "Test Sender Account", "058", "GTBank", 10000000},
		{"9876543210", "Test Receiver Account", "044", "Access Bank", 5000000},
		{"1111111111", "Test Business Account", "057", "Zenith Bank", 50000000},
		{"2222222222", "Test Savings Account", "033", "UBA", 2000000},
		{"3333333333", "Test Current Account", "011", "First Bank", 15000000},
	}

	for _, ta := range testAccounts {
		account := &TestAccount{
			ID:            s.generateID("acc"),
			EnvironmentID: envID,
			AccountNumber: ta.number,
			AccountName:   ta.name,
			BankCode:      ta.bankCode,
			BankName:      ta.bankName,
			Balance:       ta.balance,
			Currency:      "NGN",
			AccountType:   "savings",
			Status:        "active",
			CreatedAt:     time.Now(),
		}
		s.testAccounts[account.ID] = account
	}

	testBeneficiaries := []struct {
		name    string
		account string
		bank    string
		phone   string
	}{
		{"John Doe", "0123456789", "058", "08012345678"},
		{"Jane Smith", "9876543210", "044", "08087654321"},
		{"Acme Corp", "1111111111", "057", ""},
		{"Mobile User", "", "", "08011112222"},
	}

	for _, tb := range testBeneficiaries {
		beneficiary := &TestBeneficiary{
			ID:              s.generateID("ben"),
			EnvironmentID:   envID,
			Name:            tb.name,
			AccountNumber:   tb.account,
			BankCode:        tb.bank,
			PhoneNumber:     tb.phone,
			BeneficiaryType: "individual",
			CreatedAt:       time.Now(),
		}
		if tb.account == "" {
			beneficiary.BeneficiaryType = "mobile_money"
		}
		s.testBeneficiaries[beneficiary.ID] = beneficiary
	}
}

func (s *SandboxService) GetEnvironment(envID string) *SandboxEnvironment {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.environments[envID]
}

func (s *SandboxService) GetEnvironmentByOrg(orgID string) *SandboxEnvironment {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, env := range s.environments {
		if env.OrganizationID == orgID && env.Status == "active" {
			return env
		}
	}
	return nil
}

func (s *SandboxService) UpdateEnvironmentConfig(envID string, config *SandboxConfig) (*SandboxEnvironment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	env, exists := s.environments[envID]
	if !exists {
		return nil, fmt.Errorf("environment not found: %s", envID)
	}

	env.Config = config
	return env, nil
}

func (s *SandboxService) ResetEnvironment(envID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	env, exists := s.environments[envID]
	if !exists {
		return fmt.Errorf("environment not found: %s", envID)
	}

	for id, acc := range s.testAccounts {
		if acc.EnvironmentID == envID {
			delete(s.testAccounts, id)
		}
	}
	for id, ben := range s.testBeneficiaries {
		if ben.EnvironmentID == envID {
			delete(s.testBeneficiaries, id)
		}
	}
	for id, txn := range s.testTransactions {
		if txn.EnvironmentID == envID {
			delete(s.testTransactions, id)
		}
	}
	for id, wh := range s.testWebhooks {
		if wh.EnvironmentID == envID {
			delete(s.testWebhooks, id)
		}
	}

	s.stats[envID] = &SandboxStats{
		EnvironmentID:  envID,
		LastActivityAt: time.Now(),
	}

	s.seedTestData(env.ID)

	return nil
}

func (s *SandboxService) CreateTestAccount(envID string, account *TestAccount) (*TestAccount, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.environments[envID]; !exists {
		return nil, fmt.Errorf("environment not found: %s", envID)
	}

	account.ID = s.generateID("acc")
	account.EnvironmentID = envID
	account.CreatedAt = time.Now()
	if account.Status == "" {
		account.Status = "active"
	}
	if account.Currency == "" {
		account.Currency = "NGN"
	}

	s.testAccounts[account.ID] = account
	return account, nil
}

func (s *SandboxService) GetTestAccounts(envID string) []*TestAccount {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var accounts []*TestAccount
	for _, acc := range s.testAccounts {
		if acc.EnvironmentID == envID {
			accounts = append(accounts, acc)
		}
	}
	return accounts
}

func (s *SandboxService) CreateTestBeneficiary(envID string, beneficiary *TestBeneficiary) (*TestBeneficiary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.environments[envID]; !exists {
		return nil, fmt.Errorf("environment not found: %s", envID)
	}

	beneficiary.ID = s.generateID("ben")
	beneficiary.EnvironmentID = envID
	beneficiary.CreatedAt = time.Now()

	s.testBeneficiaries[beneficiary.ID] = beneficiary
	return beneficiary, nil
}

func (s *SandboxService) GetTestBeneficiaries(envID string) []*TestBeneficiary {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var beneficiaries []*TestBeneficiary
	for _, ben := range s.testBeneficiaries {
		if ben.EnvironmentID == envID {
			beneficiaries = append(beneficiaries, ben)
		}
	}
	return beneficiaries
}

func (s *SandboxService) SimulateTransaction(envID string, txnType string, amount float64, sourceAccount, destAccount string, metadata map[string]interface{}) (*TestTransaction, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	env, exists := s.environments[envID]
	if !exists {
		return nil, fmt.Errorf("environment not found: %s", envID)
	}

	txn := &TestTransaction{
		ID:            s.generateID("txn"),
		EnvironmentID: envID,
		Type:          txnType,
		Amount:        amount,
		Currency:      env.Config.DefaultCurrency,
		SourceAccount: sourceAccount,
		DestAccount:   destAccount,
		Status:        "pending",
		Reference:     s.generateReference(),
		CreatedAt:     time.Now(),
		Metadata:      metadata,
	}

	shouldFail := false
	if env.Config.FailureRate > 0 {
		randBytes := make([]byte, 1)
		rand.Read(randBytes)
		if float64(randBytes[0])/255.0 < env.Config.FailureRate {
			shouldFail = true
		}
	}

	if shouldFail {
		txn.Status = "failed"
		txn.Metadata["failureReason"] = "Simulated failure for testing"
	} else {
		txn.Status = "completed"
		now := time.Now()
		txn.CompletedAt = &now
		txn.ProviderRef = fmt.Sprintf("PROV_%s", s.generateID("ref"))
	}

	s.testTransactions[txn.ID] = txn

	stats := s.stats[envID]
	stats.TotalTransactions++
	if txn.Status == "completed" {
		stats.SuccessfulTxns++
		stats.TotalVolume += amount
	} else {
		stats.FailedTxns++
	}
	stats.LastActivityAt = time.Now()

	if env.Config.WebhookURL != "" {
		s.queueWebhook(envID, "transaction.completed", map[string]interface{}{
			"transactionId": txn.ID,
			"status":        txn.Status,
			"amount":        txn.Amount,
			"currency":      txn.Currency,
			"reference":     txn.Reference,
		})
	}

	return txn, nil
}

func (s *SandboxService) GetTestTransactions(envID string, limit int) []*TestTransaction {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var transactions []*TestTransaction
	for _, txn := range s.testTransactions {
		if txn.EnvironmentID == envID {
			transactions = append(transactions, txn)
		}
	}

	if limit > 0 && len(transactions) > limit {
		transactions = transactions[len(transactions)-limit:]
	}

	return transactions
}

func (s *SandboxService) GetTestTransaction(txnID string) *TestTransaction {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.testTransactions[txnID]
}

func (s *SandboxService) queueWebhook(envID, eventType string, payload map[string]interface{}) {
	webhook := &TestWebhook{
		ID:            s.generateID("wh"),
		EnvironmentID: envID,
		EventType:     eventType,
		Payload:       payload,
		URL:           s.environments[envID].Config.WebhookURL,
		Status:        "pending",
		Attempts:      0,
		CreatedAt:     time.Now(),
	}
	s.testWebhooks[webhook.ID] = webhook
}

func (s *SandboxService) SimulateWebhookDelivery(webhookID string, success bool) (*TestWebhook, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	webhook, exists := s.testWebhooks[webhookID]
	if !exists {
		return nil, fmt.Errorf("webhook not found: %s", webhookID)
	}

	webhook.Attempts++
	now := time.Now()
	webhook.LastAttemptAt = &now

	if success {
		webhook.Status = "delivered"
		webhook.DeliveredAt = &now
		if stats, ok := s.stats[webhook.EnvironmentID]; ok {
			stats.WebhooksDelivered++
		}
	} else {
		if webhook.Attempts >= 3 {
			webhook.Status = "failed"
			if stats, ok := s.stats[webhook.EnvironmentID]; ok {
				stats.WebhooksFailed++
			}
		} else {
			webhook.Status = "retrying"
		}
	}

	return webhook, nil
}

func (s *SandboxService) GetPendingWebhooks(envID string) []*TestWebhook {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var webhooks []*TestWebhook
	for _, wh := range s.testWebhooks {
		if wh.EnvironmentID == envID && (wh.Status == "pending" || wh.Status == "retrying") {
			webhooks = append(webhooks, wh)
		}
	}
	return webhooks
}

func (s *SandboxService) GetWebhookHistory(envID string, limit int) []*TestWebhook {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var webhooks []*TestWebhook
	for _, wh := range s.testWebhooks {
		if wh.EnvironmentID == envID {
			webhooks = append(webhooks, wh)
		}
	}

	if limit > 0 && len(webhooks) > limit {
		webhooks = webhooks[len(webhooks)-limit:]
	}

	return webhooks
}

func (s *SandboxService) GetMockResponse(provider, endpoint string) *MockProviderResponse {
	s.mu.RLock()
	defer s.mu.RUnlock()

	key := fmt.Sprintf("%s_%s", provider, endpoint)
	for mockKey, response := range s.mockResponses {
		if mockKey == key || response.Provider == provider && response.Endpoint == endpoint {
			return response
		}
	}
	return nil
}

func (s *SandboxService) SetMockResponse(envID string, response *MockProviderResponse) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.environments[envID]; !exists {
		return fmt.Errorf("environment not found: %s", envID)
	}

	key := fmt.Sprintf("%s_%s_%s", envID, response.Provider, response.Endpoint)
	s.mockResponses[key] = response
	return nil
}

func (s *SandboxService) GetStats(envID string) *SandboxStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.stats[envID]
}

func (s *SandboxService) RecordAPICall(envID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if stats, exists := s.stats[envID]; exists {
		stats.APICallsCount++
		stats.LastActivityAt = time.Now()
	}
}

func (s *SandboxService) VerifyTestAccount(envID, accountNumber, bankCode string) (*TestAccount, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, acc := range s.testAccounts {
		if acc.EnvironmentID == envID && acc.AccountNumber == accountNumber && acc.BankCode == bankCode {
			return acc, nil
		}
	}

	return &TestAccount{
		ID:            s.generateID("acc"),
		EnvironmentID: envID,
		AccountNumber: accountNumber,
		AccountName:   "VERIFIED TEST ACCOUNT",
		BankCode:      bankCode,
		BankName:      "Test Bank",
		Balance:       1000000,
		Currency:      "NGN",
		AccountType:   "savings",
		Status:        "active",
		CreatedAt:     time.Now(),
	}, nil
}

func (s *SandboxService) SimulateKYCVerification(envID string, idNumber, idType string) (map[string]interface{}, error) {
	s.mu.RLock()
	env, exists := s.environments[envID]
	s.mu.RUnlock()

	if !exists {
		return nil, fmt.Errorf("environment not found: %s", envID)
	}

	result := map[string]interface{}{
		"status":     "verified",
		"confidence": 0.95,
		"idNumber":   idNumber,
		"idType":     idType,
		"result": map[string]interface{}{
			"firstName":   "TEST",
			"lastName":    "USER",
			"dateOfBirth": "1990-01-01",
			"address":     "123 Test Street, Lagos",
		},
	}

	if !env.Config.AutoApproveKYC {
		randBytes := make([]byte, 1)
		rand.Read(randBytes)
		if float64(randBytes[0])/255.0 < 0.1 {
			result["status"] = "failed"
			result["confidence"] = 0.3
			result["failureReason"] = "ID verification failed"
		}
	}

	return result, nil
}

func (s *SandboxService) generateID(prefix string) string {
	bytes := make([]byte, 8)
	rand.Read(bytes)
	return fmt.Sprintf("%s_%s", prefix, hex.EncodeToString(bytes))
}

func (s *SandboxService) generateReference() string {
	bytes := make([]byte, 8)
	rand.Read(bytes)
	return fmt.Sprintf("SBX_%d_%s", time.Now().UnixNano()/1000000, hex.EncodeToString(bytes)[:8])
}
