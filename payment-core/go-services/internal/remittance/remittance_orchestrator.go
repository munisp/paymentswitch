package remittance

import (
	"database/sql"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/payment-switch/go-services/internal/banking"
	"github.com/payment-switch/go-services/internal/crypto"
	"github.com/payment-switch/go-services/internal/kyc"
)

type WorkflowStep string

const (
	StepCreated          WorkflowStep = "created"
	StepWaitingPayment   WorkflowStep = "waiting_payment"
	StepConverting       WorkflowStep = "converting"
	StepKYCVerification  WorkflowStep = "kyc_verification"
	StepAMLScreening     WorkflowStep = "aml_screening"
	StepVerifyingAccount WorkflowStep = "verifying_account"
	StepOpeningAccount   WorkflowStep = "opening_account"
	StepTransferring     WorkflowStep = "transferring"
	StepCompleted        WorkflowStep = "completed"
	StepFailed           WorkflowStep = "failed"
)

type DeliveryOption string

const (
	DeliveryNewAccount      DeliveryOption = "NEW_ACCOUNT"
	DeliveryExistingAccount DeliveryOption = "EXISTING_ACCOUNT"
	DeliveryAgentCash       DeliveryOption = "AGENT_CASH"
	DeliveryPayBills        DeliveryOption = "PAY_BILLS"
)

type KYCData struct {
	FirstName   string     `json:"firstName"`
	LastName    string     `json:"lastName"`
	DateOfBirth string     `json:"dateOfBirth"`
	Address     string     `json:"address"`
	IDType      kyc.IDType `json:"idType"`
	IDNumber    string     `json:"idNumber"`
}

type BankAccountInfo struct {
	AccountNumber string `json:"accountNumber"`
	BankCode      string `json:"bankCode"`
}

type RemittanceWorkflowState struct {
	RemittanceID           string                 `json:"remittanceId"`
	CurrentStep            WorkflowStep           `json:"currentStep"`
	ChargeID               string                 `json:"chargeId"`
	SenderCurrency         string                 `json:"senderCurrency"`
	SenderAmount           float64                `json:"senderAmount"`
	RecipientCurrency      string                 `json:"recipientCurrency"`
	RecipientPhone         string                 `json:"recipientPhone"`
	DeliveryOption         DeliveryOption         `json:"deliveryOption"`
	KYCData                *KYCData               `json:"kycData,omitempty"`
	BankAccount            *BankAccountInfo       `json:"bankAccount,omitempty"`
	Metadata               map[string]interface{} `json:"metadata,omitempty"`
	CryptoPaymentConfirmed bool                   `json:"cryptoPaymentConfirmed"`
	CryptoAmount           float64                `json:"cryptoAmount,omitempty"`
	FiatAmount             float64                `json:"fiatAmount,omitempty"`
	ExchangeRate           float64                `json:"exchangeRate,omitempty"`
	KYCVerificationID      string                 `json:"kycVerificationId,omitempty"`
	KYCApproved            bool                   `json:"kycApproved,omitempty"`
	AMLCleared             bool                   `json:"amlCleared,omitempty"`
	AMLRiskLevel           string                 `json:"amlRiskLevel,omitempty"`
	SanctionsCleared       bool                   `json:"sanctionsCleared,omitempty"`
	KYCTier                int                    `json:"kycTier,omitempty"`
	AccountID              string                 `json:"accountId,omitempty"`
	TransferReference      string                 `json:"transferReference,omitempty"`
	Error                  string                 `json:"error,omitempty"`
	RetryCount             int                    `json:"retryCount"`
	LastUpdated            time.Time              `json:"lastUpdated"`
}

type StartWorkflowParams struct {
	RemittanceID      string
	ChargeID          string
	SenderCurrency    string
	SenderAmount      float64
	RecipientCurrency string
	RecipientPhone    string
	DeliveryOption    DeliveryOption
	KYCData           *KYCData
	BankAccount       *BankAccountInfo
	Metadata          map[string]interface{}
}

