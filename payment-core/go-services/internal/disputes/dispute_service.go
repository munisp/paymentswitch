package disputes

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"sort"
	"sync"
	"time"
)

type DisputeType string

const (
	DisputeTypeFailedPayout            DisputeType = "failed_payout"
	DisputeTypeWrongBeneficiary        DisputeType = "wrong_beneficiary"
	DisputeTypeDuplicateTransaction    DisputeType = "duplicate_transaction"
	DisputeTypeUnauthorizedTransaction DisputeType = "unauthorized_transaction"
	DisputeTypeServiceNotReceived      DisputeType = "service_not_received"
	DisputeTypeAmountMismatch          DisputeType = "amount_mismatch"
	DisputeTypeRefundRequest           DisputeType = "refund_request"
	DisputeTypeChargeback              DisputeType = "chargeback"
)

type DisputeStatus string

const (
	DisputeStatusOpen            DisputeStatus = "open"
	DisputeStatusUnderReview     DisputeStatus = "under_review"
	DisputeStatusPendingCustomer DisputeStatus = "pending_customer"
	DisputeStatusPendingMerchant DisputeStatus = "pending_merchant"
	DisputeStatusPendingBank     DisputeStatus = "pending_bank"
	DisputeStatusEscalated       DisputeStatus = "escalated"
	DisputeStatusResolved        DisputeStatus = "resolved"
	DisputeStatusClosed          DisputeStatus = "closed"
	DisputeStatusRejected        DisputeStatus = "rejected"
)

type DisputePriority string

const (
	PriorityLow      DisputePriority = "low"
	PriorityMedium   DisputePriority = "medium"
	PriorityHigh     DisputePriority = "high"
	PriorityCritical DisputePriority = "critical"
)

type DisputeReason string

const (
	ReasonBankRejection     DisputeReason = "bank_rejection"
	ReasonInvalidAccount    DisputeReason = "invalid_account"
	ReasonInsufficientFunds DisputeReason = "insufficient_funds"
	ReasonCustomerRequest   DisputeReason = "customer_request"
	ReasonFraudSuspected    DisputeReason = "fraud_suspected"
	ReasonTechnicalError    DisputeReason = "technical_error"
	ReasonComplianceIssue   DisputeReason = "compliance_issue"
	ReasonOther             DisputeReason = "other"
)

type EvidenceType string

const (
	EvidenceTypeDocument       EvidenceType = "document"
	EvidenceTypeScreenshot     EvidenceType = "screenshot"
	EvidenceTypeTransactionLog EvidenceType = "transaction_log"
	EvidenceTypeCommunication  EvidenceType = "communication"
	EvidenceTypeBankStatement  EvidenceType = "bank_statement"
)

type DisputeEvidence struct {
	ID          string       `json:"id"`
	Type        EvidenceType `json:"type"`
	Description string       `json:"description"`
	FileURL     string       `json:"fileUrl,omitempty"`
	Content     string       `json:"content,omitempty"`
	UploadedBy  string       `json:"uploadedBy"`
	UploadedAt  time.Time    `json:"uploadedAt"`
}

type EventType string

const (
	EventTypeCreated       EventType = "created"
	EventTypeUpdated       EventType = "updated"
	EventTypeAssigned      EventType = "assigned"
	EventTypeEscalated     EventType = "escalated"
	EventTypeComment       EventType = "comment"
	EventTypeEvidenceAdded EventType = "evidence_added"
	EventTypeStatusChanged EventType = "status_changed"
	EventTypeResolved      EventType = "resolved"
)

