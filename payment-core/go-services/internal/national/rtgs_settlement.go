// Package national implements national payment switch components
package national

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// RTGSSettlementAdapter handles settlement with central bank RTGS
type RTGSSettlementAdapter struct {
	db           *sql.DB
	hsmManager   *HSMKeyManager
	auditLogger  *ImmutableAuditLogger
	config       *RTGSConfig
	messageQueue chan *ISO20022Message
	mu           sync.RWMutex
}

// RTGSConfig holds RTGS configuration
type RTGSConfig struct {
	CentralBankBIC      string
	InstitutionBIC      string
	SettlementAccountID string
	RTGSEndpoint        string
	ACHEndpoint         string
	MessageSigningKey   string
	TimeoutSeconds      int
	RetryAttempts       int
	SettlementCurrency  string
}

// NewRTGSSettlementAdapter creates a new RTGS settlement adapter
func NewRTGSSettlementAdapter(db *sql.DB, hsm *HSMKeyManager, audit *ImmutableAuditLogger, config *RTGSConfig) *RTGSSettlementAdapter {
	return &RTGSSettlementAdapter{
		db:           db,
		hsmManager:   hsm,
		auditLogger:  audit,
		config:       config,
		messageQueue: make(chan *ISO20022Message, 1000),
	}
}

// ISO20022Message represents an ISO 20022 message
type ISO20022Message struct {
	MessageID        string              `xml:"MsgId"`
	CreationDateTime time.Time           `xml:"CreDtTm"`
	MessageType      ISO20022MessageType `xml:"-"`
	Payload          interface{}         `xml:",any"`
	Signature        string              `xml:"-"`
}

// ISO20022MessageType defines the type of ISO 20022 message
type ISO20022MessageType string

const (
	// Payment messages
	MessageTypePacs008 ISO20022MessageType = "pacs.008" // FI to FI Customer Credit Transfer
	MessageTypePacs009 ISO20022MessageType = "pacs.009" // FI to FI Financial Institution Credit Transfer
	MessageTypePacs002 ISO20022MessageType = "pacs.002" // Payment Status Report
	MessageTypePacs004 ISO20022MessageType = "pacs.004" // Payment Return

	// Cash management messages
	MessageTypeCamt053 ISO20022MessageType = "camt.053" // Bank to Customer Statement
	MessageTypeCamt054 ISO20022MessageType = "camt.054" // Bank to Customer Debit/Credit Notification
	MessageTypeCamt052 ISO20022MessageType = "camt.052" // Bank to Customer Account Report
	MessageTypeCamt056 ISO20022MessageType = "camt.056" // FI to FI Payment Cancellation Request

	// Administration messages
	MessageTypeAdmi002 ISO20022MessageType = "admi.002" // Message Reject
	MessageTypeAdmi004 ISO20022MessageType = "admi.004" // System Event Notification
)

// SettlementInstruction represents a settlement instruction to RTGS
type SettlementInstruction struct {
	InstructionID   string                      `json:"instruction_id"`
	SettlementID    int64                       `json:"settlement_id"`
	DebtorBIC       string                      `json:"debtor_bic"`
	DebtorAccount   string                      `json:"debtor_account"`
	CreditorBIC     string                      `json:"creditor_bic"`
	CreditorAccount string                      `json:"creditor_account"`
	Amount          int64                       `json:"amount"`
	Currency        string                      `json:"currency"`
	ValueDate       time.Time                   `json:"value_date"`
	Purpose         string                      `json:"purpose"`
	Reference       string                      `json:"reference"`
	Status          SettlementInstructionStatus `json:"status"`
	CreatedAt       time.Time                   `json:"created_at"`
	SentAt          *time.Time                  `json:"sent_at,omitempty"`
	ConfirmedAt     *time.Time                  `json:"confirmed_at,omitempty"`
	RTGSReference   string                      `json:"rtgs_reference,omitempty"`
	ErrorCode       string                      `json:"error_code,omitempty"`
	ErrorMessage    string                      `json:"error_message,omitempty"`
}

// SettlementInstructionStatus defines the status of a settlement instruction
type SettlementInstructionStatus string

const (
	SettlementInstructionStatusPending  SettlementInstructionStatus = "PENDING"
	SettlementInstructionStatusSent     SettlementInstructionStatus = "SENT"
	SettlementInstructionStatusAccepted SettlementInstructionStatus = "ACCEPTED"
	SettlementInstructionStatusSettled  SettlementInstructionStatus = "SETTLED"
	SettlementInstructionStatusRejected SettlementInstructionStatus = "REJECTED"
	SettlementInstructionStatusFailed   SettlementInstructionStatus = "FAILED"
)

