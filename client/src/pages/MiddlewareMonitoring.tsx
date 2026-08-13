import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { AlertTriangle, CheckCircle2, Clock3, Server, Settings2, XCircle } from 'lucide-react';
import ModuleLayout from '@/components/ModuleLayout';
import type { ModuleConfig, NavItem } from '@/components/ModuleLayout';
import PageHeader from '@/components/PageHeader';

const MW_MODULE: ModuleConfig = {
  title: 'Middleware',
  subtitle: 'Live integration status',
  icon: Server,
  accentColor: 'text-blue-600',
  accentBg: 'bg-blue-600',
  accentHover: 'hover:bg-blue-700',
};

const MW_NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: Server },
  { id: 'kafka', label: 'Kafka', icon: Server },
  { id: 'redis', label: 'Redis', icon: Server },
  { id: 'postgresql', label: 'PostgreSQL', icon: Server },
  { id: 'tigerbeetle', label: 'TigerBeetle', icon: Server },
  { id: 'temporal', label: 'Temporal', icon: Server },
  { id: 'apisix', label: 'APISIX', icon: Server },
  { id: 'keycloak', label: 'Keycloak', icon: Server },
  { id: 'dapr', label: 'Dapr', icon: Server },
  { id: 'opensearch', label: 'OpenSearch', icon: Server },
  { id: 'observability', label: 'Observability', icon: Server },
  { id: 'mojaloop', label: 'Mojaloop', icon: Server },
  { id: 'fluvio', label: 'Fluvio', icon: Server },
  { id: 'permify', label: 'Permify', icon: Server },
  { id: 'openappsec', label: 'OpenAppSec', icon: Server },
];

type ServiceStatus = {
  service: string;
  status: 'healthy' | 'unavailable' | 'misconfigured';
  checkedAt: string;
  details: Record<string, unknown>;
  error?: string;
};

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    healthy: 'bg-emerald-100 text-emerald-800',
    unavailable: 'bg-red-100 text-red-800',
    misconfigured: 'bg-amber-100 text-amber-800',
    degraded: 'bg-amber-100 text-amber-800',
  };
  return <span className={`rounded px-2 py-1 text-xs font-medium ${styles[status] ?? 'bg-slate-100 text-slate-800'}`}>{status}</span>;
}

function StatusIcon({ status }: { status: ServiceStatus['status'] }) {
  if (status === 'healthy') return <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-label="healthy" />;
  if (status === 'misconfigured') return <Settings2 className="h-5 w-5 text-amber-600" aria-label="misconfigured" />;
  return <XCircle className="h-5 w-5 text-red-600" aria-label="unavailable" />;
}

function DetailValue({ value }: { value: unknown }) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return <span>{String(value)}</span>;
  return <code className="break-all text-xs">{JSON.stringify(value)}</code>;
}

