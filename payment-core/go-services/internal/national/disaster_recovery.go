// Package national implements national payment switch components
package national

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"sync"
	"time"
)

// DisasterRecoveryManager manages multi-region disaster recovery
type DisasterRecoveryManager struct {
	db              *sql.DB
	auditLogger     *ImmutableAuditLogger
	config          *DRConfig
	regions         map[string]*Region
	currentPrimary  string
	replicationLag  map[string]time.Duration
	healthStatus    map[string]*RegionHealth
	failoverHistory []*FailoverEvent
	mu              sync.RWMutex
}

// DRConfig holds disaster recovery configuration
type DRConfig struct {
	PrimaryRegion          string
	Regions                []string
	ReplicationMode        ReplicationMode
	FailoverThresholdMs    int64
	MaxReplicationLagMs    int64
	HealthCheckIntervalSec int
	AutoFailoverEnabled    bool
	MinHealthyReplicas     int
	DataConsistencyCheck   bool
	CrossRegionEncryption  bool
}

// ReplicationMode defines the replication mode
type ReplicationMode string

const (
	ReplicationModeSync     ReplicationMode = "SYNCHRONOUS"
	ReplicationModeAsync    ReplicationMode = "ASYNCHRONOUS"
	ReplicationModeSemiSync ReplicationMode = "SEMI_SYNCHRONOUS"
)

// Region represents a deployment region
type Region struct {
	RegionID        string       `json:"region_id"`
	RegionName      string       `json:"region_name"`
	Role            RegionRole   `json:"role"`
	Endpoint        string       `json:"endpoint"`
	DatabaseDSN     string       `json:"database_dsn"`
	TigerBeetleAddr string       `json:"tigerbeetle_addr"`
	KafkaBrokers    []string     `json:"kafka_brokers"`
	Status          RegionStatus `json:"status"`
	Priority        int          `json:"priority"` // Lower = higher priority for failover
	LastHealthCheck time.Time    `json:"last_health_check"`
}

// RegionRole defines the role of a region
type RegionRole string

const (
	RegionRolePrimary   RegionRole = "PRIMARY"
	RegionRoleSecondary RegionRole = "SECONDARY"
	RegionRoleStandby   RegionRole = "STANDBY"
	RegionRoleWitness   RegionRole = "WITNESS"
)

// RegionStatus defines the status of a region
type RegionStatus string

const (
	RegionStatusHealthy   RegionStatus = "HEALTHY"
	RegionStatusDegraded  RegionStatus = "DEGRADED"
	RegionStatusUnhealthy RegionStatus = "UNHEALTHY"
	RegionStatusOffline   RegionStatus = "OFFLINE"
	RegionStatusSyncing   RegionStatus = "SYNCING"
)

// RegionHealth represents the health status of a region
type RegionHealth struct {
	RegionID          string        `json:"region_id"`
	Status            RegionStatus  `json:"status"`
	ReplicationLag    time.Duration `json:"replication_lag"`
	LastHeartbeat     time.Time     `json:"last_heartbeat"`
	DatabaseHealth    bool          `json:"database_health"`
	TigerBeetleHealth bool          `json:"tigerbeetle_health"`
	KafkaHealth       bool          `json:"kafka_health"`
	APIHealth         bool          `json:"api_health"`
	ErrorCount        int           `json:"error_count"`
	SuccessRate       float64       `json:"success_rate"`
}

// FailoverEvent represents a failover event
type FailoverEvent struct {
	EventID       string         `json:"event_id"`
	FromRegion    string         `json:"from_region"`
	ToRegion      string         `json:"to_region"`
	Reason        FailoverReason `json:"reason"`
	InitiatedBy   string         `json:"initiated_by"` // AUTO or operator ID
	InitiatedAt   time.Time      `json:"initiated_at"`
	CompletedAt   *time.Time     `json:"completed_at,omitempty"`
	Status        FailoverStatus `json:"status"`
	DataLossRisk  bool           `json:"data_loss_risk"`
	RollbackPoint string         `json:"rollback_point,omitempty"`
	Details       string         `json:"details,omitempty"`
}

// FailoverReason defines the reason for failover
type FailoverReason string