// CreateSettlementInstructions creates RTGS settlement instructions from a settlement
func (a *RTGSSettlementAdapter) CreateSettlementInstructions(ctx context.Context, settlementID int64) ([]*SettlementInstruction, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	// Get settlement participant positions
	rows, err := a.db.QueryContext(ctx, `
		SELECT spc.participant_id, spc.currency, spc.net_amount,
		       p.settlement_account_bic, p.settlement_account_number
		FROM settlement_participant_currency spc
		JOIN participants p ON spc.participant_id = p.participant_id
		WHERE spc.settlement_id = $1 AND spc.net_amount != 0
		ORDER BY spc.net_amount DESC
	`, settlementID)
	if err != nil {
		return nil, fmt.Errorf("failed to query settlement positions: %w", err)
	}
	defer rows.Close()

	var instructions []*SettlementInstruction
	valueDate := time.Now().UTC().Truncate(24 * time.Hour)

	for rows.Next() {
		var participantID, currency string
		var netAmount int64
		var bic, accountNumber sql.NullString

		err := rows.Scan(&participantID, &currency, &netAmount, &bic, &accountNumber)
		if err != nil {
			continue
		}

		// Skip if no settlement account configured
		if !bic.Valid || !accountNumber.Valid {
			continue
		}

		instruction := &SettlementInstruction{
			InstructionID: generateEventID(),
			SettlementID:  settlementID,
			Currency:      currency,
			ValueDate:     valueDate,
			Purpose:       "MULTILATERAL_NET_SETTLEMENT",
			Reference:     fmt.Sprintf("SETTLEMENT-%d-%s", settlementID, participantID),
			Status:        SettlementInstructionStatusPending,
			CreatedAt:     time.Now().UTC(),
		}

		if netAmount > 0 {
			// Participant receives funds (hub pays participant)
			instruction.DebtorBIC = a.config.InstitutionBIC
			instruction.DebtorAccount = a.config.SettlementAccountID
			instruction.CreditorBIC = bic.String
			instruction.CreditorAccount = accountNumber.String
			instruction.Amount = netAmount
		} else {
			// Participant pays funds (participant pays hub)
			instruction.DebtorBIC = bic.String
			instruction.DebtorAccount = accountNumber.String
			instruction.CreditorBIC = a.config.InstitutionBIC
			instruction.CreditorAccount = a.config.SettlementAccountID
			instruction.Amount = -netAmount
		}

		// Save instruction
		if err := a.saveInstruction(ctx, instruction); err != nil {
			return nil, fmt.Errorf("failed to save instruction: %w", err)
		}

		instructions = append(instructions, instruction)
	}

	// Audit log
	if a.auditLogger != nil {
		a.auditLogger.Log(ctx, &AuditEvent{
			EventType: AuditEventType("SETTLEMENT_INSTRUCTIONS_CREATED"),
			Severity:  AuditSeverityInfo,
			Actor:     &AuditActor{ActorID: "SYSTEM", ActorType: "SYSTEM", ActorName: "RTGS Adapter"},
			Subject:   &AuditSubject{SubjectID: fmt.Sprintf("%d", settlementID), SubjectType: "SETTLEMENT", SubjectName: "Settlement"},
			Action:    "Created RTGS settlement instructions",
			Details:   map[string]interface{}{"instruction_count": len(instructions)},
		})
	}

	return instructions, nil
}

// GeneratePacs008 generates a pacs.008 FI to FI Customer Credit Transfer message
func (a *RTGSSettlementAdapter) GeneratePacs008(ctx context.Context, instruction *SettlementInstruction) (*Pacs008Document, error) {
	msgID := fmt.Sprintf("%s-%s", a.config.InstitutionBIC, instruction.InstructionID[:16])

	doc := &Pacs008Document{
		XMLName: xml.Name{Local: "Document"},
		Xmlns:   "urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08",
		FIToFICstmrCdtTrf: &FIToFICustomerCreditTransfer{
			GrpHdr: &GroupHeader{
				MsgId:   msgID,
				CreDtTm: time.Now().UTC().Format(time.RFC3339),
				NbOfTxs: "1",
				SttlmInf: &SettlementInformation{
					SttlmMtd: "CLRG", // Clearing
				},
			},
			CdtTrfTxInf: &CreditTransferTransactionInformation{
				PmtId: &PaymentIdentification{
					InstrId:    instruction.InstructionID,
					EndToEndId: instruction.Reference,
					TxId:       instruction.InstructionID,
				},
				IntrBkSttlmAmt: &ActiveCurrencyAndAmount{
					Ccy:   instruction.Currency,
					Value: fmt.Sprintf("%.2f", float64(instruction.Amount)/100),
				},
				IntrBkSttlmDt: instruction.ValueDate.Format("2006-01-02"),
				ChrgBr:        "SLEV", // Service Level
				InstgAgt: &BranchAndFinancialInstitutionIdentification{
					FinInstnId: &FinancialInstitutionIdentification{
						BICFI: a.config.InstitutionBIC,
					},
				},
				InstdAgt: &BranchAndFinancialInstitutionIdentification{
					FinInstnId: &FinancialInstitutionIdentification{
						BICFI: a.config.CentralBankBIC,
					},
				},
				Dbtr: &PartyIdentification{
					Nm: "Settlement Hub",
				},
				DbtrAcct: &CashAccount{
					Id: &AccountIdentification{
						IBAN: instruction.DebtorAccount,
					},
				},
				DbtrAgt: &BranchAndFinancialInstitutionIdentification{
					FinInstnId: &FinancialInstitutionIdentification{
						BICFI: instruction.DebtorBIC,
					},
				},
				CdtrAgt: &BranchAndFinancialInstitutionIdentification{
					FinInstnId: &FinancialInstitutionIdentification{
						BICFI: instruction.CreditorBIC,
					},
				},
				Cdtr: &PartyIdentification{
					Nm: "Settlement Participant",
				},
				CdtrAcct: &CashAccount{
					Id: &AccountIdentification{
						IBAN: instruction.CreditorAccount,
					},
				},
				Purp: &Purpose{
					Cd: "INTC", // Intra-company payment
				},
				RmtInf: &RemittanceInformation{
					Ustrd: instruction.Purpose,
				},
			},
		},
	}

	return doc, nil
}