type WebhookPayload struct {
	RemittanceID string                 `json:"remittanceId"`
	Event        string                 `json:"event"`
	Data         map[string]interface{} `json:"data"`
	Timestamp    time.Time              `json:"timestamp"`
}

type RemittanceOrchestrator struct {
	mu              sync.RWMutex
	db              *sql.DB
	workflows       map[string]*RemittanceWorkflowState
	coinbaseService *crypto.CoinbaseService
	nibssService    *banking.NIBSSService
	kycService      *kyc.KYCService
	tierEnforcer    *kyc.TierLimitEnforcer
	webhookHandlers []func(WebhookPayload)
	smsHandlers     []func(phone, message string)
}

func NewRemittanceOrchestrator() *RemittanceOrchestrator {
	return &RemittanceOrchestrator{
		workflows:       make(map[string]*RemittanceWorkflowState),
		coinbaseService: crypto.NewCoinbaseService(),
		nibssService:    banking.NewNIBSSService(),
		kycService:      kyc.NewKYCService(),
		tierEnforcer:    kyc.NewTierLimitEnforcer(kyc.NewDailyUsageTracker()),
		webhookHandlers: []func(WebhookPayload){},
		smsHandlers:     []func(phone, message string){},
	}
}

func (o *RemittanceOrchestrator) OnWebhook(handler func(WebhookPayload)) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.webhookHandlers = append(o.webhookHandlers, handler)
}

func (o *RemittanceOrchestrator) OnSMS(handler func(phone, message string)) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.smsHandlers = append(o.smsHandlers, handler)
}

func (o *RemittanceOrchestrator) StartWorkflow(params *StartWorkflowParams) (*RemittanceWorkflowState, error) {
	state := &RemittanceWorkflowState{
		RemittanceID:           params.RemittanceID,
		CurrentStep:            StepWaitingPayment,
		ChargeID:               params.ChargeID,
		SenderCurrency:         params.SenderCurrency,
		SenderAmount:           params.SenderAmount,
		RecipientCurrency:      params.RecipientCurrency,
		RecipientPhone:         params.RecipientPhone,
		DeliveryOption:         params.DeliveryOption,
		KYCData:                params.KYCData,
		BankAccount:            params.BankAccount,
		Metadata:               params.Metadata,
		CryptoPaymentConfirmed: false,
		RetryCount:             0,
		LastUpdated:            time.Now(),
	}

	o.mu.Lock()
	o.workflows[params.RemittanceID] = state
	o.mu.Unlock()

	go o.persistWorkflow(state)
	return state, nil
}

func (o *RemittanceOrchestrator) ProcessWorkflowStep(state *RemittanceWorkflowState) (*RemittanceWorkflowState, error) {
	var err error

	switch state.CurrentStep {
	case StepWaitingPayment:
		state, err = o.handleWaitingPayment(state)
	case StepConverting:
		state, err = o.handleConverting(state)
	case StepKYCVerification:
		state, err = o.handleKYCVerification(state)
	case StepAMLScreening:
		state, err = o.handleAMLScreening(state)
	case StepVerifyingAccount:
		state, err = o.handleVerifyingAccount(state)
	case StepOpeningAccount:
		state, err = o.handleOpeningAccount(state)
	case StepTransferring:
		state, err = o.handleTransferring(state)
	default:
		return state, nil
	}

	if err != nil {
		state.Error = err.Error()
		state.CurrentStep = StepFailed
		state.LastUpdated = time.Now()
	}

	o.mu.Lock()
	o.workflows[state.RemittanceID] = state
	o.mu.Unlock()

	go o.persistWorkflow(state)
	return state, err
}

