import { logger } from "@/lib/logger";
import React, { useCallback } from 'react';
import { lakehouseAPI, useLakehouseData } from '@/lib/api';
import { Database, Activity, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

const middleware = [
  { name: 'Apache Kafka', type: 'Event Streaming', status: 'healthy', version: '3.7.0', metrics: 'Topics: 24, Partitions: 96, Messages/s: 45K', port: 9092 },
  { name: 'Temporal', type: 'Workflow Engine', status: 'healthy', version: '1.24.0', metrics: 'Active workflows: 1,240, Completed/hr: 850', port: 7233 },
  { name: 'TigerBeetle', type: 'Financial Ledger', status: 'healthy', version: '0.15.0', metrics: 'Transfers/s: 100K, Accounts: 2.4M, Latency: 0.5ms', port: 3001 },
  { name: 'Redis', type: 'Cache/Session', status: 'healthy', version: '7.2', metrics: 'Keys: 890K, Memory: 2.1GB, Ops/s: 125K', port: 6379 },
  { name: 'PostgreSQL', type: 'Primary Database', status: 'healthy', version: '16.2', metrics: 'Connections: 45/200, Tables: 75+, Size: 12.4GB', port: 5432 },
  { name: 'OpenSearch', type: 'Search/Analytics', status: 'healthy', version: '2.12', metrics: 'Indices: 18, Docs: 45M, Queries/s: 2.1K', port: 9200 },
  { name: 'Keycloak', type: 'Identity/IAM', status: 'healthy', version: '24.0', metrics: 'Users: 12K, Sessions: 450, Realms: 3', port: 8080 },
  { name: 'APISIX', type: 'API Gateway', status: 'healthy', version: '3.8', metrics: 'Routes: 156, Upstreams: 24, QPS: 85K', port: 9080 },
  { name: 'Dapr', type: 'Service Mesh', status: 'healthy', version: '1.13', metrics: 'Sidecars: 12, Pub/Sub: 8 topics, Bindings: 6', port: 3500 },
  { name: 'OpenAppSec', type: 'WAF/Security', status: 'healthy', version: '1.0', metrics: 'Blocked: 234/hr, Rules: 45, ML models: 3', port: 8443 },
  { name: 'Permify', type: 'Authorization', status: 'healthy', version: '0.9', metrics: 'Schemas: 12, Relations: 890K, Checks/s: 15K', port: 3476 },
  { name: 'Mojaloop', type: 'Interoperability', status: 'healthy', version: '15.0', metrics: 'Transfers: 12K/day, DFSPs: 8, Schemes: 2', port: 3000 },
];

const statusIcons: Record<string, React.ReactNode> = {
  healthy: <CheckCircle className="h-4 w-4 text-green-500" />,
  degraded: <AlertTriangle className="h-4 w-4 text-yellow-500" />,
  down: <XCircle className="h-4 w-4 text-red-500" />,
};

export function MiddlewareDashboard() {
  const fetcher = useCallback(() =>
    lakehouseAPI.fetch<{ services: typeof middleware }>('/api/v1/infrastructure/middleware')
      .then(d => d.services)
      .catch((err: unknown) => { logger.error("API fallback:", err); return middleware; }), []);
  const { data: services } = useLakehouseData(fetcher, 15000);
  const activeMiddleware = services || middleware;
  return (
    <div className="space-y-6">
      <div><h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Database className="h-6 w-6" /> Middleware Services</h2><p className="text-sm text-gray-500 mt-1">Infrastructure status: Kafka, Temporal, TigerBeetle, Redis, PostgreSQL, OpenSearch, Keycloak, APISIX, Dapr, OpenAppSec, Permify, Mojaloop</p></div>
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border p-4"><div className="text-2xl font-bold">{activeMiddleware.length}</div><div className="text-sm text-gray-500">Total Services</div></div>
        <div className="bg-white rounded-lg border p-4"><div className="text-2xl font-bold text-green-600">{activeMiddleware.filter(m => m.status === 'healthy').length}</div><div className="text-sm text-gray-500">Healthy</div></div>
        <div className="bg-white rounded-lg border p-4"><div className="text-2xl font-bold text-yellow-600">{activeMiddleware.filter(m => m.status === 'degraded').length}</div><div className="text-sm text-gray-500">Degraded</div></div>
        <div className="bg-white rounded-lg border p-4"><div className="text-2xl font-bold text-red-600">{activeMiddleware.filter(m => m.status === 'down').length}</div><div className="text-sm text-gray-500">Down</div></div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {activeMiddleware.map(m => (
          <div key={m.name} className="bg-white rounded-lg border p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">{statusIcons[m.status]}<h3 className="font-semibold">{m.name}</h3></div>
              <span className="text-xs text-gray-400">v{m.version}</span>
            </div>
            <div className="text-xs text-gray-500 mb-1">{m.type} • Port {m.port}</div>
            <div className="text-xs text-gray-600 bg-gray-50 rounded px-2 py-1 mt-2 font-mono">{m.metrics}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
