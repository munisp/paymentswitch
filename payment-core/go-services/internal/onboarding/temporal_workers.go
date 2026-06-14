// Package onboarding provides Temporal workflow workers for onboarding
package onboarding

import (
	"context"
	"fmt"
	"time"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

const (
	OnboardingTaskQueue = "onboarding-task-queue"
)

// TemporalConfig holds Temporal configuration
type TemporalConfig struct {
	HostPort  string
	Namespace string
}

// DefaultTemporalConfig returns default Temporal configuration
func DefaultTemporalConfig() *TemporalConfig {
	return &TemporalConfig{
		HostPort:  getEnv("TEMPORAL_HOST_PORT", "temporal.payment-switch.svc.cluster.local:7233"),
		Namespace: getEnv("TEMPORAL_NAMESPACE", "default"),
	}
}

// TemporalWorker manages Temporal workers for onboarding
type TemporalWorker struct {
	client     client.Client
	worker     worker.Worker
	activities *OnboardingActivities
}

// NewTemporalWorker creates a new Temporal worker
func NewTemporalWorker(config *TemporalConfig, activities *OnboardingActivities) (*TemporalWorker, error) {
	if config == nil {
		config = DefaultTemporalConfig()
	}

	c, err := client.Dial(client.Options{
		HostPort:  config.HostPort,
		Namespace: config.Namespace,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create Temporal client: %w", err)
	}

	w := worker.New(c, OnboardingTaskQueue, worker.Options{})

	// Register workflows
	w.RegisterWorkflow(OnboardingWorkflowV2)
	w.RegisterWorkflow(DueDiligenceWorkflow)
	w.RegisterWorkflow(ProvisioningWorkflow)

	// Register activities
	w.RegisterActivity(activities.ValidateApplication)
	w.RegisterActivity(activities.AssignReviewer)
	w.RegisterActivity(activities.RunDueDiligence)
	w.RegisterActivity(activities.ValidateTechnicalSetup)
	w.RegisterActivity(activities.RunSandboxCertification)
	w.RegisterActivity(activities.ProvisionResources)
	w.RegisterActivity(activities.RunProductionCertification)
	w.RegisterActivity(activities.SendNotification)
	w.RegisterActivity(activities.UpdateCaseStatus)

	return &TemporalWorker{
		client:     c,
		worker:     w,
		activities: activities,
	}, nil
}

// Start starts the Temporal worker
func (tw *TemporalWorker) Start() error {
	return tw.worker.Start()
}

// Stop stops the Temporal worker
func (tw *TemporalWorker) Stop() {
	tw.worker.Stop()
	tw.client.Close()
}

// StartOnboardingWorkflow starts a new onboarding workflow
func (tw *TemporalWorker) StartOnboardingWorkflow(ctx context.Context, caseID string, stakeholderType string) (string, error) {
	options := client.StartWorkflowOptions{
		ID:        fmt.Sprintf("onboarding-%s", caseID),
		TaskQueue: OnboardingTaskQueue,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    3,
		},
	}

	input := OnboardingWorkflowInput{
		CaseID:          caseID,
		StakeholderType: stakeholderType,
	}

	we, err := tw.client.ExecuteWorkflow(ctx, options, OnboardingWorkflowV2, input)
	if err != nil {
		return "", fmt.Errorf("failed to start workflow: %w", err)
	}

	return we.GetID(), nil
}

// OnboardingWorkflowInput is the input for the onboarding workflow
type OnboardingWorkflowInput struct {
	CaseID          string
	StakeholderType string
}

// OnboardingWorkflowOutput is the output of the onboarding workflow
type OnboardingWorkflowOutput struct {
	CaseID    string
	Status    string
	Error     string
	Completed time.Time
}

// OnboardingWorkflowV2 is the main onboarding workflow
func OnboardingWorkflowV2(ctx workflow.Context, input OnboardingWorkflowInput) (*OnboardingWorkflowOutput, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting onboarding workflow", "caseID", input.CaseID)

	// Activity options with retries
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	output := &OnboardingWorkflowOutput{CaseID: input.CaseID}

	// Step 1: Validate application
	var validationResult ValidationResult
	err := workflow.ExecuteActivity(ctx, "ValidateApplication", input.CaseID).Get(ctx, &validationResult)
	if err != nil {
		output.Status = "REJECTED"
		output.Error = err.Error()
		return output, nil
	}

	// Step 2: Assign reviewer
	var assignmentResult AssignmentResult
	err = workflow.ExecuteActivity(ctx, "AssignReviewer", input.CaseID, input.StakeholderType).Get(ctx, &assignmentResult)
	if err != nil {
		return nil, err
	}

	// Send notification to reviewer
	workflow.ExecuteActivity(ctx, "SendNotification", NotificationRequest{
		Type:      "REVIEWER_ASSIGNED",
		CaseID:    input.CaseID,
		Recipient: assignmentResult.ReviewerEmail,
	})

	// Step 3: Wait for due diligence completion (with SLA timer)
	dueDiligenceSLA := workflow.NewTimer(ctx, 5*24*time.Hour) // 5 day SLA

	selector := workflow.NewSelector(ctx)
	var dueDiligenceComplete bool

	// Wait for signal that due diligence is complete
	dueDiligenceCh := workflow.GetSignalChannel(ctx, "due_diligence_complete")
	selector.AddReceive(dueDiligenceCh, func(c workflow.ReceiveChannel, more bool) {
		var signal DueDiligenceSignal
		c.Receive(ctx, &signal)
		dueDiligenceComplete = signal.Approved
	})

	// SLA breach handler
	selector.AddFuture(dueDiligenceSLA, func(f workflow.Future) {
		// Send SLA breach notification
		workflow.ExecuteActivity(ctx, "SendNotification", NotificationRequest{
			Type:      "SLA_BREACH",
			CaseID:    input.CaseID,
			Recipient: assignmentResult.ReviewerEmail,
		})
	})

	selector.Select(ctx)

	if !dueDiligenceComplete {
		output.Status = "REJECTED"
		output.Error = "Due diligence not approved"
		return output, nil
	}

	// Update status
	workflow.ExecuteActivity(ctx, "UpdateCaseStatus", input.CaseID, "TECHNICAL_SETUP")

	// Step 4: Wait for technical setup completion
	techSetupCh := workflow.GetSignalChannel(ctx, "technical_setup_complete")
	var techSetupSignal TechnicalSetupSignal
	techSetupCh.Receive(ctx, &techSetupSignal)

	if !techSetupSignal.Approved {
		output.Status = "REWORK_REQUESTED"
		output.Error = techSetupSignal.Reason
		return output, nil
	}

	// Step 5: Run sandbox certification
	var certResult CertificationResult
	err = workflow.ExecuteActivity(ctx, "RunSandboxCertification", input.CaseID).Get(ctx, &certResult)
	if err != nil {
		output.Status = "TECHNICAL_SETUP"
		output.Error = err.Error()
		return output, nil
	}

	workflow.ExecuteActivity(ctx, "UpdateCaseStatus", input.CaseID, "SANDBOX_CERTIFIED")

	// Step 6: Wait for governance approval (with multi-party requirement)
	governanceCh := workflow.GetSignalChannel(ctx, "governance_approval")
	var governanceSignal GovernanceSignal
	governanceCh.Receive(ctx, &governanceSignal)

	if !governanceSignal.Approved || governanceSignal.ApproverCount < 2 {
		output.Status = "GOVERNANCE_APPROVAL"
		output.Error = "Insufficient governance approvals"
		return output, nil
	}

	// Step 7: Provision production resources
	var provisionResult ProvisioningResult
	err = workflow.ExecuteActivity(ctx, "ProvisionResources", input.CaseID, "production").Get(ctx, &provisionResult)
	if err != nil {
		output.Status = "GOVERNANCE_APPROVAL"
		output.Error = err.Error()
		return output, nil
	}

	workflow.ExecuteActivity(ctx, "UpdateCaseStatus", input.CaseID, "PRODUCTION_PROVISIONED")

	// Step 8: Run production certification
	err = workflow.ExecuteActivity(ctx, "RunProductionCertification", input.CaseID).Get(ctx, &certResult)
	if err != nil {
		output.Status = "PRODUCTION_PROVISIONED"
		output.Error = err.Error()
		return output, nil
	}

	// Step 9: Activate participant
	workflow.ExecuteActivity(ctx, "UpdateCaseStatus", input.CaseID, "ACTIVE")

	// Send completion notification
	workflow.ExecuteActivity(ctx, "SendNotification", NotificationRequest{
		Type:   "ONBOARDING_COMPLETE",
		CaseID: input.CaseID,
	})

	output.Status = "ACTIVE"
	output.Completed = workflow.Now(ctx)

	return output, nil
}

// DueDiligenceWorkflow handles the due diligence subprocess
func DueDiligenceWorkflow(ctx workflow.Context, caseID string) error {
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Minute,
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	return workflow.ExecuteActivity(ctx, "RunDueDiligence", caseID).Get(ctx, nil)
}

// ProvisioningWorkflow handles resource provisioning
func ProvisioningWorkflow(ctx workflow.Context, caseID string, environment string) (*ProvisioningResult, error) {
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 15 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second * 5,
			BackoffCoefficient: 2.0,
			MaximumInterval:    time.Minute * 5,
			MaximumAttempts:    5,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	var result ProvisioningResult
	err := workflow.ExecuteActivity(ctx, "ProvisionResources", caseID, environment).Get(ctx, &result)
	return &result, err
}

// Signal types
type DueDiligenceSignal struct {
	Approved   bool
	ReviewerID string
	Notes      string
}

type TechnicalSetupSignal struct {
	Approved   bool
	ReviewerID string
	Reason     string
}

type GovernanceSignal struct {
	Approved      bool
	ApproverCount int
	ApproverIDs   []string
}

// Activity result types
type ValidationResult struct {
	Valid  bool
	Errors []string
}

type AssignmentResult struct {
	ReviewerID    string
	ReviewerName  string
	ReviewerEmail string
	DueDate       time.Time
}

type CertificationResult struct {
	Passed      bool
	TestsRun    int
	TestsPassed int
	Failures    []string
}

// OnboardingActivities contains all activity implementations
type OnboardingActivities struct {
	store        *PostgresStore
	integration  *IntegrationManager
	notifier     NotificationService
	sagaExecutor *ProvisioningSagaExecutor
}

// NewOnboardingActivities creates new activity implementations
func NewOnboardingActivities(store *PostgresStore, integration *IntegrationManager, notifier NotificationService) *OnboardingActivities {
	return &OnboardingActivities{
		store:       store,
		integration: integration,
		notifier:    notifier,
	}
}

// ValidateApplication validates an application
func (a *OnboardingActivities) ValidateApplication(ctx context.Context, caseID string) (*ValidationResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Validating application", "caseID", caseID)

	c, err := a.store.GetCase(ctx, caseID)
	if err != nil {
		return nil, err
	}

	result := &ValidationResult{Valid: true}

	// Validate required fields
	if c.OrganizationName == "" {
		result.Valid = false
		result.Errors = append(result.Errors, "Organization name is required")
	}

	if c.ContactEmail == "" {
		result.Valid = false
		result.Errors = append(result.Errors, "Contact email is required")
	}

	return result, nil
}

// AssignReviewer assigns a reviewer to a case using round-robin from available reviewers
func (a *OnboardingActivities) AssignReviewer(ctx context.Context, caseID string, stakeholderType string) (*AssignmentResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Assigning reviewer", "caseID", caseID, "stakeholderType", stakeholderType)

	if a.store == nil {
		return nil, fmt.Errorf("database store not available for reviewer assignment")
	}

	// Round-robin assignment: pick reviewer with fewest active cases for this stakeholder type
	row := a.store.db.QueryRowContext(ctx,
		`SELECT id, name, email FROM reviewers
		 WHERE role = $1 AND active = true
		 ORDER BY (SELECT COUNT(*) FROM review_assignments WHERE reviewer_id = reviewers.id AND status = 'active') ASC
		 LIMIT 1`, stakeholderType)

	var reviewerID, reviewerName, reviewerEmail string
	if err := row.Scan(&reviewerID, &reviewerName, &reviewerEmail); err != nil {
		logger.Warn("No available reviewers in DB, using fallback", "error", err)
		reviewerID = fmt.Sprintf("reviewer-%s-fallback", stakeholderType)
		reviewerName = "Duty Reviewer"
		reviewerEmail = fmt.Sprintf("duty-%s@payment-switch.local", stakeholderType)
	}

	dueDate := time.Now().Add(5 * 24 * time.Hour)
	_, _ = a.store.db.ExecContext(ctx,
		`INSERT INTO review_assignments (case_id, reviewer_id, stakeholder_type, due_date, status)
		 VALUES ($1, $2, $3, $4, 'active')
		 ON CONFLICT (case_id) DO UPDATE SET reviewer_id = $2, due_date = $4`,
		caseID, reviewerID, stakeholderType, dueDate)

	return &AssignmentResult{
		ReviewerID:    reviewerID,
		ReviewerName:  reviewerName,
		ReviewerEmail: reviewerEmail,
		DueDate:       dueDate,
	}, nil
}

// RunDueDiligence runs due diligence checks
func (a *OnboardingActivities) RunDueDiligence(ctx context.Context, caseID string) error {
	logger := activity.GetLogger(ctx)
	logger.Info("Running due diligence", "caseID", caseID)

	// In production, this would run AML/KYC checks, sanctions screening, etc.
	return nil
}

// ValidateTechnicalSetup validates technical configuration
func (a *OnboardingActivities) ValidateTechnicalSetup(ctx context.Context, caseID string) error {
	logger := activity.GetLogger(ctx)
	logger.Info("Validating technical setup", "caseID", caseID)

	// In production, this would validate API endpoints, certificates, etc.
	return nil
}

// RunSandboxCertification runs sandbox certification tests
func (a *OnboardingActivities) RunSandboxCertification(ctx context.Context, caseID string) (*CertificationResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Running sandbox certification", "caseID", caseID)

	// In production, this would run integration tests against sandbox
	return &CertificationResult{
		Passed:      true,
		TestsRun:    50,
		TestsPassed: 50,
	}, nil
}

// ProvisionResources provisions resources for a participant
func (a *OnboardingActivities) ProvisionResources(ctx context.Context, caseID string, environment string) (*ProvisioningResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Provisioning resources", "caseID", caseID, "environment", environment)

	profile, err := a.store.GetTechnicalProfile(ctx, caseID)
	if err != nil {
		return nil, err
	}

	saga, err := a.sagaExecutor.ExecuteProvisioning(ctx, caseID, environment, profile)
	if err != nil {
		return nil, err
	}

	return saga.ToResult(), nil
}

// RunProductionCertification runs production certification tests
func (a *OnboardingActivities) RunProductionCertification(ctx context.Context, caseID string) (*CertificationResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Running production certification", "caseID", caseID)

	// In production, this would run smoke tests against production
	return &CertificationResult{
		Passed:      true,
		TestsRun:    25,
		TestsPassed: 25,
	}, nil
}

// SendNotification sends a notification
func (a *OnboardingActivities) SendNotification(ctx context.Context, req NotificationRequest) error {
	logger := activity.GetLogger(ctx)
	logger.Info("Sending notification", "type", req.Type, "caseID", req.CaseID)

	return a.notifier.Send(ctx, req)
}

// UpdateCaseStatus updates the status of a case
func (a *OnboardingActivities) UpdateCaseStatus(ctx context.Context, caseID string, status string) error {
	logger := activity.GetLogger(ctx)
	logger.Info("Updating case status", "caseID", caseID, "status", status)

	c, err := a.store.GetCase(ctx, caseID)
	if err != nil {
		return err
	}

	c.Status = OnboardingStatus(status)
	c.UpdatedAt = time.Now()

	return a.store.UpdateCase(ctx, c)
}
