import { publicProcedure, router } from '../_core/trpc';
import {
  getApisixLiveStatus,
  getDaprLiveStatus,
  getFluvioLiveStatus,
  getKafkaLiveStatus,
  getKeycloakLiveStatus,
  getMojaloopLiveStatus,
  getObservabilityLiveStatus,
  getOpenAppSecLiveStatus,
  getOpenSearchLiveStatus,
  getPermifyLiveStatus,
  getPostgresLiveStatus,
  getRedisLiveStatus,
  getTemporalLiveStatus,
  getTigerBeetleLiveStatus,
  type InfrastructureStatus,
} from '../lib/infraClient';

const probes = {
  kafka: getKafkaLiveStatus,
  redis: getRedisLiveStatus,
  postgresql: getPostgresLiveStatus,
  tigerbeetle: getTigerBeetleLiveStatus,
  temporal: getTemporalLiveStatus,
  apisix: getApisixLiveStatus,
  keycloak: getKeycloakLiveStatus,
  dapr: getDaprLiveStatus,
  opensearch: getOpenSearchLiveStatus,
  observability: getObservabilityLiveStatus,
  mojaloop: getMojaloopLiveStatus,
  fluvio: getFluvioLiveStatus,
  permify: getPermifyLiveStatus,
  openappsec: getOpenAppSecLiveStatus,
} as const;

function summarize(statuses: InfrastructureStatus[]) {
  const healthy = statuses.filter(status => status.status === 'healthy').length;
  const unavailable = statuses.filter(status => status.status === 'unavailable').length;
  const misconfigured = statuses.filter(status => status.status === 'misconfigured').length;

  return {
    overall: unavailable === 0 && misconfigured === 0 ? 'healthy' : healthy === 0 ? 'unavailable' : 'degraded',
    checkedAt: new Date().toISOString(),
    summary: {
      total: statuses.length,
      healthy,
      unavailable,
      misconfigured,
    },
    services: statuses,
  };
}

export const middlewareRouter = router({
  kafkaStatus: publicProcedure.query(() => probes.kafka()),
  redisStatus: publicProcedure.query(() => probes.redis()),
  postgresqlStatus: publicProcedure.query(() => probes.postgresql()),
  tigerbeetleStatus: publicProcedure.query(() => probes.tigerbeetle()),
  temporalStatus: publicProcedure.query(() => probes.temporal()),
  apisixStatus: publicProcedure.query(() => probes.apisix()),
  keycloakStatus: publicProcedure.query(() => probes.keycloak()),
  daprStatus: publicProcedure.query(() => probes.dapr()),
  opensearchStatus: publicProcedure.query(() => probes.opensearch()),
  observabilityStatus: publicProcedure.query(() => probes.observability()),
  mojaloopStatus: publicProcedure.query(() => probes.mojaloop()),
  fluvioStatus: publicProcedure.query(() => probes.fluvio()),
  permifyStatus: publicProcedure.query(() => probes.permify()),
  openappsecStatus: publicProcedure.query(() => probes.openappsec()),

  health: publicProcedure.query(async () => {
    const results = await Promise.allSettled(Object.values(probes).map(probe => probe()));
    const statuses = results.map((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      const service = Object.keys(probes)[index] ?? 'unknown';
      return {
        service,
        status: 'unavailable' as const,
        checkedAt: new Date().toISOString(),
        details: {},
        error: result.reason instanceof Error ? result.reason.message : 'Probe failed unexpectedly',
      };
    });
    return summarize(statuses);
  }),
});
