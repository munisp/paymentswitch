package remittance

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

const persistenceTimeout = 5 * time.Second

// AttachDB wires PostgreSQL to the remittance orchestrator. Passing nil keeps in-memory mode.
func (o *RemittanceOrchestrator) AttachDB(db *sql.DB) error {
	if db == nil {
		return nil
	}
	o.mu.Lock()
	o.db = db
	o.mu.Unlock()

	if err := o.ensureSchema(); err != nil {
		return fmt.Errorf("remittance: ensure schema: %w", err)
	}
	if err := o.loadState(); err != nil {
		return fmt.Errorf("remittance: load state: %w", err)
	}
	return nil
}

func (o *RemittanceOrchestrator) ensureSchema() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	const schema = `
	CREATE TABLE IF NOT EXISTS remittance_workflows (
		remittance_id       TEXT PRIMARY KEY,
		current_step        TEXT NOT NULL,
		charge_id           TEXT,
		sender_currency     TEXT,
		sender_amount       DOUBLE PRECISION DEFAULT 0,
		recipient_currency  TEXT,
		recipient_phone     TEXT,
		delivery_option     TEXT,
		kyc_data            JSONB,
		bank_account        JSONB,
		metadata            JSONB DEFAULT '{}',
		crypto_confirmed    BOOLEAN DEFAULT FALSE,
		crypto_amount       DOUBLE PRECISION DEFAULT 0,
		fiat_amount         DOUBLE PRECISION DEFAULT 0,
		exchange_rate       DOUBLE PRECISION DEFAULT 0,
		kyc_verification_id TEXT,
		kyc_approved        BOOLEAN DEFAULT FALSE,
		aml_cleared         BOOLEAN DEFAULT FALSE,
		aml_risk_level      TEXT DEFAULT '',
		sanctions_cleared   BOOLEAN DEFAULT FALSE,
		kyc_tier            INT DEFAULT 0,
		account_id          TEXT,
		transfer_reference  TEXT,
		error_msg           TEXT,
		retry_count         INT DEFAULT 0,
		last_updated        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);
	CREATE INDEX IF NOT EXISTS idx_remittance_step ON remittance_workflows(current_step);
	CREATE INDEX IF NOT EXISTS idx_remittance_updated ON remittance_workflows(last_updated DESC);
	`
	_, err := o.db.ExecContext(ctx, schema)
	return err
}

func (o *RemittanceOrchestrator) loadState() error {
	ctx, cancel := context.WithTimeout(context.Background(), persistenceTimeout)
	defer cancel()

	rows, err := o.db.QueryContext(ctx, `SELECT remittance_id, current_step, charge_id,
		sender_currency, sender_amount, recipient_currency, recipient_phone,
		delivery_option, kyc_data, bank_account, metadata,
		crypto_confirmed, crypto_amount, fiat_amount, exchange_rate,
		kyc_verification_id, kyc_approved, aml_cleared, aml_risk_level,
		sanctions_cleared, kyc_tier, account_id, transfer_reference,
		error_msg, retry_count, last_updated
		FROM remittance_workflows WHERE current_step NOT IN ('completed', 'failed')`)
	if err != nil {
		return err
	}
	defer rows.Close()

	o.mu.Lock()
	defer o.mu.Unlock()

	for rows.Next() {
		var s RemittanceWorkflowState
		var kycData, bankAccount, metadata []byte
		var chargeID, senderCur, recipCur, recipPhone, delivery sql.NullString
		var kycVerID, amlRisk, accountID, transferRef, errMsg sql.NullString

		if err := rows.Scan(
			&s.RemittanceID, &s.CurrentStep, &chargeID,
			&senderCur, &s.SenderAmount, &recipCur, &recipPhone,
			&delivery, &kycData, &bankAccount, &metadata,
			&s.CryptoPaymentConfirmed, &s.CryptoAmount, &s.FiatAmount, &s.ExchangeRate,
			&kycVerID, &s.KYCApproved, &s.AMLCleared, &amlRisk,
			&s.SanctionsCleared, &s.KYCTier, &accountID, &transferRef,
			&errMsg, &s.RetryCount, &s.LastUpdated,
		); err != nil {
			return err
		}
		if chargeID.Valid {
			s.ChargeID = chargeID.String
		}
		if senderCur.Valid {
			s.SenderCurrency = senderCur.String
		}
		if recipCur.Valid {
			s.RecipientCurrency = recipCur.String
		}
		if recipPhone.Valid {
			s.RecipientPhone = recipPhone.String
		}
		if delivery.Valid {
			s.DeliveryOption = DeliveryOption(delivery.String)
		}
		if kycVerID.Valid {
			s.KYCVerificationID = kycVerID.String
		}
		if amlRisk.Valid {
			s.AMLRiskLevel = amlRisk.String
		}
		if accountID.Valid {
			s.AccountID = accountID.String
		}
		if transferRef.Valid {
			s.TransferReference = transferRef.String
		}
		if errMsg.Valid {
			s.Error = errMsg.String
		}
		if kycData != nil {
			var kd KYCData
			if json.Unmarshal(kycData, &kd) == nil {
				s.KYCData = &kd
			}
		}
		if bankAccount != nil {
			var ba BankAccountInfo
			if json.Unmarshal(bankAccount, &ba) == nil {
				s.BankAccount = &ba
			}
		}
		if metadata != nil {
			json.Unmarshal(metadata, &s.Metadata)
		}
		o.workflows[s.RemittanceID] = &s
	}
	return nil
}

func (o *RemittanceOrchestrator) persistWorkflow(s *RemittanceWorkflowState) {
	if o.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), persistenceTimeout)
	defer cancel()

	kycData, _ := json.Marshal(s.KYCData)
	bankAccount, _ := json.Marshal(s.BankAccount)
	metadata, _ := json.Marshal(s.Metadata)

	o.db.ExecContext(ctx, `INSERT INTO remittance_workflows
		(remittance_id, current_step, charge_id, sender_currency, sender_amount,
		 recipient_currency, recipient_phone, delivery_option, kyc_data, bank_account,
		 metadata, crypto_confirmed, crypto_amount, fiat_amount, exchange_rate,
		 kyc_verification_id, kyc_approved, aml_cleared, aml_risk_level,
		 sanctions_cleared, kyc_tier, account_id, transfer_reference,
		 error_msg, retry_count, last_updated)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,NOW())
		ON CONFLICT (remittance_id) DO UPDATE SET
		 current_step=$2, crypto_confirmed=$12, crypto_amount=$13, fiat_amount=$14,
		 exchange_rate=$15, kyc_verification_id=$16, kyc_approved=$17, aml_cleared=$18,
		 aml_risk_level=$19, sanctions_cleared=$20, kyc_tier=$21, account_id=$22,
		 transfer_reference=$23, error_msg=$24, retry_count=$25, last_updated=NOW()`,
		s.RemittanceID, string(s.CurrentStep), s.ChargeID, s.SenderCurrency, s.SenderAmount,
		s.RecipientCurrency, s.RecipientPhone, string(s.DeliveryOption), kycData, bankAccount,
		metadata, s.CryptoPaymentConfirmed, s.CryptoAmount, s.FiatAmount, s.ExchangeRate,
		s.KYCVerificationID, s.KYCApproved, s.AMLCleared, s.AMLRiskLevel,
		s.SanctionsCleared, s.KYCTier, s.AccountID, s.TransferReference,
		s.Error, s.RetryCount)
}
