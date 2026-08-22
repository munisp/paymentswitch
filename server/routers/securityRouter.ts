import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../_core/trpc';
import {
  getDaprLiveStatus,
  getOpenAppSecLiveStatus,
  getOpenSearchLiveStatus,
  getPermifyLiveStatus,
  getPostgresLiveStatus,
  getRedisLiveStatus,
  getTemporalLiveStatus,
  type InfrastructureStatus,
} from '../lib/infraClient';

function requireOperationsRole(role: string): void {
  if (role !== 'admin' && role !== 'cbn') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Operations security access is required.' });
  }
}

function unavailable(service: string, capability: string): never {
  throw new TRPCError({
    code: 'SERVICE_UNAVAILABLE',
    message: `${service} does not expose an authorized live ${capability} endpoint in this deployment. No inferred security value is returned.`,
  });
}

async function securityDependencies(): Promise<InfrastructureStatus[]> {
  return Promise.all([
    getOpenAppSecLiveStatus(),
    getPermifyLiveStatus(),
    getPostgresLiveStatus(),
    getRedisLiveStatus(),
    getDaprLiveStatus(),
    getTemporalLiveStatus(),
    getOpenSearchLiveStatus(),
  ]);
}

/**
 * Security status is evidence-only. The router intentionally does not derive a
 * compliance score, attack count, backup state, or policy decision from absent
 * monitoring data: each such value must originate from a configured system.
 */
export const securityRouter = router({
  ddosStatus: protectedProcedure.query(async ({ ctx }) => {
    requireOperationsRole(ctx.user.role);
    const openAppSec = await getOpenAppSecLiveStatus();
    return {
      source: 'openappsec',
      checkedAt: openAppSec.checkedAt,
      status: openAppSec.status,
      details: openAppSec.details,
      error: openAppSec.error ?? null,
      metrics: null,
      note: 'Request, mitigation, blacklist, and attack metrics require an authenticated OpenAppSec telemetry integration and are not inferred from a health probe.',
    };
  }),

  ransomwareStatus: protectedProcedure.query(async ({ ctx }) => {
    requireOperationsRole(ctx.user.role);
    const postgres = await getPostgresLiveStatus();
    return {
      source: 'postgresql-health',
      checkedAt: postgres.checkedAt,
      status: postgres.status,
      details: postgres.details,
      error: postgres.error ?? null,
      backupEvidence: null,
      note: 'Backup, immutable-storage, canary, and ransomware telemetry require a configured backup/security provider. This deployment reports no fabricated backup posture.',
    };
  }),

  pbacStatus: protectedProcedure.query(async ({ ctx }) => {
    requireOperationsRole(ctx.user.role);
    const permify = await getPermifyLiveStatus();
    return {
      source: 'permify',
      checkedAt: permify.checkedAt,
      status: permify.status,
      details: permify.details,
      error: permify.error ?? null,
      evaluations: null,
      note: 'The configured health endpoint proves reachability only; it cannot prove policy counts, allow/deny decisions, or evaluation latency.',
    };
  }),

  vulnerabilityScore: protectedProcedure.query(async ({ ctx }) => {
    requireOperationsRole(ctx.user.role);
    const dependencies = await securityDependencies();
    return {
      score: null,
      grade: null,
      source: 'live-dependency-probes',
      checkedAt: new Date().toISOString(),
      dependencies,
      note: 'No vulnerability score is reported without an authenticated scanner result. Dependency health is not a substitute for a vulnerability assessment.',
    };
  }),

  getSecurityScore: protectedProcedure.query(async ({ ctx }) => {
    requireOperationsRole(ctx.user.role);
    const dependencies = await securityDependencies();
    return {
      score: null,
      grade: null,
      source: 'live-dependency-probes',
      checkedAt: new Date().toISOString(),
      dependencies,
      note: 'No calculated security score is available because no scanner result has been configured.',
    };
  }),

  resilienceStatus: protectedProcedure.query(async ({ ctx }) => {
    requireOperationsRole(ctx.user.role);
    const dependencies = await securityDependencies();
    return {
      source: 'live-dependency-probes',
      checkedAt: new Date().toISOString(),
      dependencies,
      note: 'Connection quality, queue depth, bandwidth, and offline synchronization telemetry are unavailable until their respective live collectors are configured.',
    };
  }),

  listEvents: protectedProcedure.query(async ({ ctx }) => {
    requireOperationsRole(ctx.user.role);
    const openSearch = await getOpenSearchLiveStatus();
    if (openSearch.status !== 'healthy') unavailable('OpenSearch', 'security-event');
    unavailable('OpenSearch', 'security-event query');
  }),

  listPolicies: protectedProcedure.query(async ({ ctx }) => {
    requireOperationsRole(ctx.user.role);
    const permify = await getPermifyLiveStatus();
    if (permify.status !== 'healthy') unavailable('Permify', 'policy');
    unavailable('Permify', 'policy-list');
  }),

  createPolicy: protectedProcedure.mutation(async ({ ctx }) => {
    requireOperationsRole(ctx.user.role);
    unavailable('Permify', 'policy-management');
  }),

  togglePolicy: protectedProcedure.mutation(async ({ ctx }) => {
    requireOperationsRole(ctx.user.role);
    unavailable('Permify', 'policy-management');
  }),
});