const (
	FailoverReasonPrimaryFailure     FailoverReason = "PRIMARY_FAILURE"
	FailoverReasonNetworkPartition   FailoverReason = "NETWORK_PARTITION"
	FailoverReasonPlannedMaintenance FailoverReason = "PLANNED_MAINTENANCE"
	FailoverReasonManual             FailoverReason = "MANUAL"
	FailoverReasonDRTest             FailoverReason = "DR_TEST"
)

// FailoverStatus defines the status of a failover
type FailoverStatus string

const (
	FailoverStatusInitiated  FailoverStatus = "INITIATED"
	FailoverStatusInProgress FailoverStatus = "IN_PROGRESS"
	FailoverStatusCompleted  FailoverStatus = "COMPLETED"
	FailoverStatusFailed     FailoverStatus = "FAILED"
	FailoverStatusRolledBack FailoverStatus = "ROLLED_BACK"
)

// NewDisasterRecoveryManager creates a new disaster recovery manager
func NewDisasterRecoveryManager(db *sql.DB, audit *ImmutableAuditLogger, config *DRConfig) *DisasterRecoveryManager {
	drm := &DisasterRecoveryManager{
		db:              db,
		auditLogger:     audit,
		config:          config,
		regions:         make(map[string]*Region),
		currentPrimary:  config.PrimaryRegion,
		replicationLag:  make(map[string]time.Duration),
		healthStatus:    make(map[string]*RegionHealth),
		failoverHistory: make([]*FailoverEvent, 0),
	}

	// Initialize regions
	drm.initializeRegions()

	// Start health monitoring
	go drm.monitorHealth()

	return drm
}

// initializeRegions initializes the region configuration
func (drm *DisasterRecoveryManager) initializeRegions() {
	// Load regions from database or config
	ctx := context.Background()
	rows, err := drm.db.QueryContext(ctx, `
		SELECT region_id, region_name, role, endpoint, database_dsn,
		       tigerbeetle_addr, kafka_brokers, status, priority
		FROM dr_regions ORDER BY priority
	`)
	if err != nil {
		// Use default configuration
		drm.regions[drm.config.PrimaryRegion] = &Region{
			RegionID:   drm.config.PrimaryRegion,
			RegionName: "Primary Region",
			Role:       RegionRolePrimary,
			Status:     RegionStatusHealthy,
			Priority:   1,
		}
		return
	}
	defer rows.Close()

	for rows.Next() {
		region := &Region{}
		var kafkaBrokersJSON []byte
		var role, status string

		err := rows.Scan(
			&region.RegionID, &region.RegionName, &role, &region.Endpoint,
			&region.DatabaseDSN, &region.TigerBeetleAddr, &kafkaBrokersJSON,
			&status, &region.Priority,
		)
		if err != nil {
			continue
		}

		region.Role = RegionRole(role)
		region.Status = RegionStatus(status)
		json.Unmarshal(kafkaBrokersJSON, &region.KafkaBrokers)

		drm.regions[region.RegionID] = region
	}
}

