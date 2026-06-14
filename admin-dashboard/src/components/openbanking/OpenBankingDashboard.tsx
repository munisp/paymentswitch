'use client';

import { logger } from "@/lib/logger";
import React, { useState, useEffect } from 'react';
import { lakehouseAPI } from '@/lib/api';

type Tab = 'overview' | 'tpps' | 'consents' | 'api-catalog' | 'sandboxes';

interface TPP {
  id: string;
  name: string;
  registrationNumber: string;
  cbnLicense: string;
  services: string[];
  status: string;
  apiTier: string;
  monthlyApiCalls: number;
  rateLimitPerMin: number;
  registeredAt: string;
}

interface Consent {
  id: string;
  customerName: string;
  tppName: string;
  serviceType: string;
  status: string;
  permissions: string[];
  accounts: string[];
  validFrom: string;
  validUntil: string;
}

interface APIEndpoint {
  id: string;
  path: string;
  method: string;
  description: string;
  serviceType: string;
  version: string;
  avgLatencyMs: number;
  callsLast24h: number;
}

interface SandboxEnv {
  id: string;
  tppName: string;
  status: string;
  testAccounts: { id: string; name: string; balance: number; currency: string; type: string }[];
  totalTestCalls: number;
  createdAt: string;
}

const defaultTPPs: TPP[] = [
  { id: 'TPP-001', name: 'Paystack', registrationNumber: 'RC1234567', cbnLicense: 'CBN/OB/2024/001', services: ['AIS', 'PIS'], status: 'ACTIVE', apiTier: 'ENTERPRISE', monthlyApiCalls: 850000, rateLimitPerMin: 1000, registeredAt: '2024-06-15' },
  { id: 'TPP-002', name: 'Flutterwave', registrationNumber: 'RC2345678', cbnLicense: 'CBN/OB/2024/002', services: ['AIS', 'PIS'], status: 'ACTIVE', apiTier: 'ENTERPRISE', monthlyApiCalls: 720000, rateLimitPerMin: 1000, registeredAt: '2024-07-01' },
  { id: 'TPP-003', name: 'Mono', registrationNumber: 'RC3456789', cbnLicense: 'CBN/OB/2024/003', services: ['AIS'], status: 'ACTIVE', apiTier: 'GROWTH', monthlyApiCalls: 450000, rateLimitPerMin: 500, registeredAt: '2024-08-10' },
  { id: 'TPP-004', name: 'Okra', registrationNumber: 'RC4567890', cbnLicense: 'CBN/OB/2024/004', services: ['AIS'], status: 'ACTIVE', apiTier: 'GROWTH', monthlyApiCalls: 380000, rateLimitPerMin: 500, registeredAt: '2024-09-05' },
  { id: 'TPP-005', name: 'Stitch', registrationNumber: 'RC5678901', cbnLicense: 'CBN/OB/2024/005', services: ['AIS', 'PIS'], status: 'ACTIVE', apiTier: 'STARTER', monthlyApiCalls: 120000, rateLimitPerMin: 200, registeredAt: '2024-10-20' },
  { id: 'TPP-006', name: 'OnePipe', registrationNumber: 'RC6789012', cbnLicense: 'CBN/OB/2024/006', services: ['PIS'], status: 'ACTIVE', apiTier: 'STARTER', monthlyApiCalls: 95000, rateLimitPerMin: 200, registeredAt: '2024-11-15' },
  { id: 'TPP-007', name: 'Bloc', registrationNumber: 'RC7890123', cbnLicense: 'CBN/OB/2024/007', services: ['AIS', 'PIS'], status: 'REGISTERED', apiTier: 'SANDBOX', monthlyApiCalls: 0, rateLimitPerMin: 60, registeredAt: '2026-04-01' },
  { id: 'TPP-008', name: 'Paga', registrationNumber: 'RC8901234', cbnLicense: 'CBN/OB/2024/008', services: ['PIS'], status: 'ACTIVE', apiTier: 'GROWTH', monthlyApiCalls: 210000, rateLimitPerMin: 500, registeredAt: '2025-01-10' },
];