// GeneratePacs009 generates a pacs.009 FI to FI Financial Institution Credit Transfer
func (a *RTGSSettlementAdapter) GeneratePacs009(ctx context.Context, instruction *SettlementInstruction) (*Pacs009Document, error) {
	msgID := fmt.Sprintf("%s-%s", a.config.InstitutionBIC, instruction.InstructionID[:16])

	doc := &Pacs009Document{
		XMLName: xml.Name{Local: "Document"},
		Xmlns:   "urn:iso:std:iso:20022:tech:xsd:pacs.009.001.08",
		FICdtTrf: &FinancialInstitutionCreditTransfer{
			GrpHdr: &GroupHeader{
				MsgId:   msgID,
				CreDtTm: time.Now().UTC().Format(time.RFC3339),
				NbOfTxs: "1",
				SttlmInf: &SettlementInformation{
					SttlmMtd: "CLRG",
				},
			},
			CdtTrfTxInf: &CreditTransferTransactionInformation{
				PmtId: &PaymentIdentification{
					InstrId:    instruction.InstructionID,
					EndToEndId: instruction.Reference,
					TxId:       instruction.InstructionID,
				},
				IntrBkSttlmAmt: &ActiveCurrencyAndAmount{
					Ccy:   instruction.Currency,
					Value: fmt.Sprintf("%.2f", float64(instruction.Amount)/100),
				},
				IntrBkSttlmDt: instruction.ValueDate.Format("2006-01-02"),
				InstgAgt: &BranchAndFinancialInstitutionIdentification{
					FinInstnId: &FinancialInstitutionIdentification{
						BICFI: a.config.InstitutionBIC,
					},
				},
				InstdAgt: &BranchAndFinancialInstitutionIdentification{
					FinInstnId: &FinancialInstitutionIdentification{
						BICFI: a.config.CentralBankBIC,
					},
				},
				DbtrAgt: &BranchAndFinancialInstitutionIdentification{
					FinInstnId: &FinancialInstitutionIdentification{
						BICFI: instruction.DebtorBIC,
					},
				},
				CdtrAgt: &BranchAndFinancialInstitutionIdentification{
					FinInstnId: &FinancialInstitutionIdentification{
						BICFI: instruction.CreditorBIC,
					},
				},
			},
		},
	}

	return doc, nil
}

// SubmitToRTGS submits a settlement instruction to RTGS
func (a *RTGSSettlementAdapter) SubmitToRTGS(ctx context.Context, instruction *SettlementInstruction) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	// Generate pacs.009 message
	doc, err := a.GeneratePacs009(ctx, instruction)
	if err != nil {
		return fmt.Errorf("failed to generate pacs.009: %w", err)
	}

	// Marshal to XML
	xmlData, err := xml.MarshalIndent(doc, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal XML: %w", err)
	}

	// Sign the message
	if a.hsmManager != nil && a.config.MessageSigningKey != "" {
		hash := sha256.Sum256(xmlData)
		signature, err := a.hsmManager.Sign(ctx, a.config.MessageSigningKey, hash[:])
		if err == nil {
			instruction.RTGSReference = hex.EncodeToString(signature[:16])
		}
	}

	// Send to RTGS endpoint
	if a.config.RTGSEndpoint != "" {
		req, rErr := http.NewRequestWithContext(ctx, http.MethodPost, a.config.RTGSEndpoint, bytes.NewReader(xmlData))
		if rErr != nil {
			return fmt.Errorf("failed to create RTGS request: %w", rErr)
		}
		req.Header.Set("Content-Type", "application/xml")
		client := &http.Client{Timeout: 30 * time.Second}
		resp, rErr := client.Do(req)
		if rErr != nil {
			return fmt.Errorf("RTGS endpoint unreachable: %w", rErr)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
			return fmt.Errorf("RTGS returned status %d", resp.StatusCode)
		}
	}

	// Update instruction status
	now := time.Now()
	instruction.Status = SettlementInstructionStatusSent
	instruction.SentAt = &now

	if err := a.updateInstruction(ctx, instruction); err != nil {
		return fmt.Errorf("failed to update instruction: %w", err)
	}

	// Audit log
	if a.auditLogger != nil {
		a.auditLogger.Log(ctx, &AuditEvent{
			EventType: AuditEventType("RTGS_INSTRUCTION_SENT"),
			Severity:  AuditSeverityInfo,
			Actor:     &AuditActor{ActorID: "SYSTEM", ActorType: "SYSTEM", ActorName: "RTGS Adapter"},
			Subject:   &AuditSubject{SubjectID: instruction.InstructionID, SubjectType: "SETTLEMENT_INSTRUCTION", SubjectName: "RTGS Instruction"},
			Action:    "Submitted settlement instruction to RTGS",
			Details:   map[string]interface{}{"amount": instruction.Amount, "currency": instruction.Currency},
		})
	}

	return nil
}

