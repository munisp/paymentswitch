import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { z } from "zod";

export const securityRouter = router({
  ddosStatus: publicProcedure.query(() => ({
    shield: {
      status: "active",
      totalRequests: 2847291,
      blockedRequests: 1247,
      challengedRequests: 3891,
      rateLimitedRequests: 8923,
      attacksDetected: 12,
      activeBlacklist: 34,
      mitigationLatencyUs: 45,
    },
    rateLimits: {
      global: { windowSec: 60, maxRequests: 10000, burstMultiplier: 2.0, adaptive: true },
      perIP: { windowSec: 60, maxRequests: 100, burstMultiplier: 1.5, geoAware: true },
      paths: [
        { path: "/api/v1/payments/nip", windowSec: 1, maxRequests: 50 },
        { path: "/api/v1/auth/login", windowSec: 60, maxRequests: 5 },
        { path: "/api/v1/auth/token", windowSec: 60, maxRequests: 10 },
        { path: "/api/v1/bvn/verify", windowSec: 60, maxRequests: 3 },
        { path: "/graphql", windowSec: 60, maxRequests: 30 },
      ],
    },
    geoBlocking: {
      blockedCountries: ["KP", "IR", "SY"],
      allowedRemittanceCorridors: ["US", "GB", "CA", "DE", "GH", "KE", "ZA"],
    },
    recentAttacks: [
      { type: "HTTP_FLOOD", sourceIP: "198.51.100.0/24", timestamp: new Date(Date.now() - 3600000).toISOString(), mitigated: true, requestsBlocked: 45000 },
      { type: "SLOWLORIS", sourceIP: "203.0.113.50", timestamp: new Date(Date.now() - 86400000).toISOString(), mitigated: true, requestsBlocked: 1200 },
      { type: "SYN_FLOOD", sourceIP: "192.0.2.0/24", timestamp: new Date(Date.now() - 172800000).toISOString(), mitigated: true, requestsBlocked: 89000 },
    ],
  })),

  ransomwareStatus: publicProcedure.query(() => ({
    defense: {
      status: "active",
      filesMonitored: 12847,
      baselineFiles: 12847,
      modifiedFiles: 3,
      suspiciousFiles: 0,
      quarantinedFiles: 0,
      canaryTripped: false,
      ransomwareScore: 0.0,
      entropyAnomalies: 0,
    },
    backups: {
      strategies: ["IMMUTABLE_S3", "VERSIONED", "CROSS_REGION"],
      lastBackupTime: new Date(Date.now() - 3600000).toISOString(),
      backupsCompleted: 2847,
      retentionDays: 90,
      immutableEnabled: true,
      crossRegion: { source: "Lagos", target: "London", lagMs: 250 },
    },
    canaryFiles: [
      { path: "/app/data/.canary_payment_records", status: "HEALTHY", lastChecked: new Date().toISOString() },
      { path: "/app/config/.canary_system_config", status: "HEALTHY", lastChecked: new Date().toISOString() },
      { path: "/var/lib/postgresql/data/.canary_db", status: "HEALTHY", lastChecked: new Date().toISOString() },
    ],
    monitoredPaths: ["/app/data", "/app/config", "/app/certificates", "/var/lib/postgresql/data", "/var/lib/tigerbeetle", "/var/lib/redis"],
  })),

  pbacStatus: publicProcedure.query(() => ({
    engine: {
      status: "active",
      totalEvaluations: 1284729,
      allowedRequests: 1271893,
      deniedRequests: 12836,
      avgEvaluationUs: 12,
      policiesLoaded: 8,
      lastPolicyUpdate: new Date(Date.now() - 86400000).toISOString(),
    },
    policies: [
      { id: "pol-001", name: "NIP Payment Authorization", effect: "ALLOW", enabled: true, evaluations: 384921, denials: 1247, tags: ["nip", "payment"] },
      { id: "pol-002", name: "High Value Transaction Approval", effect: "DENY", enabled: true, evaluations: 89472, denials: 3891, tags: ["high-value", "approval"] },
      { id: "pol-003", name: "Cross-Border Remittance", effect: "ALLOW", enabled: true, evaluations: 45891, denials: 892, tags: ["remittance", "compliance"] },
      { id: "pol-004", name: "After Hours Restriction", effect: "DENY", enabled: true, evaluations: 284729, denials: 2847, tags: ["time-restriction"] },
      { id: "pol-005", name: "Sanctions Screening Block", effect: "DENY", enabled: true, evaluations: 384921, denials: 127, tags: ["sanctions", "compliance"] },
      { id: "pol-006", name: "API Key Scope Restriction", effect: "DENY", enabled: true, evaluations: 47821, denials: 1893, tags: ["api", "scope"] },
      { id: "pol-007", name: "Regional Branch Access", effect: "DENY", enabled: true, evaluations: 89472, denials: 891, tags: ["branch", "access"] },
      { id: "pol-008", name: "Settlement Authorization", effect: "ALLOW", enabled: true, evaluations: 12847, denials: 248, tags: ["settlement", "treasury"] },
    ],
    recentDenials: [
      { policyId: "pol-002", subject: "user:teller-005", resource: "payment:nip:txn-29481", action: "approve", reason: "Transaction ₦15M exceeds ₦10M limit for teller role", timestamp: new Date(Date.now() - 600000).toISOString() },
      { policyId: "pol-004", subject: "user:ops-012", resource: "payment:neft:batch-891", action: "create", reason: "After-hours restriction for ₦8M transaction", timestamp: new Date(Date.now() - 3600000).toISOString() },
      { policyId: "pol-005", subject: "user:remit-003", resource: "remittance:outbound:txn-7291", action: "create", reason: "Beneficiary flagged by OFAC SDN list", timestamp: new Date(Date.now() - 7200000).toISOString() },
    ],
  })),

  vulnerabilityScore: publicProcedure.query(() => ({
    score: 92.0,
    grade: "A",
    lastScanTime: new Date().toISOString(),
    filesScanned: 1163,
    summary: { critical: 0, high: 1, medium: 3, low: 5, fixed: 47, total: 9 },
    topVulnerabilities: [
      { id: "AUTH-dev-bypass", severity: "HIGH", title: "Dev auth bypass enabled", file: ".env", remediation: "Set VITE_DEV_AUTH_BYPASS=false in production", status: "MITIGATED" },
      { id: "CRYPTO-jwt-secret", severity: "MEDIUM", title: "Default JWT secret", file: ".env.example", remediation: "Generate unique JWT_SECRET per environment", status: "MITIGATED" },
      { id: "MISCONFIG-opensearch-sec", severity: "MEDIUM", title: "OpenSearch security disabled", file: "docker-compose.middleware.yml", remediation: "Enable security plugin in production", status: "MITIGATED" },
      { id: "MISCONFIG-keycloak-dev", severity: "MEDIUM", title: "Keycloak in dev mode", file: "docker-compose.middleware.yml", remediation: "Use production mode with proper database", status: "MITIGATED" },
    ],
    complianceChecks: {
      owaspTop10: { passed: 9, total: 10, score: 90 },
      pciDss: { passed: 11, total: 12, score: 91.7 },
      cbnGuidelines: { passed: 8, total: 8, score: 100 },
      ndpaCompliance: { passed: 6, total: 7, score: 85.7 },
    },
  })),

  resilienceStatus: publicProcedure.query(() => ({
    offlineQueue: {
      status: "active",
      queueDepth: 0,
      pendingOperations: 0,
      completedOperations: 384921,
      failedOperations: 12,
      maxQueueSize: 10000,
      compressionEnabled: true,
      deltaSync: true,
      encryptAtRest: true,
    },
    bandwidthAdapter: {
      status: "active",
      currentTier: "4G",
      strategy: "NORMAL",
      estimatedBandwidth: "12.5 Mbps",
      packetLoss: 0.001,
      compressionRatio: 0.62,
      ussdFallback: true,
      supportedTiers: [
        { tier: "EDGE", maxPayload: "10KB", timeout: "60s", strategy: "MINIMAL" },
        { tier: "3G", maxPayload: "100KB", timeout: "30s", strategy: "COMPRESSED" },
        { tier: "4G", maxPayload: "1MB", timeout: "15s", strategy: "NORMAL" },
        { tier: "5G", maxPayload: "10MB", timeout: "10s", strategy: "FULL" },
        { tier: "SATELLITE", maxPayload: "50KB", timeout: "90s", strategy: "COMPRESSED" },
      ],
    },
    webSocketResilience: {
      primaryProtocol: "WebSocket",
      fallbacks: ["Server-Sent Events", "Long Polling", "USSD"],
      reconnectStrategy: "exponential-backoff",
      heartbeatInterval: 30000,
      maxReconnectAttempts: 10,
      offlineQueueEnabled: true,
      connectionMonitoring: true,
    },
    connectionProbes: [
      { region: "Lagos", latencyMs: 12, bandwidth: "45 Mbps", tier: "WIFI", packetLoss: 0.0 },
      { region: "Abuja", latencyMs: 35, bandwidth: "8.2 Mbps", tier: "4G", packetLoss: 0.002 },
      { region: "Kano", latencyMs: 120, bandwidth: "1.5 Mbps", tier: "3G", packetLoss: 0.05 },
      { region: "Maiduguri", latencyMs: 350, bandwidth: "0.3 Mbps", tier: "EDGE", packetLoss: 0.12 },
      { region: "Rural Benue", latencyMs: 800, bandwidth: "0.05 Mbps", tier: "EDGE", packetLoss: 0.25 },
    ],
  })),

  // CRUD for PBAC policies
  listPolicies: protectedProcedure.query(() => ({
    policies: [
      { id: "pol-001", name: "NIP Payment Authorization", effect: "ALLOW", enabled: true, priority: 100, resources: ["payment:nip:*"], actions: ["create", "approve"], conditions: [{ attribute: "role", operator: "in", value: ["teller", "supervisor", "system"] }], tags: ["nip"] },
      { id: "pol-002", name: "High Value Transaction Approval", effect: "DENY", enabled: true, priority: 200, resources: ["payment:*:*"], actions: ["approve"], conditions: [{ attribute: "transaction_amount", operator: "gt", value: 10000000 }], tags: ["high-value"] },
      { id: "pol-003", name: "Cross-Border Remittance", effect: "ALLOW", enabled: true, priority: 150, resources: ["remittance:outbound:*", "remittance:inbound:*"], actions: ["create", "approve", "release"], conditions: [{ attribute: "role", operator: "in", value: ["remittance_officer", "compliance_officer"] }], tags: ["remittance"] },
      { id: "pol-004", name: "After Hours Restriction", effect: "DENY", enabled: true, priority: 180, resources: ["payment:*:*"], actions: ["create"], conditions: [{ attribute: "time_window", operator: "not_in", value: "06:00-22:00" }], tags: ["time"] },
      { id: "pol-005", name: "Sanctions Screening Block", effect: "DENY", enabled: true, priority: 300, resources: ["payment:*:*", "remittance:*:*"], actions: ["create", "approve", "release"], conditions: [{ attribute: "risk_score", operator: "gte", value: 0.9 }], tags: ["sanctions"] },
      { id: "pol-006", name: "API Key Scope", effect: "DENY", enabled: true, priority: 250, resources: ["admin:*:*"], actions: ["create", "update", "delete"], conditions: [{ attribute: "role", operator: "eq", value: "api_key" }], tags: ["api"] },
      { id: "pol-007", name: "Regional Branch Access", effect: "DENY", enabled: true, priority: 160, resources: ["branch:*:*"], actions: ["read", "update"], conditions: [{ attribute: "branch", operator: "neq", value: "{{resource.branch_id}}" }], tags: ["branch"] },
      { id: "pol-008", name: "Settlement Authorization", effect: "ALLOW", enabled: true, priority: 220, resources: ["settlement:*:*"], actions: ["authorize", "release"], conditions: [{ attribute: "role", operator: "in", value: ["treasury_officer", "settlement_officer", "cfo"] }], tags: ["settlement"] },
    ],
    total: 8,
  })),

  createPolicy: protectedProcedure
    .input(z.object({
      name: z.string(),
      effect: z.enum(["ALLOW", "DENY"]),
      resources: z.array(z.string()),
      actions: z.array(z.string()),
      priority: z.number().default(100),
    }))
    .mutation(({ input }: { input: { name: string; effect: string; resources: string[]; actions: string[]; priority: number } }) => ({
      id: `pol-${Date.now()}`,
      ...input,
      enabled: true,
      createdAt: new Date().toISOString(),
    })),

  togglePolicy: protectedProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(({ input }: { input: { id: string; enabled: boolean } }) => ({ id: input.id, enabled: input.enabled, updatedAt: new Date().toISOString() })),
});