type DisputeEvent struct {
	ID          string                 `json:"id"`
	Type        EventType              `json:"type"`
	Description string                 `json:"description"`
	Actor       string                 `json:"actor"`
	Timestamp   time.Time              `json:"timestamp"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
}

type ResolutionType string

const (
	ResolutionTypeRefund   ResolutionType = "refund"
	ResolutionTypeReversal ResolutionType = "reversal"
	ResolutionTypeCredit   ResolutionType = "credit"
	ResolutionTypeRejected ResolutionType = "rejected"
	ResolutionTypeNoAction ResolutionType = "no_action"
)

type DisputeResolution struct {
	Type                ResolutionType `json:"type"`
	Amount              float64        `json:"amount,omitempty"`
	Description         string         `json:"description"`
	ResolvedBy          string         `json:"resolvedBy"`
	ResolvedAt          time.Time      `json:"resolvedAt"`
	RefundTransactionID string         `json:"refundTransactionId,omitempty"`
}

type Dispute struct {
	ID            string                 `json:"id"`
	Type          DisputeType            `json:"type"`
	Status        DisputeStatus          `json:"status"`
	Priority      DisputePriority        `json:"priority"`
	TransactionID string                 `json:"transactionId"`
	CustomerID    string                 `json:"customerId"`
	MerchantID    string                 `json:"merchantId,omitempty"`
	Amount        float64                `json:"amount"`
	Currency      string                 `json:"currency"`
	Reason        DisputeReason          `json:"reason"`
	Description   string                 `json:"description"`
	Evidence      []*DisputeEvidence     `json:"evidence"`
	Timeline      []*DisputeEvent        `json:"timeline"`
	AssignedTo    string                 `json:"assignedTo,omitempty"`
	Resolution    *DisputeResolution     `json:"resolution,omitempty"`
	CreatedAt     time.Time              `json:"createdAt"`
	UpdatedAt     time.Time              `json:"updatedAt"`
	DueDate       time.Time              `json:"dueDate"`
	EscalatedAt   *time.Time             `json:"escalatedAt,omitempty"`
	ResolvedAt    *time.Time             `json:"resolvedAt,omitempty"`
	Metadata      map[string]interface{} `json:"metadata,omitempty"`
}

type DisputeFilter struct {
	Status     []DisputeStatus   `json:"status,omitempty"`
	Type       []DisputeType     `json:"type,omitempty"`
	Priority   []DisputePriority `json:"priority,omitempty"`
	AssignedTo string            `json:"assignedTo,omitempty"`
	CustomerID string            `json:"customerId,omitempty"`
	MerchantID string            `json:"merchantId,omitempty"`
	DateFrom   *time.Time        `json:"dateFrom,omitempty"`
	DateTo     *time.Time        `json:"dateTo,omitempty"`
}

type DisputeStats struct {
	Total             int                     `json:"total"`
	Open              int                     `json:"open"`
	UnderReview       int                     `json:"underReview"`
	Escalated         int                     `json:"escalated"`
	Resolved          int                     `json:"resolved"`
	AvgResolutionTime float64                 `json:"avgResolutionTime"`
	ByType            map[DisputeType]int     `json:"byType"`
	ByPriority        map[DisputePriority]int `json:"byPriority"`
}

type SLAConfig struct {
	LowPriorityHours         int `json:"lowPriorityHours"`
	MediumPriorityHours      int `json:"mediumPriorityHours"`
	HighPriorityHours        int `json:"highPriorityHours"`
	CriticalPriorityHours    int `json:"criticalPriorityHours"`
	EscalationThresholdHours int `json:"escalationThresholdHours"`
}

type DisputeService struct {
	mu        sync.RWMutex
	disputes  map[string]*Dispute
	slaConfig SLAConfig
	db        *sql.DB
}

func NewDisputeService(slaConfig *SLAConfig) *DisputeService {
	if slaConfig == nil {
		slaConfig = &SLAConfig{
			LowPriorityHours:         72,
			MediumPriorityHours:      48,
			HighPriorityHours:        24,
			CriticalPriorityHours:    4,
			EscalationThresholdHours: 24,
		}
	}

	return &DisputeService{
		disputes:  make(map[string]*Dispute),
		slaConfig: *slaConfig,
	}
}

func (s *DisputeService) CreateDispute(params struct {
	Type          DisputeType
	TransactionID string
	CustomerID    string
	MerchantID    string
	Amount        float64
	Currency      string
	Reason        DisputeReason
	Description   string
	Priority      DisputePriority
	Metadata      map[string]interface{}
}) *Dispute {
	priority := params.Priority
	if priority == "" {
		priority = s.calculatePriority(params.Type, params.Amount)
	}
	dueDate := s.calculateDueDate(priority)

	dispute := &Dispute{
		ID:            s.generateID(),
		Type:          params.Type,
		Status:        DisputeStatusOpen,
		Priority:      priority,
		TransactionID: params.TransactionID,
		CustomerID:    params.CustomerID,
		MerchantID:    params.MerchantID,
		Amount:        params.Amount,
		Currency:      params.Currency,
		Reason:        params.Reason,
		Description:   params.Description,
		Evidence:      make([]*DisputeEvidence, 0),
		Timeline: []*DisputeEvent{{
			ID:          s.generateEventID(),
			Type:        EventTypeCreated,
			Description: fmt.Sprintf("Dispute created: %s", params.Description),
			Actor:       "system",
			Timestamp:   time.Now(),
		}},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		DueDate:   dueDate,
		Metadata:  params.Metadata,
	}

	s.mu.Lock()
	s.disputes[dispute.ID] = dispute
	s.mu.Unlock()
	go s.persistDispute(dispute)

	return dispute
}

func (s *DisputeService) GetDispute(disputeID string) *Dispute {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.disputes[disputeID]
}

func (s *DisputeService) UpdateStatus(disputeID string, status DisputeStatus, actor, comment string) (*Dispute, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	dispute, exists := s.disputes[disputeID]
	if !exists {
		return nil, fmt.Errorf("dispute not found: %s", disputeID)
	}

	oldStatus := dispute.Status
	dispute.Status = status
	dispute.UpdatedAt = time.Now()

	description := fmt.Sprintf("Status changed from %s to %s", oldStatus, status)
	if comment != "" {
		description += fmt.Sprintf(": %s", comment)
	}

	dispute.Timeline = append(dispute.Timeline, &DisputeEvent{
		ID:          s.generateEventID(),
		Type:        EventTypeStatusChanged,
		Description: description,
		Actor:       actor,
		Timestamp:   time.Now(),
		Metadata: map[string]interface{}{
			"oldStatus": oldStatus,
			"newStatus": status,
		},
	})

	if status == DisputeStatusEscalated {
		now := time.Now()
		dispute.EscalatedAt = &now
	}

	go s.persistDispute(dispute)
	return dispute, nil
}

func (s *DisputeService) AssignDispute(disputeID, assignee, actor string) (*Dispute, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	dispute, exists := s.disputes[disputeID]
	if !exists {
		return nil, fmt.Errorf("dispute not found: %s", disputeID)
	}

	oldAssignee := dispute.AssignedTo
	dispute.AssignedTo = assignee
	dispute.UpdatedAt = time.Now()

	if dispute.Status == DisputeStatusOpen {
		dispute.Status = DisputeStatusUnderReview
	}

	description := fmt.Sprintf("Assigned to %s", assignee)
	if oldAssignee != "" {
		description += fmt.Sprintf(" (previously %s)", oldAssignee)
	}

	dispute.Timeline = append(dispute.Timeline, &DisputeEvent{
		ID:          s.generateEventID(),
		Type:        EventTypeAssigned,
		Description: description,
		Actor:       actor,
		Timestamp:   time.Now(),
	})

	go s.persistDispute(dispute)
	return dispute, nil
}

func (s *DisputeService) AddEvidence(disputeID string, evidence struct {
	Type        EvidenceType
	Description string
	FileURL     string
	Content     string
	UploadedBy  string
}) (*Dispute, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	dispute, exists := s.disputes[disputeID]
	if !exists {
		return nil, fmt.Errorf("dispute not found: %s", disputeID)
	}

	fullEvidence := &DisputeEvidence{
		ID:          s.generateEventID(),
		Type:        evidence.Type,
		Description: evidence.Description,
		FileURL:     evidence.FileURL,
		Content:     evidence.Content,
		UploadedBy:  evidence.UploadedBy,
		UploadedAt:  time.Now(),
	}

	dispute.Evidence = append(dispute.Evidence, fullEvidence)
	dispute.UpdatedAt = time.Now()

	dispute.Timeline = append(dispute.Timeline, &DisputeEvent{
		ID:          s.generateEventID(),
		Type:        EventTypeEvidenceAdded,
		Description: fmt.Sprintf("Evidence added: %s", evidence.Description),
		Actor:       evidence.UploadedBy,
		Timestamp:   time.Now(),
	})

	go s.persistDispute(dispute)
	return dispute, nil
}

func (s *DisputeService) AddComment(disputeID, comment, actor string) (*Dispute, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	dispute, exists := s.disputes[disputeID]
	if !exists {
		return nil, fmt.Errorf("dispute not found: %s", disputeID)
	}

	dispute.Timeline = append(dispute.Timeline, &DisputeEvent{
		ID:          s.generateEventID(),
		Type:        EventTypeComment,
		Description: comment,
		Actor:       actor,
		Timestamp:   time.Now(),
	})

	dispute.UpdatedAt = time.Now()
	go s.persistDispute(dispute)
	return dispute, nil
}

func (s *DisputeService) ResolveDispute(disputeID string, resolution struct {
	Type                ResolutionType
	Amount              float64
	Description         string
	ResolvedBy          string
	RefundTransactionID string
}) (*Dispute, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	dispute, exists := s.disputes[disputeID]
	if !exists {
		return nil, fmt.Errorf("dispute not found: %s", disputeID)
	}

	dispute.Resolution = &DisputeResolution{
		Type:                resolution.Type,
		Amount:              resolution.Amount,
		Description:         resolution.Description,
		ResolvedBy:          resolution.ResolvedBy,
		ResolvedAt:          time.Now(),
		RefundTransactionID: resolution.RefundTransactionID,
	}
	dispute.Status = DisputeStatusResolved
	now := time.Now()
	dispute.ResolvedAt = &now
	dispute.UpdatedAt = now

	dispute.Timeline = append(dispute.Timeline, &DisputeEvent{
		ID:          s.generateEventID(),
		Type:        EventTypeResolved,
		Description: fmt.Sprintf("Dispute resolved: %s - %s", resolution.Type, resolution.Description),
		Actor:       resolution.ResolvedBy,
		Timestamp:   time.Now(),
		Metadata: map[string]interface{}{
			"resolution": resolution,
		},
	})

	go s.persistDispute(dispute)
	return dispute, nil
}

func (s *DisputeService) EscalateDispute(disputeID, reason, actor string) (*Dispute, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	dispute, exists := s.disputes[disputeID]
	if !exists {
		return nil, fmt.Errorf("dispute not found: %s", disputeID)
	}

	dispute.Status = DisputeStatusEscalated
	now := time.Now()
	dispute.EscalatedAt = &now
	dispute.Priority = PriorityCritical
	dispute.UpdatedAt = now

	dispute.Timeline = append(dispute.Timeline, &DisputeEvent{
		ID:          s.generateEventID(),
		Type:        EventTypeEscalated,
		Description: fmt.Sprintf("Dispute escalated: %s", reason),
		Actor:       actor,
		Timestamp:   time.Now(),
	})

	go s.persistDispute(dispute)
	return dispute, nil
}

func (s *DisputeService) ListDisputes(filter *DisputeFilter) []*Dispute {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var disputes []*Dispute
	for _, d := range s.disputes {
		disputes = append(disputes, d)
	}

	if filter != nil {
		var filtered []*Dispute
		for _, d := range disputes {
			if len(filter.Status) > 0 && !containsStatus(filter.Status, d.Status) {
				continue
			}
			if len(filter.Type) > 0 && !containsType(filter.Type, d.Type) {
				continue
			}
			if len(filter.Priority) > 0 && !containsPriority(filter.Priority, d.Priority) {
				continue
			}
			if filter.AssignedTo != "" && d.AssignedTo != filter.AssignedTo {
				continue
			}
			if filter.CustomerID != "" && d.CustomerID != filter.CustomerID {
				continue
			}
			if filter.MerchantID != "" && d.MerchantID != filter.MerchantID {
				continue
			}
			if filter.DateFrom != nil && d.CreatedAt.Before(*filter.DateFrom) {
				continue
			}
			if filter.DateTo != nil && d.CreatedAt.After(*filter.DateTo) {
				continue
			}
			filtered = append(filtered, d)
		}
		disputes = filtered
	}

	sort.Slice(disputes, func(i, j int) bool {
		return disputes[i].CreatedAt.After(disputes[j].CreatedAt)
	})

	return disputes
}

func (s *DisputeService) GetStats() *DisputeStats {
	s.mu.RLock()
	defer s.mu.RUnlock()

	stats := &DisputeStats{
		ByType: map[DisputeType]int{
			DisputeTypeFailedPayout:            0,
			DisputeTypeWrongBeneficiary:        0,
			DisputeTypeDuplicateTransaction:    0,
			DisputeTypeUnauthorizedTransaction: 0,
			DisputeTypeServiceNotReceived:      0,
			DisputeTypeAmountMismatch:          0,
			DisputeTypeRefundRequest:           0,
			DisputeTypeChargeback:              0,
		},
		ByPriority: map[DisputePriority]int{
			PriorityLow:      0,
			PriorityMedium:   0,
			PriorityHigh:     0,
			PriorityCritical: 0,
		},
	}

	var totalResolutionTime float64
	resolvedCount := 0

	for _, d := range s.disputes {
		stats.Total++
		stats.ByType[d.Type]++
		stats.ByPriority[d.Priority]++

		switch d.Status {
		case DisputeStatusOpen:
			stats.Open++
		case DisputeStatusUnderReview:
			stats.UnderReview++
		case DisputeStatusEscalated:
			stats.Escalated++
		case DisputeStatusResolved:
			stats.Resolved++
			if d.ResolvedAt != nil {
				totalResolutionTime += d.ResolvedAt.Sub(d.CreatedAt).Hours()
				resolvedCount++
			}
		}
	}

	if resolvedCount > 0 {
		stats.AvgResolutionTime = totalResolutionTime / float64(resolvedCount)
	}

	return stats
}

func (s *DisputeService) GetOverdueDisputes() []*Dispute {
	s.mu.RLock()
	defer s.mu.RUnlock()

	now := time.Now()
	var overdue []*Dispute

	for _, d := range s.disputes {
		if d.Status != DisputeStatusResolved &&
			d.Status != DisputeStatusClosed &&
			d.Status != DisputeStatusRejected &&
			d.DueDate.Before(now) {
			overdue = append(overdue, d)
		}
	}

	return overdue
}

func (s *DisputeService) CheckSLABreaches() []*Dispute {
	s.mu.RLock()
	defer s.mu.RUnlock()

	now := time.Now()
	var breaches []*Dispute

	for _, d := range s.disputes {
		if d.Status == DisputeStatusResolved || d.Status == DisputeStatusClosed {
			continue
		}

		hoursOpen := now.Sub(d.CreatedAt).Hours()
		slaHours := s.getSLAHours(d.Priority)

		if hoursOpen > float64(slaHours) {
			breaches = append(breaches, d)
		}
	}

	return breaches
}

func (s *DisputeService) AutoEscalateOverdue() []*Dispute {
	overdueDisputes := s.GetOverdueDisputes()
	var escalated []*Dispute

	for _, d := range overdueDisputes {
		if d.Status != DisputeStatusEscalated {
			s.EscalateDispute(d.ID, "Auto-escalated due to SLA breach", "system")
			escalated = append(escalated, d)
		}
	}

	return escalated
}

func (s *DisputeService) calculatePriority(disputeType DisputeType, amount float64) DisputePriority {
	if disputeType == DisputeTypeUnauthorizedTransaction || disputeType == DisputeTypeChargeback {
		return PriorityCritical
	}

	if amount > 1000000 {
		return PriorityCritical
	}
	if amount > 100000 {
		return PriorityHigh
	}
	if amount > 10000 {
		return PriorityMedium
	}
	return PriorityLow
}

func (s *DisputeService) calculateDueDate(priority DisputePriority) time.Time {
	hours := s.getSLAHours(priority)
	return time.Now().Add(time.Duration(hours) * time.Hour)
}

func (s *DisputeService) getSLAHours(priority DisputePriority) int {
	switch priority {
	case PriorityCritical:
		return s.slaConfig.CriticalPriorityHours
	case PriorityHigh:
		return s.slaConfig.HighPriorityHours
	case PriorityMedium:
		return s.slaConfig.MediumPriorityHours
	default:
		return s.slaConfig.LowPriorityHours
	}
}

func (s *DisputeService) generateID() string {
	bytes := make([]byte, 4)
	rand.Read(bytes)
	return fmt.Sprintf("DSP-%d-%s", time.Now().UnixNano()/1000000, hex.EncodeToString(bytes))
}

func (s *DisputeService) generateEventID() string {
	bytes := make([]byte, 8)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

func containsStatus(slice []DisputeStatus, item DisputeStatus) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

func containsType(slice []DisputeType, item DisputeType) bool {
	for _, t := range slice {
		if t == item {
			return true
		}
	}
	return false
}

func containsPriority(slice []DisputePriority, item DisputePriority) bool {
	for _, p := range slice {
		if p == item {
			return true
		}
	}
	return false
}