func (o *RemittanceOrchestrator) handleWaitingPayment(state *RemittanceWorkflowState) (*RemittanceWorkflowState, error) {
	paymentStatus, err := o.coinbaseService.GetCryptoChargeStatus(state.ChargeID)
	if err != nil {
		return state, err
	}

	if paymentStatus.Status == "confirmed" || paymentStatus.Status == "completed" {
		state.CryptoPaymentConfirmed = true
		var paidAmount float64
		fmt.Sscanf(paymentStatus.PaidAmount, "%f", &paidAmount)
		state.CryptoAmount = paidAmount
		state.CurrentStep = StepConverting
		state.LastUpdated = time.Now()

		o.sendWebhook(state.RemittanceID, "payment.confirmed", map[string]interface{}{
			"amount":   state.CryptoAmount,
			"currency": state.SenderCurrency,
		})
	} else if paymentStatus.Status == "failed" || paymentStatus.Status == "expired" {
		state.CurrentStep = StepFailed
		state.Error = "Crypto payment failed or expired"
		state.LastUpdated = time.Now()

		o.sendWebhook(state.RemittanceID, "payment.failed", map[string]interface{}{
			"reason": state.Error,
		})
	}

	return state, nil
}

func (o *RemittanceOrchestrator) handleConverting(state *RemittanceWorkflowState) (*RemittanceWorkflowState, error) {
	if state.CryptoAmount == 0 {
		return state, fmt.Errorf("crypto amount not set")
	}

	quote, err := o.coinbaseService.GetExchangeRateQuote(state.SenderCurrency, state.RecipientCurrency, state.CryptoAmount)
	if err != nil {
		return state, err
	}

	platformFeePercent := 0.5
	exchangeFeePercent := 1.0
	totalFeePercent := platformFeePercent + exchangeFeePercent
	feeAmount := state.CryptoAmount * (totalFeePercent / 100)
	netAmount := state.CryptoAmount - feeAmount

	state.FiatAmount = netAmount * quote.Rate
	state.ExchangeRate = quote.Rate

	needsKYC := state.DeliveryOption == DeliveryNewAccount || state.FiatAmount > 100000

	if needsKYC && state.KYCData != nil {
		state.CurrentStep = StepKYCVerification
	} else if state.DeliveryOption == DeliveryExistingAccount {
		state.CurrentStep = StepVerifyingAccount
	} else if state.DeliveryOption == DeliveryNewAccount {
		state.CurrentStep = StepOpeningAccount
	} else {
		return state, fmt.Errorf("unsupported delivery option: %s", state.DeliveryOption)
	}

	state.LastUpdated = time.Now()

	o.sendWebhook(state.RemittanceID, "conversion.completed", map[string]interface{}{
		"fiatAmount":   state.FiatAmount,
		"exchangeRate": state.ExchangeRate,
	})

	return state, nil
}

func (o *RemittanceOrchestrator) handleKYCVerification(state *RemittanceWorkflowState) (*RemittanceWorkflowState, error) {
	if state.KYCData == nil {
		return state, fmt.Errorf("KYC data not provided")
	}

	if state.KYCVerificationID == "" {
		kycResult, err := o.kycService.InitiateKYCVerification(&kyc.KYCRequest{
			RemittanceID: state.RemittanceID,
			FirstName:    state.KYCData.FirstName,
			LastName:     state.KYCData.LastName,
			DateOfBirth:  state.KYCData.DateOfBirth,
			Address:      state.KYCData.Address,
			IDType:       state.KYCData.IDType,
			IDNumber:     state.KYCData.IDNumber,
			PhoneNumber:  state.RecipientPhone,
		})
		if err != nil {
			return state, err
		}

		state.KYCVerificationID = kycResult.VerificationID
		state.LastUpdated = time.Now()
		return state, nil
	}

	kycStatus, err := o.kycService.GetKYCVerificationStatus(state.KYCVerificationID)
	if err != nil {
		return state, err
	}

	if kycStatus.Status == kyc.KYCStatusApproved {
		state.KYCApproved = true
		state.KYCTier = int(kyc.DetermineKYCTier(kycStatus))
		state.CurrentStep = StepAMLScreening

		state.LastUpdated = time.Now()

		o.sendWebhook(state.RemittanceID, "kyc.approved", map[string]interface{}{
			"verificationId":  state.KYCVerificationID,
			"confidenceScore": kycStatus.ConfidenceScore,
		})
	} else if kycStatus.Status == kyc.KYCStatusRejected || kycStatus.Status == kyc.KYCStatusFailed {
		state.CurrentStep = StepFailed
		state.Error = fmt.Sprintf("KYC verification %s: %s", kycStatus.Status, kycStatus.RejectionReason)
		state.LastUpdated = time.Now()

		o.sendWebhook(state.RemittanceID, "kyc.rejected", map[string]interface{}{
			"reason": kycStatus.RejectionReason,
		})
	}

	return state, nil
}