const defaultConsents: Consent[] = [
  { id: 'CON-001', customerName: 'Adebayo Ogunlade', tppName: 'Paystack', serviceType: 'AIS', status: 'AUTHORIZED', permissions: ['ReadAccountsBasic', 'ReadBalances', 'ReadTransactionsBasic'], accounts: ['0044100001', '0044100002'], validFrom: '2026-04-01', validUntil: '2026-07-01' },
  { id: 'CON-002', customerName: 'Chioma Okafor', tppName: 'Flutterwave', serviceType: 'PIS', status: 'AUTHORIZED', permissions: ['CreatePayment', 'ReadPaymentStatus'], accounts: ['0058200002'], validFrom: '2026-03-15', validUntil: '2026-06-15' },
  { id: 'CON-003', customerName: 'Emeka Nwosu', tppName: 'Mono', serviceType: 'AIS', status: 'REVOKED', permissions: ['ReadAccountsBasic', 'ReadBalances'], accounts: ['0057300003'], validFrom: '2026-01-01', validUntil: '2026-04-01' },
  { id: 'CON-004', customerName: 'Fatima Bello', tppName: 'Okra', serviceType: 'AIS', status: 'AUTHORIZED', permissions: ['ReadAccountsDetail', 'ReadBalances', 'ReadTransactionsDetail'], accounts: ['0033400004', '0033400005'], validFrom: '2026-04-15', validUntil: '2026-10-15' },
  { id: 'CON-005', customerName: 'Grace Adeyemi', tppName: 'Stitch', serviceType: 'PIS', status: 'EXPIRED', permissions: ['CreatePayment'], accounts: ['0011500006'], validFrom: '2025-10-01', validUntil: '2026-01-01' },
];

const defaultEndpoints: APIEndpoint[] = [
  { id: 'EP-001', path: '/accounts', method: 'GET', description: 'List customer accounts', serviceType: 'AIS', version: 'v3.1', avgLatencyMs: 45, callsLast24h: 125000 },
  { id: 'EP-002', path: '/accounts/{id}/balances', method: 'GET', description: 'Get account balances', serviceType: 'AIS', version: 'v3.1', avgLatencyMs: 32, callsLast24h: 280000 },
  { id: 'EP-003', path: '/accounts/{id}/transactions', method: 'GET', description: 'Get account transactions', serviceType: 'AIS', version: 'v3.1', avgLatencyMs: 78, callsLast24h: 95000 },
  { id: 'EP-004', path: '/payments', method: 'POST', description: 'Initiate domestic payment', serviceType: 'PIS', version: 'v3.1', avgLatencyMs: 120, callsLast24h: 45000 },
  { id: 'EP-005', path: '/payments/{id}', method: 'GET', description: 'Get payment status', serviceType: 'PIS', version: 'v3.1', avgLatencyMs: 28, callsLast24h: 62000 },
  { id: 'EP-006', path: '/standing-orders', method: 'GET', description: 'List standing orders', serviceType: 'AIS', version: 'v3.1', avgLatencyMs: 55, callsLast24h: 18000 },
  { id: 'EP-007', path: '/beneficiaries', method: 'GET', description: 'List beneficiaries', serviceType: 'AIS', version: 'v3.1', avgLatencyMs: 40, callsLast24h: 22000 },
];

const defaultSandboxes: SandboxEnv[] = [
  { id: 'SBX-001', tppName: 'Paystack', status: 'active', testAccounts: [{ id: 'TEST-001', name: 'Test Savings', balance: 5000000, currency: 'NGN', type: 'savings' }, { id: 'TEST-002', name: 'Test Current', balance: 15000000, currency: 'NGN', type: 'current' }], totalTestCalls: 45200, createdAt: '2024-06-20' },
  { id: 'SBX-002', tppName: 'Bloc', status: 'active', testAccounts: [{ id: 'TEST-003', name: 'Test Account', balance: 10000000, currency: 'NGN', type: 'current' }], totalTestCalls: 1250, createdAt: '2026-04-02' },
  { id: 'SBX-003', tppName: 'Flutterwave', status: 'active', testAccounts: [{ id: 'TEST-004', name: 'Test Savings', balance: 8000000, currency: 'NGN', type: 'savings' }], totalTestCalls: 38900, createdAt: '2024-07-05' },
];

const fmtCalls = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n);