// ProcessPacs002 processes a pacs.002 Payment Status Report from RTGS
func (a *RTGSSettlementAdapter) ProcessPacs002(ctx context.Context, xmlData []byte) error {
	var doc Pacs002Document
	if err := xml.Unmarshal(xmlData, &doc); err != nil {
		return fmt.Errorf("failed to unmarshal pacs.002: %w", err)
	}

	// Extract status information
	if doc.FIToFIPmtStsRpt == nil || doc.FIToFIPmtStsRpt.TxInfAndSts == nil {
		return fmt.Errorf("invalid pacs.002 structure")
	}

	txInfo := doc.FIToFIPmtStsRpt.TxInfAndSts
	instructionID := txInfo.OrgnlInstrId

	// Get instruction
	instruction, err := a.getInstruction(ctx, instructionID)
	if err != nil {
		return fmt.Errorf("instruction not found: %w", err)
	}

	// Update status based on response
	now := time.Now()
	switch txInfo.TxSts {
	case "ACCP", "ACSC", "ACSP": // Accepted
		instruction.Status = SettlementInstructionStatusAccepted
	case "ACTC": // Accepted Technical Validation
		instruction.Status = SettlementInstructionStatusAccepted
	case "ACWC": // Accepted with Change
		instruction.Status = SettlementInstructionStatusAccepted
	case "PDNG": // Pending
		instruction.Status = SettlementInstructionStatusSent
	case "RJCT": // Rejected
		instruction.Status = SettlementInstructionStatusRejected
		if txInfo.StsRsnInf != nil {
			instruction.ErrorCode = txInfo.StsRsnInf.Rsn.Cd
			instruction.ErrorMessage = txInfo.StsRsnInf.AddtlInf
		}
	}

	if txInfo.TxSts == "ACSC" { // Accepted Settlement Completed
		instruction.Status = SettlementInstructionStatusSettled
		instruction.ConfirmedAt = &now
	}

	instruction.RTGSReference = txInfo.OrgnlTxId

	if err := a.updateInstruction(ctx, instruction); err != nil {
		return fmt.Errorf("failed to update instruction: %w", err)
	}

	// Audit log
	if a.auditLogger != nil {
		a.auditLogger.Log(ctx, &AuditEvent{
			EventType: AuditEventType("RTGS_STATUS_RECEIVED"),
			Severity:  AuditSeverityInfo,
			Actor:     &AuditActor{ActorID: "RTGS", ActorType: "EXTERNAL", ActorName: "Central Bank RTGS"},
			Subject:   &AuditSubject{SubjectID: instruction.InstructionID, SubjectType: "SETTLEMENT_INSTRUCTION", SubjectName: "RTGS Instruction"},
			Action:    "Received RTGS status update",
			Details:   map[string]interface{}{"status": txInfo.TxSts, "rtgs_reference": instruction.RTGSReference},
		})
	}

	return nil
}

// ProcessCamt054 processes a camt.054 Bank to Customer Debit/Credit Notification
func (a *RTGSSettlementAdapter) ProcessCamt054(ctx context.Context, xmlData []byte) error {
	var doc Camt054Document
	if err := xml.Unmarshal(xmlData, &doc); err != nil {
		return fmt.Errorf("failed to unmarshal camt.054: %w", err)
	}

	// Process notifications
	if doc.BkToCstmrDbtCdtNtfctn == nil {
		return fmt.Errorf("invalid camt.054 structure")
	}

	for _, ntfctn := range doc.BkToCstmrDbtCdtNtfctn.Ntfctn {
		for _, ntry := range ntfctn.Ntry {
			// Record the notification
			notification := &SettlementNotification{
				NotificationID: generateEventID(),
				AccountID:      ntfctn.Acct.Id.IBAN,
				EntryReference: ntry.NtryRef,
				Amount:         parseAmount(ntry.Amt.Value),
				Currency:       ntry.Amt.Ccy,
				CreditDebit:    ntry.CdtDbtInd,
				BookingDate:    parseDate(ntry.BookgDt.Dt),
				ValueDate:      parseDate(ntry.ValDt.Dt),
				Status:         ntry.Sts,
				ReceivedAt:     time.Now().UTC(),
			}

			if err := a.saveNotification(ctx, notification); err != nil {
				return fmt.Errorf("failed to save notification: %w", err)
			}

			// Match with pending instructions
			if err := a.matchNotificationToInstruction(ctx, notification); err != nil {
				// Log but don't fail
				fmt.Printf("WARNING: Failed to match notification: %v\n", err)
			}
		}
	}

	return nil
}