export default function MiddlewareMonitoring() {
  const [activeTab, setActiveTab] = useState('overview');
  const healthQuery = trpc.middleware.health.useQuery(undefined, { retry: false, refetchInterval: 30_000 });
  const kafkaQuery = trpc.middleware.kafkaStatus.useQuery(undefined, { retry: false, enabled: activeTab === 'kafka' });
  const redisQuery = trpc.middleware.redisStatus.useQuery(undefined, { retry: false, enabled: activeTab === 'redis' });
  const postgresqlQuery = trpc.middleware.postgresqlStatus.useQuery(undefined, { retry: false, enabled: activeTab === 'postgresql' });
  const tigerbeetleQuery = trpc.middleware.tigerbeetleStatus.useQuery(undefined, { retry: false, enabled: activeTab === 'tigerbeetle' });
  const temporalQuery = trpc.middleware.temporalStatus.useQuery(undefined, { retry: false, enabled: activeTab === 'temporal' });
  const apisixQuery = trpc.middleware.apisixStatus.useQuery(undefined, { retry: false, enabled: activeTab === 'apisix' });
  const keycloakQuery = trpc.middleware.keycloakStatus.useQuery(undefined, { retry: false, enabled: activeTab === 'keycloak' });
  const daprQuery = trpc.middleware.daprStatus.useQuery(undefined, { retry: false, enabled: activeTab === 'dapr' });
  const opensearchQuery = trpc.middleware.opensearchStatus.useQuery(undefined, { retry: false, enabled: activeTab === 'opensearch' });
  const observabilityQuery = trpc.middleware.observabilityStatus.useQuery(undefined, { retry: false, enabled: activeTab === 'observability' });
  const mojaloopQuery = trpc.middleware.mojaloopStatus.useQuery(undefined, { retry: false, enabled: activeTab === 'mojaloop' });
  const fluvioQuery = trpc.middleware.fluvioStatus.useQuery(undefined, { retry: false, enabled: activeTab === 'fluvio' });
  const permifyQuery = trpc.middleware.permifyStatus.useQuery(undefined, { retry: false, enabled: activeTab === 'permify' });
  const openappsecQuery = trpc.middleware.openappsecStatus.useQuery(undefined, { retry: false, enabled: activeTab === 'openappsec' });

  const selected = useMemo(() => ({
    kafka: kafkaQuery,
    redis: redisQuery,
    postgresql: postgresqlQuery,
    tigerbeetle: tigerbeetleQuery,
    temporal: temporalQuery,
    apisix: apisixQuery,
    keycloak: keycloakQuery,
    dapr: daprQuery,
    opensearch: opensearchQuery,
    observability: observabilityQuery,
    mojaloop: mojaloopQuery,
    fluvio: fluvioQuery,
    permify: permifyQuery,
    openappsec: openappsecQuery,
  })[activeTab], [activeTab, kafkaQuery, redisQuery, postgresqlQuery, tigerbeetleQuery, temporalQuery, apisixQuery, keycloakQuery, daprQuery, opensearchQuery, observabilityQuery, mojaloopQuery, fluvioQuery, permifyQuery, openappsecQuery]);

  const health = healthQuery.data;
  const detail = selected?.data as ServiceStatus | undefined;

  return (
    <ModuleLayout module={MW_MODULE} navItems={MW_NAV_ITEMS} activeTab={activeTab} onTabChange={setActiveTab}>
      <PageHeader
        title={MW_NAV_ITEMS.find(item => item.id === activeTab)?.label ?? 'Middleware'}
        subtitle="Each status is a live probe. Unavailable and misconfigured dependencies are intentionally shown as failures."
        icon={Server}
      />

      {activeTab === 'overview' && (
        <section className="space-y-6">
          {healthQuery.isLoading && <p className="text-sm text-muted-foreground">Running integration probes…</p>}
          {healthQuery.error && <div className="rounded border border-red-200 bg-red-50 p-4 text-red-800">Could not retrieve integration health: {healthQuery.error.message}</div>}
          {health && (
            <>
              <div className="grid gap-4 md:grid-cols-4">
                <div className="rounded-lg border bg-card p-4"><p className="text-sm text-muted-foreground">Overall</p><p className="mt-1 text-2xl font-semibold capitalize">{health.overall}</p></div>
                <div className="rounded-lg border bg-card p-4"><p className="text-sm text-muted-foreground">Healthy</p><p className="mt-1 text-2xl font-semibold">{health.summary.healthy}/{health.summary.total}</p></div>
                <div className="rounded-lg border bg-card p-4"><p className="text-sm text-muted-foreground">Unavailable</p><p className="mt-1 text-2xl font-semibold text-red-700">{health.summary.unavailable}</p></div>
                <div className="rounded-lg border bg-card p-4"><p className="text-sm text-muted-foreground">Misconfigured</p><p className="mt-1 text-2xl font-semibold text-amber-700">{health.summary.misconfigured}</p></div>
              </div>
              <div className="overflow-hidden rounded-lg border bg-card">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50"><tr><th className="p-3 text-left">Service</th><th className="p-3 text-left">Status</th><th className="p-3 text-left">Live details</th><th className="p-3 text-left">Last checked</th></tr></thead>
                  <tbody>
                    {health.services.map(service => (
                      <tr key={service.service} className="border-t align-top">
                        <td className="p-3 font-medium">{service.service}</td>
                        <td className="p-3"><StatusBadge status={service.status} /></td>
                        <td className="p-3 text-muted-foreground">{service.error ?? (Object.entries(service.details).map(([key, value]) => `${key}: ${String(value)}`).join(', ') || 'No additional live telemetry exposed')}</td>
                        <td className="p-3 text-muted-foreground">{new Date(service.checkedAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {activeTab !== 'overview' && (
        <section className="max-w-3xl rounded-lg border bg-card p-6">
          {selected?.isLoading && <p className="text-sm text-muted-foreground">Running live probe…</p>}
          {selected?.error && <div className="rounded border border-red-200 bg-red-50 p-4 text-red-800">Probe request failed: {selected.error.message}</div>}
          {detail && (
            <div className="space-y-5">
              <div className="flex items-center gap-3"><StatusIcon status={detail.status} /><div><h2 className="text-xl font-semibold">{detail.service}</h2><StatusBadge status={detail.status} /></div></div>
              {detail.error && <div className="flex gap-2 rounded border border-amber-200 bg-amber-50 p-4 text-amber-950"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-medium">No live status is being fabricated</p><p className="text-sm">{detail.error}</p></div></div>}
              <div className="grid gap-3 sm:grid-cols-2">
                {Object.entries(detail.details).map(([key, value]) => <div key={key} className="rounded border p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{key}</p><div className="mt-1 text-sm"><DetailValue value={value} /></div></div>)}
              </div>
              <p className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />Checked {new Date(detail.checkedAt).toLocaleString()}</p>
            </div>
          )}
        </section>
      )}
    </ModuleLayout>
  );
}