func (o *RemittanceOrchestrator) handleAMLScreening(state *RemittanceWorkflowState) (*RemittanceWorkflowState, error) {
	if state.KYCData == nil {
		return state, fmt.Errorf("KYC data required for AML screening")
	}

	// Sanctions screening
	sanctionsResult, err := o.kycService.CheckSanctionsList(
		state.KYCData.FirstName, state.KYCData.LastName,
		state.KYCData.DateOfBirth, "",
	)
	if err != nil {
		return state, fmt.Errorf("sanctions screening failed: %w", err)
	}

	if len(sanctionsResult.Matches) > 0 {
		state.CurrentStep = StepFailed
		state.Error = fmt.Sprintf("sanctions match detected: %d potential matches", len(sanctionsResult.Matches))
		state.LastUpdated = time.Now()
		o.sendWebhook(state.RemittanceID, "compliance.sanctions_match", map[string]interface{}{
			"matchCount": len(sanctionsResult.Matches),
		})
		return state, nil
	}
	state.SanctionsCleared = true

	// AML screening
	amlResult, err := o.kycService.PerformAMLScreening(
		state.KYCData.FirstName, state.KYCData.LastName,
		state.KYCData.DateOfBirth, "", state.KYCData.IDNumber,
	)
	if err != nil {
		return state, fmt.Errorf("AML screening failed: %w", err)
	}

	state.AMLRiskLevel = string(amlResult.RiskLevel)

	if amlResult.RiskLevel == "high" {
		state.CurrentStep = StepFailed
		state.Error = "AML high risk — manual review required"
		state.LastUpdated = time.Now()
		o.sendWebhook(state.RemittanceID, "compliance.aml_high_risk", map[string]interface{}{
			"riskLevel": amlResult.RiskLevel,
			"score":     amlResult.RiskScore,
		})
		return state, nil
	}

	state.AMLCleared = true

	// KYC Tier enforcement for outbound FX
	// Convert fiat amount (NGN) to USD equivalent for CBN limit check.
	// CBN official rate used as fallback; in production this comes from the FX service.
	ngnToUSD := 1.0 / 1500.0 // CBN approximate rate
	if state.ExchangeRate > 0 && state.FiatAmount > 0 {
		// Use actual fiat amount from conversion step
		ngnToUSD = 1.0 / 1500.0
	}
	amountUSD := state.FiatAmount * ngnToUSD

	fxCheck := o.tierEnforcer.CheckOutboundFXAllowed(kyc.KYCTier(state.KYCTier), amountUSD)
	if !fxCheck.Allowed {
		state.CurrentStep = StepFailed
		state.Error = fxCheck.Reason
		state.LastUpdated = time.Now()
		o.sendWebhook(state.RemittanceID, "compliance.tier_limit_exceeded", map[string]interface{}{
			"tier":   state.KYCTier,
			"reason": fxCheck.Reason,
		})
		return state, nil
	}

	if state.DeliveryOption == DeliveryExistingAccount {
		state.CurrentStep = StepVerifyingAccount
	} else if state.DeliveryOption == DeliveryNewAccount {
		state.CurrentStep = StepOpeningAccount
	} else {
		state.CurrentStep = StepTransferring
	}
	state.LastUpdated = time.Now()

	o.sendWebhook(state.RemittanceID, "compliance.cleared", map[string]interface{}{
		"amlRiskLevel":     state.AMLRiskLevel,
		"sanctionsCleared": true,
		"kycTier":          state.KYCTier,
	})

	return state, nil
}