// SettlementNotification represents a settlement notification from RTGS
type SettlementNotification struct {
	NotificationID       string    `json:"notification_id"`
	AccountID            string    `json:"account_id"`
	EntryReference       string    `json:"entry_reference"`
	Amount               int64     `json:"amount"`
	Currency             string    `json:"currency"`
	CreditDebit          string    `json:"credit_debit"` // CRDT or DBIT
	BookingDate          time.Time `json:"booking_date"`
	ValueDate            time.Time `json:"value_date"`
	Status               string    `json:"status"`
	ReceivedAt           time.Time `json:"received_at"`
	MatchedInstructionID string    `json:"matched_instruction_id,omitempty"`
}

func (a *RTGSSettlementAdapter) matchNotificationToInstruction(ctx context.Context, notification *SettlementNotification) error {
	// Try to match by reference
	row := a.db.QueryRowContext(ctx, `
		SELECT instruction_id FROM settlement_instructions
		WHERE status = 'SENT' 
		  AND currency = $1 
		  AND amount = $2
		  AND (debtor_account = $3 OR creditor_account = $3)
		ORDER BY created_at DESC LIMIT 1
	`, notification.Currency, notification.Amount, notification.AccountID)

	var instructionID string
	if err := row.Scan(&instructionID); err != nil {
		return err
	}

	// Update notification with match
	notification.MatchedInstructionID = instructionID
	_, err := a.db.ExecContext(ctx, `
		UPDATE settlement_notifications 
		SET matched_instruction_id = $1
		WHERE notification_id = $2
	`, instructionID, notification.NotificationID)
	if err != nil {
		return err
	}

	// Update instruction as settled
	now := time.Now()
	_, err = a.db.ExecContext(ctx, `
		UPDATE settlement_instructions 
		SET status = 'SETTLED', confirmed_at = $1, rtgs_reference = $2
		WHERE instruction_id = $3
	`, now, notification.EntryReference, instructionID)

	return err
}

