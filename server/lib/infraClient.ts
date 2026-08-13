import { createChildLogger } from './logger';

const log = createChildLogger('infra-client');

const TIMEOUT_MS = Number.parseInt(process.env.INFRA_TIMEOUT_MS ?? '3000', 10);
const MAX_RETRIES = Number.parseInt(process.env.INFRA_MAX_RETRIES ?? '2', 10);
const RETRY_BASE_MS = 200;

export type InfrastructureStatus = {
  service: string;
  status: 'healthy' | 'unavailable' | 'misconfigured';
  checkedAt: string;
  details: Record<string, unknown>;
  error?: string;
};

type FetchOpts = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  retries?: number;
};

type ProbeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function configured(value: string | undefined, name: string): ProbeResult<never> | null {
  if (value && value.trim().length > 0) return null;
  return { ok: false, error: `${name} is not configured` };
}

async function infraFetch<T>(url: string, opts: FetchOpts = {}): Promise<ProbeResult<T>> {
  const retries = opts.retries ?? MAX_RETRIES;
  let lastError = 'Service did not return a successful response';

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: { 'Content-Type': 'application/json', ...opts.headers },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (response.ok) {
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) {
          return { ok: true, data: (await response.text()) as T };
        }
        return { ok: true, data: await response.json() as T };
      }

      lastError = `HTTP ${response.status} ${response.statusText}`;
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, RETRY_BASE_MS * 2 ** attempt));
        continue;
      }
      break;
    } catch (error) {
      clearTimeout(timer);
      lastError = error instanceof Error ? error.message : 'Request failed';
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, RETRY_BASE_MS * 2 ** attempt));
      }
    }
  }

  return { ok: false, error: lastError };
}

function statusFromProbe<T>(
  service: string,
  result: ProbeResult<T>,
  details: Record<string, unknown> = {},
): InfrastructureStatus {
  const checkedAt = new Date().toISOString();
  if (!result.ok) {
    return {
      service,
      status: result.error.includes('not configured') ? 'misconfigured' : 'unavailable',
      checkedAt,
      details,
      error: result.error,
    };
  }

  return { service, status: 'healthy', checkedAt, details };
}

async function probeJson<T>(
  service: string,
  url: string | undefined,
  requiredVariable: string,
  detailsFrom: (data: T) => Record<string, unknown> = () => ({}),
  opts: FetchOpts = {},
): Promise<InfrastructureStatus> {
  const configurationError = configured(url, requiredVariable);
  if (configurationError) return statusFromProbe(service, configurationError);

  const result = await infraFetch<T>(url!, opts);
  return result.ok
    ? statusFromProbe(service, result, detailsFrom(result.data))
    : statusFromProbe(service, result);
}

const KAFKA_REST_URL = process.env.KAFKA_REST_URL;
const SCHEMA_REGISTRY_URL = process.env.SCHEMA_REGISTRY_URL;
const REDIS_EXPORTER_URL = process.env.REDIS_EXPORTER_URL;
const PATRONI_URL = process.env.PATRONI_URL;
const PGBOUNCER_URL = process.env.PGBOUNCER_EXPORTER_URL;
const TIGERBEETLE_HTTP_URL = process.env.TIGERBEETLE_HTTP_URL;
const KEYCLOAK_URL = process.env.KEYCLOAK_URL;
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM;
const APISIX_ADMIN_URL = process.env.APISIX_ADMIN_URL;
const APISIX_ADMIN_KEY = process.env.APISIX_ADMIN_KEY;
const PERMIFY_URL = process.env.PERMIFY_URL;
const DAPR_HTTP_PORT = process.env.DAPR_HTTP_PORT;
const OPENSEARCH_URL = process.env.OPENSEARCH_URL;
const FLUVIO_URL = process.env.FLUVIO_URL;
const OPENAPPSEC_URL = process.env.OPENAPPSEC_URL;
const MOJALOOP_URL = process.env.MOJALOOP_URL;
const TEMPORAL_HEALTH_URL = process.env.TEMPORAL_HEALTH_URL;
const PROMETHEUS_URL = process.env.PROMETHEUS_URL;