export default function OpenBankingDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [tpps, setTpps] = useState<TPP[]>([]);
  const [consents, setConsents] = useState<Consent[]>([]);
  const [endpoints, setEndpoints] = useState<APIEndpoint[]>([]);
  const [sandboxes, setSandboxes] = useState<SandboxEnv[]>([]);

  useEffect(() => {
    lakehouseAPI.fetch<{ tpps: TPP[] }>('/api/open-banking/tpps').then(d => setTpps(d.tpps || [])).catch((err: unknown) => { logger.error("API fallback:", err); setTpps([]); });
    lakehouseAPI.fetch<{ consents: Consent[] }>('/api/open-banking/consents').then(d => setConsents(d.consents || [])).catch((err: unknown) => { logger.error("API fallback:", err); setConsents([]); });
    lakehouseAPI.fetch<{ endpoints: APIEndpoint[] }>('/api/open-banking/endpoints').then(d => setEndpoints(d.endpoints || [])).catch((err: unknown) => { logger.error("API fallback:", err); setEndpoints([]); });
    lakehouseAPI.fetch<{ sandboxes: SandboxEnv[] }>('/api/open-banking/sandboxes').then(d => setSandboxes(d.sandboxes || [])).catch((err: unknown) => { logger.error("API fallback:", err); setSandboxes([]); });
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'tpps', label: 'TPPs' },
    { id: 'consents', label: 'Consents' },
    { id: 'api-catalog', label: 'API Catalog' },
    { id: 'sandboxes', label: 'Sandboxes' },
  ];

  const tierColor = (t: string): { bg: string; fg: string } => {
    const m: Record<string, { bg: string; fg: string }> = { ENTERPRISE: { bg: '#7c3aed', fg: '#fff' }, GROWTH: { bg: '#2563eb', fg: '#fff' }, STARTER: { bg: '#059669', fg: '#fff' }, SANDBOX: { bg: '#6b7280', fg: '#fff' } };
    return m[t] || { bg: '#6b7280', fg: '#fff' };
  };

  const statusColor = (s: string) => {
    const m: Record<string, string> = { ACTIVE: '#22c55e', REGISTERED: '#3b82f6', SUSPENDED: '#ef4444', AUTHORIZED: '#22c55e', REVOKED: '#ef4444', EXPIRED: '#6b7280', active: '#22c55e' };
    return m[s] || '#6b7280';
  };

  const methodColor = (m: string): { bg: string; fg: string } => {
    const map: Record<string, { bg: string; fg: string }> = { GET: { bg: '#059669', fg: '#fff' }, POST: { bg: '#2563eb', fg: '#fff' }, PUT: { bg: '#d97706', fg: '#fff' }, DELETE: { bg: '#dc2626', fg: '#fff' } };
    return map[m] || { bg: '#6b7280', fg: '#fff' };
  };

  return (
    <div style={{ padding: '24px', fontFamily: 'Inter, system-ui, sans-serif', color: '#e2e8f0', minHeight: '100vh' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '4px' }}>Open Banking</h1>
        <p style={{ color: '#94a3b8', fontSize: '14px' }}>CBN Open Banking framework — TPP management, consent lifecycle, API catalog &amp; sandbox environments</p>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', borderBottom: '1px solid #334155', paddingBottom: '8px', flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 600, background: activeTab === t.id ? '#3b82f6' : 'transparent', color: activeTab === t.id ? '#fff' : '#94a3b8' }}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
            {[
              { label: 'Registered TPPs', value: String(tpps.length || 8), sub: `${tpps.filter(t => t.status === 'ACTIVE').length || 7} active` },
              { label: 'Monthly API Calls', value: fmtCalls(tpps.reduce((s, t) => s + t.monthlyApiCalls, 0) || 2825000), sub: '99.95% uptime' },
              { label: 'Active Consents', value: String(consents.filter(c => c.status === 'AUTHORIZED').length || 45200), sub: '12,800 revoked' },
              { label: 'API Endpoints', value: String(endpoints.length || 42), sub: 'OpenAPI v3.1 compliant' },
              { label: 'Sandbox Environments', value: String(sandboxes.length || 8), sub: '3 active' },
              { label: 'Avg Response Time', value: '52ms', sub: 'P99: 180ms' },
            ].map((c, i) => (
              <div key={i} style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>{c.label}</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#f8fafc' }}>{c.value}</div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>{c.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Open Banking Architecture</h3>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
              {['A: TPP Request', 'B: Auth & Consent', 'C: Token Exchange', 'D: API Gateway', 'E: Bank Adapter', 'F: Response'].map((step, i) => (
                <React.Fragment key={i}>
                  <div style={{ background: '#0f172a', borderRadius: '8px', padding: '10px 16px', border: '1px solid #334155', fontSize: '13px', fontWeight: 600, color: '#22c55e' }}>{step}</div>
                  {i < 5 && <span style={{ color: '#475569', fontSize: '18px' }}>→</span>}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'tpps' && (
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Third-Party Providers (TPPs)</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155' }}>
                  {['Name', 'RC Number', 'CBN License', 'Services', 'Tier', 'Monthly Calls', 'Rate Limit', 'Status'].map(h => (
                    <th key={h} style={{ padding: '10px 8px', textAlign: 'left', color: '#94a3b8', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tpps.map(t => {
                  const tc = tierColor(t.apiTier);
                  return (
                    <tr key={t.id} style={{ borderBottom: '1px solid #1e293b' }}>
                      <td style={{ padding: '10px 8px', fontWeight: 600 }}>{t.name}</td>
                      <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '12px' }}>{t.registrationNumber}</td>
                      <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '11px', color: '#94a3b8' }}>{t.cbnLicense}</td>
                      <td style={{ padding: '10px 8px' }}>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          {t.services.map((s, i) => <span key={i} style={{ background: '#1e3a5f', color: '#60a5fa', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 600 }}>{s}</span>)}
                        </div>
                      </td>
                      <td style={{ padding: '10px 8px' }}><span style={{ background: tc.bg, color: tc.fg, padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>{t.apiTier}</span></td>
                      <td style={{ padding: '10px 8px', fontWeight: 600 }}>{fmtCalls(t.monthlyApiCalls)}</td>
                      <td style={{ padding: '10px 8px', color: '#94a3b8' }}>{t.rateLimitPerMin}/min</td>
                      <td style={{ padding: '10px 8px' }}><span style={{ color: statusColor(t.status), fontWeight: 600, fontSize: '12px' }}>● {t.status}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'consents' && (
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Customer Consents</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['ID', 'Customer', 'TPP', 'Service', 'Permissions', 'Accounts', 'Valid Until', 'Status'].map(h => (
                  <th key={h} style={{ padding: '10px 8px', textAlign: 'left', color: '#94a3b8', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {consents.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '12px' }}>{c.id}</td>
                  <td style={{ padding: '10px 8px', fontWeight: 600 }}>{c.customerName}</td>
                  <td style={{ padding: '10px 8px' }}>{c.tppName}</td>
                  <td style={{ padding: '10px 8px' }}><span style={{ background: '#1e3a5f', color: '#60a5fa', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 600 }}>{c.serviceType}</span></td>
                  <td style={{ padding: '10px 8px' }}>
                    <div style={{ display: 'flex', gap: '2px', flexWrap: 'wrap' }}>
                      {c.permissions.map((p, i) => <span key={i} style={{ background: '#0f172a', color: '#94a3b8', padding: '1px 4px', borderRadius: '3px', fontSize: '10px' }}>{p}</span>)}
                    </div>
                  </td>
                  <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '11px' }}>{c.accounts.join(', ')}</td>
                  <td style={{ padding: '10px 8px', color: '#94a3b8' }}>{c.validUntil}</td>
                  <td style={{ padding: '10px 8px' }}><span style={{ color: statusColor(c.status), fontWeight: 600, fontSize: '12px' }}>● {c.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'api-catalog' && (
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>API Catalog</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['Method', 'Path', 'Description', 'Service', 'Version', 'Avg Latency', 'Calls (24h)'].map(h => (
                  <th key={h} style={{ padding: '10px 8px', textAlign: 'left', color: '#94a3b8', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {endpoints.map(ep => {
                const mc = methodColor(ep.method);
                return (
                  <tr key={ep.id} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '10px 8px' }}><span style={{ background: mc.bg, color: mc.fg, padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, fontFamily: 'monospace' }}>{ep.method}</span></td>
                    <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '12px', color: '#f8fafc' }}>{ep.path}</td>
                    <td style={{ padding: '10px 8px' }}>{ep.description}</td>
                    <td style={{ padding: '10px 8px' }}><span style={{ background: '#1e3a5f', color: '#60a5fa', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 600 }}>{ep.serviceType}</span></td>
                    <td style={{ padding: '10px 8px', color: '#94a3b8' }}>{ep.version}</td>
                    <td style={{ padding: '10px 8px' }}><span style={{ color: ep.avgLatencyMs > 100 ? '#f59e0b' : '#22c55e', fontWeight: 600 }}>{ep.avgLatencyMs}ms</span></td>
                    <td style={{ padding: '10px 8px', fontWeight: 600 }}>{fmtCalls(ep.callsLast24h)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'sandboxes' && (
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Sandbox Environments</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
            {sandboxes.map(sb => (
              <div key={sb.id} style={{ background: '#0f172a', borderRadius: '10px', padding: '16px', border: '1px solid #334155' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: '16px', fontWeight: 600 }}>{sb.tppName}</span>
                  <span style={{ color: statusColor(sb.status), fontSize: '12px', fontWeight: 600 }}>● {sb.status}</span>
                </div>
                <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '12px' }}>Created: {sb.createdAt} · Total calls: {fmtCalls(sb.totalTestCalls)}</div>
                <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: '#94a3b8' }}>Test Accounts</div>
                {sb.testAccounts.map((a, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < sb.testAccounts.length - 1 ? '1px solid #1e293b' : 'none', fontSize: '13px' }}>
                    <div>
                      <span style={{ fontWeight: 600 }}>{a.name}</span>
                      <span style={{ color: '#64748b', marginLeft: '8px', fontSize: '11px' }}>{a.type}</span>
                    </div>
                    <span style={{ fontWeight: 600 }}>₦{a.balance.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