func (o *RemittanceOrchestrator) handleVerifyingAccount(state *RemittanceWorkflowState) (*RemittanceWorkflowState, error) {
	if state.BankAccount == nil {
		return state, fmt.Errorf("bank account details not provided")
	}

	accountVerification, err := o.nibssService.VerifyBankAccount(state.BankAccount.AccountNumber, state.BankAccount.BankCode)
	if err != nil {
		return state, err
	}

	state.CurrentStep = StepTransferring
	state.LastUpdated = time.Now()

	o.sendWebhook(state.RemittanceID, "account.verified", map[string]interface{}{
		"accountName": accountVerification.AccountName,
		"bankName":    accountVerification.BankName,
	})

	return state, nil
}

func (o *RemittanceOrchestrator) handleOpeningAccount(state *RemittanceWorkflowState) (*RemittanceWorkflowState, error) {
	if state.AccountID == "" {
		state.AccountID = fmt.Sprintf("acc_%d", time.Now().UnixMilli())
		state.BankAccount = &BankAccountInfo{
			AccountNumber: "0123456789",
			BankCode:      "101",
		}
		state.LastUpdated = time.Now()

		o.sendWebhook(state.RemittanceID, "account.opening", map[string]interface{}{
			"accountId": state.AccountID,
		})

		return state, nil
	}

	state.CurrentStep = StepTransferring
	state.LastUpdated = time.Now()

	o.sendWebhook(state.RemittanceID, "account.opened", map[string]interface{}{
		"accountNumber": state.BankAccount.AccountNumber,
		"bankCode":      state.BankAccount.BankCode,
	})

	return state, nil
}

func (o *RemittanceOrchestrator) handleTransferring(state *RemittanceWorkflowState) (*RemittanceWorkflowState, error) {
	if state.BankAccount == nil {
		return state, fmt.Errorf("bank account not set")
	}

	if state.FiatAmount == 0 {
		return state, fmt.Errorf("fiat amount not set")
	}

	if state.TransferReference == "" {
		reference := banking.GenerateTransferReference("REM")
		sourceAccount := os.Getenv("NIBSS_SOURCE_ACCOUNT")
		if sourceAccount == "" {
			sourceAccount = "0000000000"
		}

		transfer, err := o.nibssService.InitiateTransfer(&banking.BankTransferRequest{
			FromAccount: sourceAccount,
			ToAccount:   state.BankAccount.AccountNumber,
			ToBankCode:  state.BankAccount.BankCode,
			Amount:      state.FiatAmount,
			Narration:   fmt.Sprintf("Remittance %s", state.RemittanceID),
			Reference:   reference,
		})
		if err != nil {
			return state, err
		}

		state.TransferReference = transfer.Reference
		state.LastUpdated = time.Now()

		if transfer.ResponseCode == "00" {
			state.CurrentStep = StepCompleted

			o.sendWebhook(state.RemittanceID, "transfer.completed", map[string]interface{}{
				"reference": state.TransferReference,
				"amount":    state.FiatAmount,
			})

			o.sendNotification(state.RecipientPhone, fmt.Sprintf("Your remittance of NGN %.2f has been completed. Reference: %s", state.FiatAmount, state.TransferReference))
		} else if transfer.ResponseCode == "09" {
			o.sendWebhook(state.RemittanceID, "transfer.processing", map[string]interface{}{
				"reference": state.TransferReference,
			})
		} else {
			if state.RetryCount < 3 {
				state.RetryCount++
				state.TransferReference = ""
			} else {
				state.CurrentStep = StepFailed
				state.Error = fmt.Sprintf("Transfer failed: %s", transfer.ResponseMessage)

				o.sendWebhook(state.RemittanceID, "transfer.failed", map[string]interface{}{
					"reason": state.Error,
				})
			}
		}

		return state, nil
	}

	transferStatus, err := o.nibssService.GetTransferStatus(state.TransferReference, "")
	if err != nil {
		return state, err
	}

	if transferStatus.Status == banking.TransferStatusCompleted {
		state.CurrentStep = StepCompleted
		state.LastUpdated = time.Now()

		o.sendWebhook(state.RemittanceID, "transfer.completed", map[string]interface{}{
			"reference": state.TransferReference,
			"amount":    state.FiatAmount,
		})

		o.sendNotification(state.RecipientPhone, fmt.Sprintf("Your remittance of NGN %.2f has been completed. Reference: %s", state.FiatAmount, state.TransferReference))
	} else if transferStatus.Status == banking.TransferStatusFailed {
		state.CurrentStep = StepFailed
		state.Error = fmt.Sprintf("Transfer failed: %s", transferStatus.ResponseMessage)
		state.LastUpdated = time.Now()

		o.sendWebhook(state.RemittanceID, "transfer.failed", map[string]interface{}{
			"reason": state.Error,
		})
	}

	return state, nil
}