export async function getKafkaLiveStatus(): Promise<InfrastructureStatus> {
  if (!KAFKA_REST_URL || !SCHEMA_REGISTRY_URL) {
    return statusFromProbe('Kafka', { ok: false, error: 'KAFKA_REST_URL and SCHEMA_REGISTRY_URL are required' });
  }

  const [brokers, subjects] = await Promise.all([
    infraFetch<{ brokers?: unknown[] }>(`${KAFKA_REST_URL.replace(/\/$/, '')}/brokers`),
    infraFetch<string[]>(`${SCHEMA_REGISTRY_URL.replace(/\/$/, '')}/subjects`),
  ]);

  if (!brokers.ok || !subjects.ok) {
    return statusFromProbe('Kafka', {
      ok: false,
      error: [brokers, subjects].filter((probe): probe is { ok: false; error: string } => !probe.ok).map(probe => probe.error).join('; '),
    });
  }

  return statusFromProbe('Kafka', { ok: true, data: null }, {
    brokersOnline: brokers.data.brokers?.length ?? 0,
    schemaSubjects: subjects.data.length,
  });
}

export async function getRedisLiveStatus(): Promise<InfrastructureStatus> {
  return probeJson<string>('Redis', REDIS_EXPORTER_URL ? `${REDIS_EXPORTER_URL.replace(/\/$/, '')}/metrics` : undefined, 'REDIS_EXPORTER_URL', () => ({ exporter: 'reachable' }));
}

export async function getPostgresLiveStatus(): Promise<InfrastructureStatus> {
  if (!PATRONI_URL && !PGBOUNCER_URL) {
    return statusFromProbe('PostgreSQL', { ok: false, error: 'PATRONI_URL or PGBOUNCER_EXPORTER_URL is required' });
  }

  const probes = await Promise.all([
    PATRONI_URL ? infraFetch<unknown>(`${PATRONI_URL.replace(/\/$/, '')}/cluster`) : null,
    PGBOUNCER_URL ? infraFetch<string>(`${PGBOUNCER_URL.replace(/\/$/, '')}/metrics`) : null,
  ]);
  const successes = probes.filter((probe): probe is { ok: true; data: unknown } => probe !== null && probe.ok === true);
  if (successes.length === 0) {
    return statusFromProbe('PostgreSQL', { ok: false, error: probes.filter((probe): probe is { ok: false; error: string } => probe !== null && !probe.ok).map(probe => probe.error).join('; ') || 'No PostgreSQL health endpoint responded' });
  }
  return statusFromProbe('PostgreSQL', { ok: true, data: null }, {
    patroni: Boolean(probes[0]?.ok),
    pgbouncer: Boolean(probes[1]?.ok),
  });
}

export async function getTigerBeetleLiveStatus(): Promise<InfrastructureStatus> {
  return probeJson<unknown>('TigerBeetle', TIGERBEETLE_HTTP_URL ? `${TIGERBEETLE_HTTP_URL.replace(/\/$/, '')}/status` : undefined, 'TIGERBEETLE_HTTP_URL', () => ({ gateway: 'reachable' }));
}

export async function getKeycloakLiveStatus(): Promise<InfrastructureStatus> {
  if (!KEYCLOAK_URL || !KEYCLOAK_REALM) {
    return statusFromProbe('Keycloak', { ok: false, error: 'KEYCLOAK_URL and KEYCLOAK_REALM are required' });
  }

  const baseUrl = KEYCLOAK_URL.replace(/\/$/, '');
  const [health, discovery] = await Promise.all([
    infraFetch<{ status?: string }>(`${baseUrl}/health/ready`),
    infraFetch<{ issuer?: string }>(`${baseUrl}/realms/${encodeURIComponent(KEYCLOAK_REALM)}/.well-known/openid-configuration`),
  ]);
  if (!health.ok || !discovery.ok || health.data.status !== 'UP' || !discovery.data.issuer) {
    const errors = [
      !health.ok ? health.error : health.data.status !== 'UP' ? 'Keycloak health endpoint is not UP' : '',
      !discovery.ok ? discovery.error : !discovery.data.issuer ? 'OIDC discovery document has no issuer' : '',
    ].filter(Boolean);
    return statusFromProbe('Keycloak', { ok: false, error: errors.join('; ') });
  }
  return statusFromProbe('Keycloak', { ok: true, data: null }, { realm: KEYCLOAK_REALM, issuer: discovery.data.issuer });
}