// GetSettlementStatus gets the status of all instructions for a settlement
func (a *RTGSSettlementAdapter) GetSettlementStatus(ctx context.Context, settlementID int64) (*SettlementStatus, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT instruction_id, status, amount, currency, sent_at, confirmed_at, error_code, error_message
		FROM settlement_instructions
		WHERE settlement_id = $1
	`, settlementID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	status := &SettlementStatus{
		SettlementID: settlementID,
		Instructions: make([]*InstructionStatus, 0),
	}

	for rows.Next() {
		is := &InstructionStatus{}
		var sentAt, confirmedAt sql.NullTime
		var errorCode, errorMessage sql.NullString

		err := rows.Scan(
			&is.InstructionID, &is.Status, &is.Amount, &is.Currency,
			&sentAt, &confirmedAt, &errorCode, &errorMessage,
		)
		if err != nil {
			continue
		}

		if sentAt.Valid {
			is.SentAt = &sentAt.Time
		}
		if confirmedAt.Valid {
			is.ConfirmedAt = &confirmedAt.Time
		}
		if errorCode.Valid {
			is.ErrorCode = errorCode.String
		}
		if errorMessage.Valid {
			is.ErrorMessage = errorMessage.String
		}

		status.Instructions = append(status.Instructions, is)

		// Update aggregates
		status.TotalInstructions++
		switch is.Status {
		case string(SettlementInstructionStatusSettled):
			status.SettledCount++
			status.SettledAmount += is.Amount
		case string(SettlementInstructionStatusRejected), string(SettlementInstructionStatusFailed):
			status.FailedCount++
		case string(SettlementInstructionStatusPending), string(SettlementInstructionStatusSent):
			status.PendingCount++
		}
	}

	// Determine overall status
	if status.FailedCount > 0 {
		status.OverallStatus = "PARTIALLY_FAILED"
	} else if status.PendingCount > 0 {
		status.OverallStatus = "IN_PROGRESS"
	} else if status.SettledCount == status.TotalInstructions {
		status.OverallStatus = "COMPLETED"
	} else {
		status.OverallStatus = "UNKNOWN"
	}

	return status, nil
}

// SettlementStatus represents the overall settlement status
type SettlementStatus struct {
	SettlementID      int64                `json:"settlement_id"`
	OverallStatus     string               `json:"overall_status"`
	TotalInstructions int                  `json:"total_instructions"`
	SettledCount      int                  `json:"settled_count"`
	PendingCount      int                  `json:"pending_count"`
	FailedCount       int                  `json:"failed_count"`
	SettledAmount     int64                `json:"settled_amount"`
	Instructions      []*InstructionStatus `json:"instructions"`
}

// InstructionStatus represents an instruction's status
type InstructionStatus struct {
	InstructionID string     `json:"instruction_id"`
	Status        string     `json:"status"`
	Amount        int64      `json:"amount"`
	Currency      string     `json:"currency"`
	SentAt        *time.Time `json:"sent_at,omitempty"`
	ConfirmedAt   *time.Time `json:"confirmed_at,omitempty"`
	ErrorCode     string     `json:"error_code,omitempty"`
	ErrorMessage  string     `json:"error_message,omitempty"`
}

// Helper methods

func (a *RTGSSettlementAdapter) saveInstruction(ctx context.Context, instruction *SettlementInstruction) error {
	_, err := a.db.ExecContext(ctx, `
		INSERT INTO settlement_instructions (
			instruction_id, settlement_id, debtor_bic, debtor_account,
			creditor_bic, creditor_account, amount, currency, value_date,
			purpose, reference, status, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
	`, instruction.InstructionID, instruction.SettlementID, instruction.DebtorBIC,
		instruction.DebtorAccount, instruction.CreditorBIC, instruction.CreditorAccount,
		instruction.Amount, instruction.Currency, instruction.ValueDate, instruction.Purpose,
		instruction.Reference, string(instruction.Status), instruction.CreatedAt)
	return err
}

func (a *RTGSSettlementAdapter) updateInstruction(ctx context.Context, instruction *SettlementInstruction) error {
	_, err := a.db.ExecContext(ctx, `
		UPDATE settlement_instructions SET
			status = $1, sent_at = $2, confirmed_at = $3, rtgs_reference = $4,
			error_code = $5, error_message = $6
		WHERE instruction_id = $7
	`, string(instruction.Status), instruction.SentAt, instruction.ConfirmedAt,
		instruction.RTGSReference, instruction.ErrorCode, instruction.ErrorMessage,
		instruction.InstructionID)
	return err
}

func (a *RTGSSettlementAdapter) getInstruction(ctx context.Context, instructionID string) (*SettlementInstruction, error) {
	row := a.db.QueryRowContext(ctx, `
		SELECT instruction_id, settlement_id, debtor_bic, debtor_account,
		       creditor_bic, creditor_account, amount, currency, value_date,
		       purpose, reference, status, created_at, sent_at, confirmed_at,
		       rtgs_reference, error_code, error_message
		FROM settlement_instructions
		WHERE instruction_id = $1
	`, instructionID)

	i := &SettlementInstruction{}
	var status string
	var sentAt, confirmedAt sql.NullTime
	var rtgsRef, errorCode, errorMsg sql.NullString

	err := row.Scan(
		&i.InstructionID, &i.SettlementID, &i.DebtorBIC, &i.DebtorAccount,
		&i.CreditorBIC, &i.CreditorAccount, &i.Amount, &i.Currency, &i.ValueDate,
		&i.Purpose, &i.Reference, &status, &i.CreatedAt, &sentAt, &confirmedAt,
		&rtgsRef, &errorCode, &errorMsg,
	)
	if err != nil {
		return nil, err
	}

	i.Status = SettlementInstructionStatus(status)
	if sentAt.Valid {
		i.SentAt = &sentAt.Time
	}
	if confirmedAt.Valid {
		i.ConfirmedAt = &confirmedAt.Time
	}
	if rtgsRef.Valid {
		i.RTGSReference = rtgsRef.String
	}
	if errorCode.Valid {
		i.ErrorCode = errorCode.String
	}
	if errorMsg.Valid {
		i.ErrorMessage = errorMsg.String
	}

	return i, nil
}

func (a *RTGSSettlementAdapter) saveNotification(ctx context.Context, notification *SettlementNotification) error {
	_, err := a.db.ExecContext(ctx, `
		INSERT INTO settlement_notifications (
			notification_id, account_id, entry_reference, amount, currency,
			credit_debit, booking_date, value_date, status, received_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, notification.NotificationID, notification.AccountID, notification.EntryReference,
		notification.Amount, notification.Currency, notification.CreditDebit,
		notification.BookingDate, notification.ValueDate, notification.Status, notification.ReceivedAt)
	return err
}

func parseAmount(s string) int64 {
	// Parse amount string like "1234.56" to minor units (cents: 123456)
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	return int64(math.Round(f * 100))
}

func parseDate(s string) time.Time {
	t, _ := time.Parse("2006-01-02", s)
	return t
}

// ISO 20022 XML structures

// Pacs008Document represents a pacs.008 document
type Pacs008Document struct {
	XMLName           xml.Name                      `xml:"Document"`
	Xmlns             string                        `xml:"xmlns,attr"`
	FIToFICstmrCdtTrf *FIToFICustomerCreditTransfer `xml:"FIToFICstmrCdtTrf"`
}

// Pacs009Document represents a pacs.009 document
type Pacs009Document struct {
	XMLName  xml.Name                            `xml:"Document"`
	Xmlns    string                              `xml:"xmlns,attr"`
	FICdtTrf *FinancialInstitutionCreditTransfer `xml:"FICdtTrf"`
}

// Pacs002Document represents a pacs.002 document
type Pacs002Document struct {
	XMLName         xml.Name                   `xml:"Document"`
	Xmlns           string                     `xml:"xmlns,attr"`
	FIToFIPmtStsRpt *FIToFIPaymentStatusReport `xml:"FIToFIPmtStsRpt"`
}

// Camt054Document represents a camt.054 document
type Camt054Document struct {
	XMLName               xml.Name                               `xml:"Document"`
	Xmlns                 string                                 `xml:"xmlns,attr"`
	BkToCstmrDbtCdtNtfctn *BankToCustomerDebitCreditNotification `xml:"BkToCstmrDbtCdtNtfctn"`
}

// FIToFICustomerCreditTransfer represents the main pacs.008 element
type FIToFICustomerCreditTransfer struct {
	GrpHdr      *GroupHeader                          `xml:"GrpHdr"`
	CdtTrfTxInf *CreditTransferTransactionInformation `xml:"CdtTrfTxInf"`
}

// FinancialInstitutionCreditTransfer represents the main pacs.009 element
type FinancialInstitutionCreditTransfer struct {
	GrpHdr      *GroupHeader                          `xml:"GrpHdr"`
	CdtTrfTxInf *CreditTransferTransactionInformation `xml:"CdtTrfTxInf"`
}

// FIToFIPaymentStatusReport represents the main pacs.002 element
type FIToFIPaymentStatusReport struct {
	GrpHdr      *GroupHeader                   `xml:"GrpHdr"`
	TxInfAndSts *PaymentTransactionInformation `xml:"TxInfAndSts"`
}

// BankToCustomerDebitCreditNotification represents the main camt.054 element
type BankToCustomerDebitCreditNotification struct {
	GrpHdr *GroupHeader           `xml:"GrpHdr"`
	Ntfctn []*AccountNotification `xml:"Ntfctn"`
}

// GroupHeader represents the group header
type GroupHeader struct {
	MsgId    string                 `xml:"MsgId"`
	CreDtTm  string                 `xml:"CreDtTm"`
	NbOfTxs  string                 `xml:"NbOfTxs,omitempty"`
	SttlmInf *SettlementInformation `xml:"SttlmInf,omitempty"`
}

// SettlementInformation represents settlement information
type SettlementInformation struct {
	SttlmMtd string `xml:"SttlmMtd"`
}

// CreditTransferTransactionInformation represents a credit transfer
type CreditTransferTransactionInformation struct {
	PmtId          *PaymentIdentification                       `xml:"PmtId"`
	IntrBkSttlmAmt *ActiveCurrencyAndAmount                     `xml:"IntrBkSttlmAmt"`
	IntrBkSttlmDt  string                                       `xml:"IntrBkSttlmDt"`
	ChrgBr         string                                       `xml:"ChrgBr,omitempty"`
	InstgAgt       *BranchAndFinancialInstitutionIdentification `xml:"InstgAgt,omitempty"`
	InstdAgt       *BranchAndFinancialInstitutionIdentification `xml:"InstdAgt,omitempty"`
	Dbtr           *PartyIdentification                         `xml:"Dbtr,omitempty"`
	DbtrAcct       *CashAccount                                 `xml:"DbtrAcct,omitempty"`
	DbtrAgt        *BranchAndFinancialInstitutionIdentification `xml:"DbtrAgt,omitempty"`
	CdtrAgt        *BranchAndFinancialInstitutionIdentification `xml:"CdtrAgt,omitempty"`
	Cdtr           *PartyIdentification                         `xml:"Cdtr,omitempty"`
	CdtrAcct       *CashAccount                                 `xml:"CdtrAcct,omitempty"`
	Purp           *Purpose                                     `xml:"Purp,omitempty"`
	RmtInf         *RemittanceInformation                       `xml:"RmtInf,omitempty"`
}

// PaymentIdentification represents payment identification
type PaymentIdentification struct {
	InstrId    string `xml:"InstrId,omitempty"`
	EndToEndId string `xml:"EndToEndId"`
	TxId       string `xml:"TxId,omitempty"`
}

// ActiveCurrencyAndAmount represents an amount with currency
type ActiveCurrencyAndAmount struct {
	Ccy   string `xml:"Ccy,attr"`
	Value string `xml:",chardata"`
}

// BranchAndFinancialInstitutionIdentification represents a financial institution
type BranchAndFinancialInstitutionIdentification struct {
	FinInstnId *FinancialInstitutionIdentification `xml:"FinInstnId"`
}

// FinancialInstitutionIdentification represents FI identification
type FinancialInstitutionIdentification struct {
	BICFI string `xml:"BICFI,omitempty"`
	Nm    string `xml:"Nm,omitempty"`
}

// PartyIdentification represents a party
type PartyIdentification struct {
	Nm string `xml:"Nm,omitempty"`
}

// CashAccount represents a cash account
type CashAccount struct {
	Id  *AccountIdentification `xml:"Id"`
	Ccy string                 `xml:"Ccy,omitempty"`
}

// AccountIdentification represents account identification
type AccountIdentification struct {
	IBAN string `xml:"IBAN,omitempty"`
	Othr *Other `xml:"Othr,omitempty"`
}

// Other represents other identification
type Other struct {
	Id string `xml:"Id"`
}

// Purpose represents payment purpose
type Purpose struct {
	Cd string `xml:"Cd"`
}

// RemittanceInformation represents remittance information
type RemittanceInformation struct {
	Ustrd string `xml:"Ustrd,omitempty"`
}

// PaymentTransactionInformation represents payment status
type PaymentTransactionInformation struct {
	OrgnlInstrId string                   `xml:"OrgnlInstrId,omitempty"`
	OrgnlTxId    string                   `xml:"OrgnlTxId,omitempty"`
	TxSts        string                   `xml:"TxSts"`
	StsRsnInf    *StatusReasonInformation `xml:"StsRsnInf,omitempty"`
}

// StatusReasonInformation represents status reason
type StatusReasonInformation struct {
	Rsn      *Reason `xml:"Rsn"`
	AddtlInf string  `xml:"AddtlInf,omitempty"`
}

// Reason represents a reason code
type Reason struct {
	Cd string `xml:"Cd"`
}

// AccountNotification represents an account notification
type AccountNotification struct {
	Id   string         `xml:"Id"`
	Acct *CashAccount   `xml:"Acct"`
	Ntry []*ReportEntry `xml:"Ntry"`
}

// ReportEntry represents a report entry
type ReportEntry struct {
	NtryRef   string                   `xml:"NtryRef,omitempty"`
	Amt       *ActiveCurrencyAndAmount `xml:"Amt"`
	CdtDbtInd string                   `xml:"CdtDbtInd"`
	Sts       string                   `xml:"Sts"`
	BookgDt   *DateAndDateTime         `xml:"BookgDt"`
	ValDt     *DateAndDateTime         `xml:"ValDt"`
}

// DateAndDateTime represents a date
type DateAndDateTime struct {
	Dt   string `xml:"Dt,omitempty"`
	DtTm string `xml:"DtTm,omitempty"`
}

// RTGSSettlementSchema returns the PostgreSQL schema for RTGS tables
func RTGSSettlementSchema() string {
	return `
-- Settlement instructions table
CREATE TABLE IF NOT EXISTS settlement_instructions (
    instruction_id VARCHAR(64) PRIMARY KEY,
    settlement_id BIGINT NOT NULL,
    debtor_bic VARCHAR(11) NOT NULL,
    debtor_account VARCHAR(34) NOT NULL,
    creditor_bic VARCHAR(11) NOT NULL,
    creditor_account VARCHAR(34) NOT NULL,
    amount BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL,
    value_date DATE NOT NULL,
    purpose VARCHAR(256),
    reference VARCHAR(256),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE,
    confirmed_at TIMESTAMP WITH TIME ZONE,
    rtgs_reference VARCHAR(64),
    error_code VARCHAR(10),
    error_message TEXT
);

-- Index for settlement queries
CREATE INDEX IF NOT EXISTS idx_settlement_instructions_settlement 
ON settlement_instructions(settlement_id);

-- Index for status queries
CREATE INDEX IF NOT EXISTS idx_settlement_instructions_status 
ON settlement_instructions(status, created_at);

-- Settlement notifications table
CREATE TABLE IF NOT EXISTS settlement_notifications (
    notification_id VARCHAR(64) PRIMARY KEY,
    account_id VARCHAR(34) NOT NULL,
    entry_reference VARCHAR(64),
    amount BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL,
    credit_debit VARCHAR(4) NOT NULL,
    booking_date DATE NOT NULL,
    value_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL,
    received_at TIMESTAMP WITH TIME ZONE NOT NULL,
    matched_instruction_id VARCHAR(64)
);

-- Index for notification queries
CREATE INDEX IF NOT EXISTS idx_settlement_notifications_account 
ON settlement_notifications(account_id, received_at DESC);

-- Index for matching
CREATE INDEX IF NOT EXISTS idx_settlement_notifications_unmatched 
ON settlement_notifications(matched_instruction_id) WHERE matched_instruction_id IS NULL;

-- Add settlement account columns to participants if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'participants' AND column_name = 'settlement_account_bic'
    ) THEN
        ALTER TABLE participants ADD COLUMN settlement_account_bic VARCHAR(11);
        ALTER TABLE participants ADD COLUMN settlement_account_number VARCHAR(34);
    END IF;
END $$;
`
}