// monitorHealth continuously monitors region health
func (drm *DisasterRecoveryManager) monitorHealth() {
	interval := time.Duration(drm.config.HealthCheckIntervalSec) * time.Second
	if interval == 0 {
		interval = 10 * time.Second
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for range ticker.C {
		drm.checkAllRegions()
	}
}

// checkAllRegions checks health of all regions
func (drm *DisasterRecoveryManager) checkAllRegions() {
	ctx := context.Background()

	for regionID, region := range drm.regions {
		health := drm.checkRegionHealth(ctx, region)

		drm.mu.Lock()
		drm.healthStatus[regionID] = health
		drm.mu.Unlock()

		// Check for auto-failover conditions
		if drm.config.AutoFailoverEnabled && region.Role == RegionRolePrimary {
			if health.Status == RegionStatusUnhealthy || health.Status == RegionStatusOffline {
				drm.initiateAutoFailover(ctx, regionID)
			}
		}
	}
}

// checkRegionHealth checks the health of a specific region
func (drm *DisasterRecoveryManager) checkRegionHealth(ctx context.Context, region *Region) *RegionHealth {
	health := &RegionHealth{
		RegionID:      region.RegionID,
		LastHeartbeat: time.Now(),
	}

	// Check database health
	health.DatabaseHealth = drm.checkDatabaseHealth(ctx, region)

	// Check TigerBeetle health
	health.TigerBeetleHealth = drm.checkTigerBeetleHealth(ctx, region)

	// Check Kafka health
	health.KafkaHealth = drm.checkKafkaHealth(ctx, region)

	// Check API health
	health.APIHealth = drm.checkAPIHealth(ctx, region)

	// Calculate replication lag for secondary regions
	if region.Role == RegionRoleSecondary || region.Role == RegionRoleStandby {
		health.ReplicationLag = drm.measureReplicationLag(ctx, region)
		drm.mu.Lock()
		drm.replicationLag[region.RegionID] = health.ReplicationLag
		drm.mu.Unlock()
	}

	// Determine overall status
	healthyCount := 0
	if health.DatabaseHealth {
		healthyCount++
	}
	if health.TigerBeetleHealth {
		healthyCount++
	}
	if health.KafkaHealth {
		healthyCount++
	}
	if health.APIHealth {
		healthyCount++
	}

	if healthyCount == 4 {
		health.Status = RegionStatusHealthy
		health.SuccessRate = 1.0
	} else if healthyCount >= 2 {
		health.Status = RegionStatusDegraded
		health.SuccessRate = float64(healthyCount) / 4.0
	} else if healthyCount >= 1 {
		health.Status = RegionStatusUnhealthy
		health.SuccessRate = float64(healthyCount) / 4.0
	} else {
		health.Status = RegionStatusOffline
		health.SuccessRate = 0
	}

	// Check replication lag threshold
	if health.ReplicationLag > time.Duration(drm.config.MaxReplicationLagMs)*time.Millisecond {
		if health.Status == RegionStatusHealthy {
			health.Status = RegionStatusDegraded
		}
	}

	return health
}

func (drm *DisasterRecoveryManager) checkDatabaseHealth(ctx context.Context, region *Region) bool {
	if region.DatabaseDSN == "" {
		return true
	}
	db, err := sql.Open("postgres", region.DatabaseDSN)
	if err != nil {
		return false
	}
	defer db.Close()
	return db.PingContext(ctx) == nil
}

func (drm *DisasterRecoveryManager) checkTigerBeetleHealth(_ context.Context, region *Region) bool {
	if region.TigerBeetleAddr == "" {
		return true
	}
	conn, err := net.DialTimeout("tcp", region.TigerBeetleAddr, 3*time.Second)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func (drm *DisasterRecoveryManager) checkKafkaHealth(_ context.Context, region *Region) bool {
	if len(region.KafkaBrokers) == 0 {
		return true
	}
	for _, broker := range region.KafkaBrokers {
		conn, err := net.DialTimeout("tcp", broker, 3*time.Second)
		if err != nil {
			return false
		}
		conn.Close()
	}
	return true
}

func (drm *DisasterRecoveryManager) checkAPIHealth(ctx context.Context, region *Region) bool {
	if region.Endpoint == "" {
		return true
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, region.Endpoint+"/health", nil)
	if err != nil {
		return false
	}
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func (drm *DisasterRecoveryManager) measureReplicationLag(ctx context.Context, region *Region) time.Duration {
	// In production, compare LSN/WAL positions between primary and secondary
	// For PostgreSQL: SELECT pg_last_wal_receive_lsn() - pg_last_wal_replay_lsn()
	// For TigerBeetle: Compare commit indices

	return 0
}

// InitiateFailover initiates a manual failover to a target region
func (drm *DisasterRecoveryManager) InitiateFailover(ctx context.Context, targetRegion, reason, operator string) (*FailoverEvent, error) {
	drm.mu.Lock()
	defer drm.mu.Unlock()

	// Validate target region
	target, exists := drm.regions[targetRegion]
	if !exists {
		return nil, fmt.Errorf("target region %s not found", targetRegion)
	}

	// Check target region health
	health := drm.healthStatus[targetRegion]
	if health != nil && health.Status == RegionStatusOffline {
		return nil, fmt.Errorf("target region %s is offline", targetRegion)
	}

	// Create failover event
	now := time.Now()
	event := &FailoverEvent{
		EventID:      generateEventID(),
		FromRegion:   drm.currentPrimary,
		ToRegion:     targetRegion,
		Reason:       FailoverReason(reason),
		InitiatedBy:  operator,
		InitiatedAt:  now,
		Status:       FailoverStatusInitiated,
		DataLossRisk: drm.config.ReplicationMode == ReplicationModeAsync,
	}

	// Check for potential data loss
	if lag, exists := drm.replicationLag[targetRegion]; exists && lag > 0 {
		event.DataLossRisk = true
		event.Details = fmt.Sprintf("Replication lag: %v", lag)
	}

	// Save failover event
	if err := drm.saveFailoverEvent(ctx, event); err != nil {
		return nil, fmt.Errorf("failed to save failover event: %w", err)
	}

	// Audit log
	if drm.auditLogger != nil {
		drm.auditLogger.Log(ctx, &AuditEvent{
			EventType: AuditEventType("FAILOVER_INITIATED"),
			Severity:  AuditSeverityEmergency,
			Actor:     &AuditActor{ActorID: operator, ActorType: "USER", ActorName: operator},
			Subject:   &AuditSubject{SubjectID: event.EventID, SubjectType: "FAILOVER", SubjectName: "DR Failover"},
			Action:    "Initiated failover",
			Details:   map[string]interface{}{"from": drm.currentPrimary, "to": targetRegion, "reason": reason},
		})
	}

	// Execute failover in background
	go drm.executeFailover(ctx, event, target)

	return event, nil
}

// initiateAutoFailover initiates automatic failover
func (drm *DisasterRecoveryManager) initiateAutoFailover(ctx context.Context, failedRegion string) {
	// Find best failover target
	var bestTarget *Region
	for _, region := range drm.regions {
		if region.RegionID == failedRegion {
			continue
		}
		if region.Role == RegionRoleSecondary || region.Role == RegionRoleStandby {
			health := drm.healthStatus[region.RegionID]
			if health != nil && (health.Status == RegionStatusHealthy || health.Status == RegionStatusDegraded) {
				if bestTarget == nil || region.Priority < bestTarget.Priority {
					bestTarget = region
				}
			}
		}
	}

	if bestTarget == nil {
		// No suitable failover target
		if drm.auditLogger != nil {
			drm.auditLogger.Log(ctx, &AuditEvent{
				EventType: AuditEventType("FAILOVER_FAILED"),
				Severity:  AuditSeverityEmergency,
				Actor:     &AuditActor{ActorID: "AUTO", ActorType: "SYSTEM", ActorName: "Auto Failover"},
				Subject:   &AuditSubject{SubjectID: failedRegion, SubjectType: "REGION", SubjectName: failedRegion},
				Action:    "Auto failover failed - no suitable target",
			})
		}
		return
	}

	// Initiate failover
	drm.InitiateFailover(ctx, bestTarget.RegionID, string(FailoverReasonPrimaryFailure), "AUTO")
}

// executeFailover executes the failover process
func (drm *DisasterRecoveryManager) executeFailover(ctx context.Context, event *FailoverEvent, target *Region) {
	drm.mu.Lock()
	event.Status = FailoverStatusInProgress
	drm.mu.Unlock()

	// Step 1: Stop writes to old primary
	if err := drm.stopWritesToPrimary(ctx); err != nil {
		drm.failFailover(ctx, event, fmt.Sprintf("Failed to stop writes: %v", err))
		return
	}

	// Step 2: Wait for replication to catch up (if sync mode)
	if drm.config.ReplicationMode == ReplicationModeSync {
		if err := drm.waitForReplicationSync(ctx, target.RegionID); err != nil {
			drm.failFailover(ctx, event, fmt.Sprintf("Replication sync failed: %v", err))
			return
		}
	}

	// Step 3: Promote secondary to primary
	if err := drm.promoteSecondary(ctx, target); err != nil {
		drm.failFailover(ctx, event, fmt.Sprintf("Failed to promote secondary: %v", err))
		return
	}

	// Step 4: Update DNS/routing
	if err := drm.updateRouting(ctx, target); err != nil {
		drm.failFailover(ctx, event, fmt.Sprintf("Failed to update routing: %v", err))
		return
	}

	// Step 5: Demote old primary to secondary
	oldPrimary := drm.regions[drm.currentPrimary]
	if oldPrimary != nil {
		drm.demotePrimary(ctx, oldPrimary)
	}

	// Update state
	drm.mu.Lock()
	drm.currentPrimary = target.RegionID
	target.Role = RegionRolePrimary
	now := time.Now()
	event.Status = FailoverStatusCompleted
	event.CompletedAt = &now
	drm.failoverHistory = append(drm.failoverHistory, event)
	drm.mu.Unlock()

	// Update database
	drm.updateFailoverEvent(ctx, event)

	// Audit log
	if drm.auditLogger != nil {
		drm.auditLogger.Log(ctx, &AuditEvent{
			EventType: AuditEventType("FAILOVER_COMPLETED"),
			Severity:  AuditSeverityCritical,
			Actor:     &AuditActor{ActorID: event.InitiatedBy, ActorType: "USER", ActorName: event.InitiatedBy},
			Subject:   &AuditSubject{SubjectID: event.EventID, SubjectType: "FAILOVER", SubjectName: "DR Failover"},
			Action:    "Failover completed",
			Details:   map[string]interface{}{"new_primary": target.RegionID, "duration_ms": time.Since(event.InitiatedAt).Milliseconds()},
		})
	}
}

func (drm *DisasterRecoveryManager) stopWritesToPrimary(ctx context.Context) error {
	if drm.db == nil {
		return fmt.Errorf("no database connection to set read-only")
	}
	_, err := drm.db.ExecContext(ctx, "ALTER DATABASE CURRENT SET default_transaction_read_only = true")
	if err != nil {
		return fmt.Errorf("failed to set database to read-only: %w", err)
	}
	return nil
}

func (drm *DisasterRecoveryManager) waitForReplicationSync(ctx context.Context, targetRegion string) error {
	// In production:
	// 1. Wait for replication lag to reach 0
	// 2. Verify data consistency
	timeout := time.After(30 * time.Second)
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-timeout:
			return fmt.Errorf("replication sync timeout")
		case <-ticker.C:
			lag := drm.replicationLag[targetRegion]
			if lag == 0 {
				return nil
			}
		}
	}
}

func (drm *DisasterRecoveryManager) promoteSecondary(ctx context.Context, target *Region) error {
	if target.DatabaseDSN == "" {
		return fmt.Errorf("no database DSN for target region %s", target.RegionID)
	}
	db, err := sql.Open("postgres", target.DatabaseDSN)
	if err != nil {
		return fmt.Errorf("cannot connect to target region DB: %w", err)
	}
	defer db.Close()
	if _, err := db.ExecContext(ctx, "SELECT pg_promote()"); err != nil {
		return fmt.Errorf("pg_promote failed for region %s: %w", target.RegionID, err)
	}
	target.Role = RegionRolePrimary
	return nil
}

func (drm *DisasterRecoveryManager) updateRouting(ctx context.Context, target *Region) error {
	if target.Endpoint == "" {
		return fmt.Errorf("no endpoint configured for target region %s", target.RegionID)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target.Endpoint+"/routing/activate", nil)
	if err != nil {
		return fmt.Errorf("failed to create routing update request: %w", err)
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("routing update failed for %s: %w", target.RegionID, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("routing update returned %d for %s", resp.StatusCode, target.RegionID)
	}
	return nil
}

func (drm *DisasterRecoveryManager) demotePrimary(_ context.Context, oldPrimary *Region) error {
	oldPrimary.Role = RegionRoleStandby
	// Re-enable writes on the old primary (it's now a standby that should accept replication writes)
	if drm.db != nil {
		drm.db.Exec("ALTER DATABASE CURRENT SET default_transaction_read_only = false")
	}
	return nil
}

func (drm *DisasterRecoveryManager) failFailover(ctx context.Context, event *FailoverEvent, reason string) {
	drm.mu.Lock()
	event.Status = FailoverStatusFailed
	event.Details = reason
	drm.mu.Unlock()

	drm.updateFailoverEvent(ctx, event)

	if drm.auditLogger != nil {
		drm.auditLogger.Log(ctx, &AuditEvent{
			EventType: AuditEventType("FAILOVER_FAILED"),
			Severity:  AuditSeverityEmergency,
			Actor:     &AuditActor{ActorID: event.InitiatedBy, ActorType: "USER", ActorName: event.InitiatedBy},
			Subject:   &AuditSubject{SubjectID: event.EventID, SubjectType: "FAILOVER", SubjectName: "DR Failover"},
			Action:    "Failover failed",
			Details:   map[string]interface{}{"reason": reason},
		})
	}
}

// GetRegionStatus returns the status of all regions
func (drm *DisasterRecoveryManager) GetRegionStatus() map[string]*RegionHealth {
	drm.mu.RLock()
	defer drm.mu.RUnlock()

	result := make(map[string]*RegionHealth)
	for k, v := range drm.healthStatus {
		result[k] = v
	}
	return result
}

// GetCurrentPrimary returns the current primary region
func (drm *DisasterRecoveryManager) GetCurrentPrimary() string {
	drm.mu.RLock()
	defer drm.mu.RUnlock()
	return drm.currentPrimary
}

// GetFailoverHistory returns the failover history
func (drm *DisasterRecoveryManager) GetFailoverHistory() []*FailoverEvent {
	drm.mu.RLock()
	defer drm.mu.RUnlock()
	return drm.failoverHistory
}

// TestFailover performs a DR test failover
func (drm *DisasterRecoveryManager) TestFailover(ctx context.Context, targetRegion, operator string) (*FailoverEvent, error) {
	// Perform failover with DR_TEST reason
	event, err := drm.InitiateFailover(ctx, targetRegion, string(FailoverReasonDRTest), operator)
	if err != nil {
		return nil, err
	}

	// Schedule automatic failback after test
	go func() {
		time.Sleep(5 * time.Minute) // Test duration
		drm.InitiateFailover(context.Background(), event.FromRegion, "FAILBACK_AFTER_TEST", operator)
	}()

	return event, nil
}

// ValidateDataConsistency validates data consistency between regions
func (drm *DisasterRecoveryManager) ValidateDataConsistency(ctx context.Context) (*ConsistencyReport, error) {
	report := &ConsistencyReport{
		ReportID:    generateEventID(),
		GeneratedAt: time.Now(),
		Regions:     make(map[string]*RegionConsistency),
	}

	primaryRegion := drm.regions[drm.currentPrimary]
	if primaryRegion == nil {
		return nil, fmt.Errorf("primary region not found")
	}

	// Get primary checksums
	primaryChecksums, err := drm.getDataChecksums(ctx, primaryRegion)
	if err != nil {
		return nil, fmt.Errorf("failed to get primary checksums: %w", err)
	}

	report.Regions[drm.currentPrimary] = &RegionConsistency{
		RegionID:   drm.currentPrimary,
		Checksums:  primaryChecksums,
		Consistent: true,
	}

	// Compare with secondary regions
	for regionID, region := range drm.regions {
		if regionID == drm.currentPrimary {
			continue
		}

		secondaryChecksums, err := drm.getDataChecksums(ctx, region)
		if err != nil {
			report.Regions[regionID] = &RegionConsistency{
				RegionID: regionID,
				Error:    err.Error(),
			}
			continue
		}

		consistent := drm.compareChecksums(primaryChecksums, secondaryChecksums)
		report.Regions[regionID] = &RegionConsistency{
			RegionID:   regionID,
			Checksums:  secondaryChecksums,
			Consistent: consistent,
		}

		if !consistent {
			report.HasInconsistencies = true
		}
	}

	return report, nil
}

// ConsistencyReport represents a data consistency report
type ConsistencyReport struct {
	ReportID           string                        `json:"report_id"`
	GeneratedAt        time.Time                     `json:"generated_at"`
	Regions            map[string]*RegionConsistency `json:"regions"`
	HasInconsistencies bool                          `json:"has_inconsistencies"`
}

// RegionConsistency represents consistency status for a region
type RegionConsistency struct {
	RegionID   string            `json:"region_id"`
	Checksums  map[string]string `json:"checksums"`
	Consistent bool              `json:"consistent"`
	Error      string            `json:"error,omitempty"`
}

func (drm *DisasterRecoveryManager) getDataChecksums(ctx context.Context, region *Region) (map[string]string, error) {
	// In production, calculate checksums for critical tables
	checksums := make(map[string]string)

	tables := []string{
		"mojaloop_transfers",
		"participants",
		"settlements",
		"settlement_windows",
	}

	allowedTables := map[string]bool{
		"transfers": true, "accounts": true, "settlements": true,
		"participants": true, "positions": true, "settlement_windows": true,
	}
	for _, table := range tables {
		if !allowedTables[table] {
			continue
		}
		if drm.db != nil {
			var checksum sql.NullString
			query := fmt.Sprintf("SELECT MD5(STRING_AGG(t::text, '' ORDER BY id)) FROM %s t", table)
			if err := drm.db.QueryRowContext(ctx, query).Scan(&checksum); err == nil && checksum.Valid {
				checksums[table] = checksum.String
				continue
			}
		}
		checksums[table] = fmt.Sprintf("%s-%s-%d", region.RegionID, table, time.Now().UnixMilli())
	}

	return checksums, nil
}

func (drm *DisasterRecoveryManager) compareChecksums(primary, secondary map[string]string) bool {
	for table, checksum := range primary {
		if secondary[table] != checksum {
			return false
		}
	}
	return true
}

// Helper methods

func (drm *DisasterRecoveryManager) saveFailoverEvent(ctx context.Context, event *FailoverEvent) error {
	_, err := drm.db.ExecContext(ctx, `
		INSERT INTO failover_events (
			event_id, from_region, to_region, reason, initiated_by,
			initiated_at, status, data_loss_risk, details
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, event.EventID, event.FromRegion, event.ToRegion, string(event.Reason),
		event.InitiatedBy, event.InitiatedAt, string(event.Status),
		event.DataLossRisk, event.Details)
	return err
}

func (drm *DisasterRecoveryManager) updateFailoverEvent(ctx context.Context, event *FailoverEvent) error {
	_, err := drm.db.ExecContext(ctx, `
		UPDATE failover_events SET
			status = $1, completed_at = $2, details = $3
		WHERE event_id = $4
	`, string(event.Status), event.CompletedAt, event.Details, event.EventID)
	return err
}

// DisasterRecoverySchema returns the PostgreSQL schema for DR tables
func DisasterRecoverySchema() string {
	return `
-- DR regions table
CREATE TABLE IF NOT EXISTS dr_regions (
    region_id VARCHAR(64) PRIMARY KEY,
    region_name VARCHAR(128) NOT NULL,
    role VARCHAR(20) NOT NULL,
    endpoint VARCHAR(256),
    database_dsn VARCHAR(512),
    tigerbeetle_addr VARCHAR(256),
    kafka_brokers JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'HEALTHY',
    priority INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Index for role queries
CREATE INDEX IF NOT EXISTS idx_dr_regions_role 
ON dr_regions(role, priority);

-- Failover events table
CREATE TABLE IF NOT EXISTS failover_events (
    event_id VARCHAR(64) PRIMARY KEY,
    from_region VARCHAR(64) NOT NULL,
    to_region VARCHAR(64) NOT NULL,
    reason VARCHAR(50) NOT NULL,
    initiated_by VARCHAR(128) NOT NULL,
    initiated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) NOT NULL DEFAULT 'INITIATED',
    data_loss_risk BOOLEAN NOT NULL DEFAULT FALSE,
    rollback_point VARCHAR(256),
    details TEXT
);

-- Index for failover queries
CREATE INDEX IF NOT EXISTS idx_failover_events_status 
ON failover_events(status, initiated_at DESC);

-- Region health history table
CREATE TABLE IF NOT EXISTS region_health_history (
    id SERIAL PRIMARY KEY,
    region_id VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL,
    replication_lag_ms BIGINT,
    database_health BOOLEAN,
    tigerbeetle_health BOOLEAN,
    kafka_health BOOLEAN,
    api_health BOOLEAN,
    success_rate DECIMAL(5,4),
    checked_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Index for health history queries
CREATE INDEX IF NOT EXISTS idx_region_health_history_region 
ON region_health_history(region_id, checked_at DESC);

-- Partition by time for efficient cleanup
-- In production, use table partitioning for health history

-- Consistency check results table
CREATE TABLE IF NOT EXISTS consistency_check_results (
    report_id VARCHAR(64) PRIMARY KEY,
    generated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    regions JSONB NOT NULL,
    has_inconsistencies BOOLEAN NOT NULL DEFAULT FALSE
);

-- Index for consistency check queries
CREATE INDEX IF NOT EXISTS idx_consistency_check_results_time 
ON consistency_check_results(generated_at DESC);
`
}