export async function getApisixLiveStatus(): Promise<InfrastructureStatus> {
  if (!APISIX_ADMIN_URL || !APISIX_ADMIN_KEY) {
    return statusFromProbe('APISIX', { ok: false, error: 'APISIX_ADMIN_URL and APISIX_ADMIN_KEY are required' });
  }
  const result = await infraFetch<{ list?: unknown[]; total?: number }>(`${APISIX_ADMIN_URL.replace(/\/$/, '')}/apisix/admin/routes`, { headers: { 'X-API-KEY': APISIX_ADMIN_KEY } });
  return result.ok
    ? statusFromProbe('APISIX', result, { routeCount: result.data.list?.length ?? result.data.total ?? 0 })
    : statusFromProbe('APISIX', result);
}

export async function getPermifyLiveStatus(): Promise<InfrastructureStatus> {
  return probeJson<unknown>('Permify', PERMIFY_URL ? `${PERMIFY_URL.replace(/\/$/, '')}/healthz` : undefined, 'PERMIFY_URL', () => ({ healthEndpoint: 'reachable' }));
}

export async function getDaprLiveStatus(): Promise<InfrastructureStatus> {
  if (!DAPR_HTTP_PORT) return statusFromProbe('Dapr', { ok: false, error: 'DAPR_HTTP_PORT is required' });
  const result = await infraFetch<{ id?: string; components?: unknown[]; subscriptions?: unknown[] }>(`http://127.0.0.1:${DAPR_HTTP_PORT}/v1.0/metadata`);
  return result.ok
    ? statusFromProbe('Dapr', result, { appId: result.data.id ?? null, activeComponents: result.data.components?.length ?? 0, subscriptions: result.data.subscriptions?.length ?? 0 })
    : statusFromProbe('Dapr', result);
}

export async function getOpenSearchLiveStatus(): Promise<InfrastructureStatus> {
  return probeJson<{ cluster_name?: string; status?: string; number_of_nodes?: number }>('OpenSearch', OPENSEARCH_URL ? `${OPENSEARCH_URL.replace(/\/$/, '')}/_cluster/health` : undefined, 'OPENSEARCH_URL', data => ({ clusterName: data.cluster_name ?? null, clusterStatus: data.status ?? null, nodeCount: data.number_of_nodes ?? 0 }));
}

export async function getFluvioLiveStatus(): Promise<InfrastructureStatus> {
  return probeJson<unknown>('Fluvio', FLUVIO_URL ? `${FLUVIO_URL.replace(/\/$/, '')}/api/v1/status` : undefined, 'FLUVIO_URL', () => ({ controlPlane: 'reachable' }));
}

export async function getOpenAppSecLiveStatus(): Promise<InfrastructureStatus> {
  return probeJson<unknown>('OpenAppSec', OPENAPPSEC_URL ? `${OPENAPPSEC_URL.replace(/\/$/, '')}/api/v1/status` : undefined, 'OPENAPPSEC_URL', () => ({ managementApi: 'reachable' }));
}

export async function getMojaloopLiveStatus(): Promise<InfrastructureStatus> {
  return probeJson<unknown>('Mojaloop', MOJALOOP_URL ? `${MOJALOOP_URL.replace(/\/$/, '')}/health` : undefined, 'MOJALOOP_URL', () => ({ healthEndpoint: 'reachable' }));
}

export async function getTemporalLiveStatus(): Promise<InfrastructureStatus> {
  return probeJson<unknown>('Temporal', TEMPORAL_HEALTH_URL, 'TEMPORAL_HEALTH_URL', () => ({ healthEndpoint: 'reachable' }));
}

export async function getObservabilityLiveStatus(): Promise<InfrastructureStatus> {
  return probeJson<string>('Observability', PROMETHEUS_URL ? `${PROMETHEUS_URL.replace(/\/$/, '')}/-/ready` : undefined, 'PROMETHEUS_URL', () => ({ prometheus: 'reachable' }));
}

export function logInfrastructureError(service: string, error: unknown): void {
  log.warn({ service, err: error }, 'Infrastructure probe failed');
}