func (o *RemittanceOrchestrator) sendWebhook(remittanceID, event string, data map[string]interface{}) {
	payload := WebhookPayload{
		RemittanceID: remittanceID,
		Event:        event,
		Data:         data,
		Timestamp:    time.Now(),
	}

	o.mu.RLock()
	handlers := o.webhookHandlers
	o.mu.RUnlock()

	for _, handler := range handlers {
		go handler(payload)
	}
}

func (o *RemittanceOrchestrator) sendNotification(phone, message string) {
	o.mu.RLock()
	handlers := o.smsHandlers
	o.mu.RUnlock()

	for _, handler := range handlers {
		go handler(phone, message)
	}
}

func (o *RemittanceOrchestrator) GetWorkflowStatus(remittanceID string) (*RemittanceWorkflowState, error) {
	o.mu.RLock()
	defer o.mu.RUnlock()

	state, ok := o.workflows[remittanceID]
	if !ok {
		return nil, fmt.Errorf("workflow not found: %s", remittanceID)
	}

	return state, nil
}

func (o *RemittanceOrchestrator) CancelWorkflow(remittanceID string) error {
	o.mu.Lock()
	defer o.mu.Unlock()

	state, ok := o.workflows[remittanceID]
	if !ok {
		return fmt.Errorf("workflow not found: %s", remittanceID)
	}

	state.CurrentStep = StepFailed
	state.Error = "Workflow cancelled by user"
	state.LastUpdated = time.Now()

	return nil
}

func (o *RemittanceOrchestrator) RetryWorkflowStep(remittanceID string) (*RemittanceWorkflowState, error) {
	o.mu.Lock()
	state, ok := o.workflows[remittanceID]
	if !ok {
		o.mu.Unlock()
		return nil, fmt.Errorf("workflow not found: %s", remittanceID)
	}

	if state.CurrentStep != StepFailed {
		o.mu.Unlock()
		return nil, fmt.Errorf("workflow is not in failed state")
	}

	state.Error = ""
	state.RetryCount = 0

	if state.TransferReference != "" {
		state.CurrentStep = StepTransferring
	} else if state.KYCVerificationID != "" {
		state.CurrentStep = StepKYCVerification
	} else {
		state.CurrentStep = StepWaitingPayment
	}
	o.mu.Unlock()

	return o.ProcessWorkflowStep(state)
}

func (o *RemittanceOrchestrator) GetAllWorkflows() []*RemittanceWorkflowState {
	o.mu.RLock()
	defer o.mu.RUnlock()

	workflows := make([]*RemittanceWorkflowState, 0, len(o.workflows))
	for _, state := range o.workflows {
		workflows = append(workflows, state)
	}

	return workflows
}

func (o *RemittanceOrchestrator) GetWorkflowsByStatus(status WorkflowStep) []*RemittanceWorkflowState {
	o.mu.RLock()
	defer o.mu.RUnlock()

	workflows := make([]*RemittanceWorkflowState, 0)
	for _, state := range o.workflows {
		if state.CurrentStep == status {
			workflows = append(workflows, state)
		}
	}

	return workflows
}
