'use client';

import { logger } from "@/lib/logger";
import React, { useState, useCallback } from 'react';
import { lakehouseAPI, useLakehouseData } from '@/lib/api';

interface Corridor {
  id: string;
  sourceCountry: string;
  destCountry: string;
  destCurrency: string;
  category: string;
  status: string;
  maxAmountUSD: number;
  spreadCapBPS: number;
  cbnApproval: string;
}

interface Provider {
  id: string;
  name: string;
  type: string;
  status: string;
  avgLatencyMs: number;
  successRate: number;
  costPerTxnUSD: number;
  settlementTime: string;
}

interface Transfer {
  id: string;
  sender: string;
  beneficiary: string;
  corridor: string;
  amountUSD: number;
  status: string;
  provider: string;
  timestamp: string;
}

const corridors: Corridor[] = [
  { id: 'NG-GH', sourceCountry: 'NG', destCountry: 'GH', destCurrency: 'GHS', category: 'West Africa Labor', status: 'active', maxAmountUSD: 5000, spreadCapBPS: 150, cbnApproval: 'CBN/2024/OBR/001' },
  { id: 'NG-SN', sourceCountry: 'NG', destCountry: 'SN', destCurrency: 'XOF', category: 'West Africa Labor', status: 'active', maxAmountUSD: 5000, spreadCapBPS: 200, cbnApproval: 'CBN/2024/OBR/002' },
  { id: 'NG-GB', sourceCountry: 'NG', destCountry: 'GB', destCurrency: 'GBP', category: 'Education', status: 'active', maxAmountUSD: 50000, spreadCapBPS: 100, cbnApproval: 'CBN/2024/OBR/010' },
  { id: 'NG-US', sourceCountry: 'NG', destCountry: 'US', destCurrency: 'USD', category: 'Education', status: 'active', maxAmountUSD: 50000, spreadCapBPS: 100, cbnApproval: 'CBN/2024/OBR/011' },
  { id: 'NG-CA', sourceCountry: 'NG', destCountry: 'CA', destCurrency: 'CAD', category: 'Education', status: 'active', maxAmountUSD: 50000, spreadCapBPS: 120, cbnApproval: 'CBN/2024/OBR/012' },
  { id: 'NG-IN', sourceCountry: 'NG', destCountry: 'IN', destCurrency: 'INR', category: 'Medical', status: 'active', maxAmountUSD: 30000, spreadCapBPS: 150, cbnApproval: 'CBN/2024/OBR/020' },
  { id: 'NG-CN', sourceCountry: 'NG', destCountry: 'CN', destCurrency: 'CNY', category: 'Premium Business', status: 'active', maxAmountUSD: 100000, spreadCapBPS: 80, cbnApproval: 'CBN/2024/OBR/030' },
  { id: 'NG-AE', sourceCountry: 'NG', destCountry: 'AE', destCurrency: 'AED', category: 'Premium Business', status: 'active', maxAmountUSD: 100000, spreadCapBPS: 90, cbnApproval: 'CBN/2024/OBR/031' },
  { id: 'NG-KE', sourceCountry: 'NG', destCountry: 'KE', destCurrency: 'KES', category: 'General Personal', status: 'active', maxAmountUSD: 10000, spreadCapBPS: 150, cbnApproval: 'CBN/2024/OBR/040' },
  { id: 'NG-ZA', sourceCountry: 'NG', destCountry: 'ZA', destCurrency: 'ZAR', category: 'General Personal', status: 'active', maxAmountUSD: 10000, spreadCapBPS: 130, cbnApproval: 'CBN/2024/OBR/041' },
];

const providers: Provider[] = [
  { id: 'flutterwave', name: 'Flutterwave', type: 'Bank', status: 'active', avgLatencyMs: 800, successRate: 98.8, costPerTxnUSD: 1.80, settlementTime: 'T+0' },
  { id: 'worldremit', name: 'WorldRemit', type: 'MTO', status: 'active', avgLatencyMs: 1200, successRate: 99.2, costPerTxnUSD: 2.50, settlementTime: 'T+1' },
  { id: 'chipper', name: 'Chipper Cash', type: 'Mobile Money', status: 'active', avgLatencyMs: 600, successRate: 97.5, costPerTxnUSD: 1.20, settlementTime: 'T+0' },
  { id: 'mojaloop_hub', name: 'Mojaloop Hub', type: 'Interop Switch', status: 'active', avgLatencyMs: 400, successRate: 99.8, costPerTxnUSD: 0.50, settlementTime: 'T+0' },
  { id: 'wise', name: 'Wise', type: 'Bank', status: 'active', avgLatencyMs: 2000, successRate: 99.6, costPerTxnUSD: 4.00, settlementTime: 'T+1' },
  { id: 'mtn_momo', name: 'MTN MoMo', type: 'Mobile Money', status: 'active', avgLatencyMs: 500, successRate: 96.5, costPerTxnUSD: 0.80, settlementTime: 'T+0' },
  { id: 'lemfi', name: 'LemFi', type: 'Bank', status: 'active', avgLatencyMs: 1500, successRate: 99.5, costPerTxnUSD: 3.00, settlementTime: 'T+1' },
];

const recentTransfers: Transfer[] = [
  { id: 'TRF-2024-000001', sender: 'Fintech Alpha', beneficiary: 'Kwame Asante (GH)', corridor: 'NG-GH', amountUSD: 500, status: 'completed', provider: 'chipper', timestamp: '2024-12-15T14:32:00Z' },
  { id: 'TRF-2024-000002', sender: 'PayApp NG', beneficiary: 'James Smith (GB)', corridor: 'NG-GB', amountUSD: 12000, status: 'completed', provider: 'wise', timestamp: '2024-12-15T14:28:00Z' },
  { id: 'TRF-2024-000003', sender: 'MoneyGo', beneficiary: 'Raj Patel (IN)', corridor: 'NG-IN', amountUSD: 8500, status: 'processing', provider: 'flutterwave', timestamp: '2024-12-15T14:25:00Z' },
  { id: 'TRF-2024-000004', sender: 'Fintech Beta', beneficiary: 'Chen Wei (CN)', corridor: 'NG-CN', amountUSD: 45000, status: 'manual_review', provider: 'wise', timestamp: '2024-12-15T14:20:00Z' },
  { id: 'TRF-2024-000005', sender: 'PayApp NG', beneficiary: 'Fatou Diallo (SN)', corridor: 'NG-SN', amountUSD: 200, status: 'completed', provider: 'mtn_momo', timestamp: '2024-12-15T14:15:00Z' },
];

type TabType = 'overview' | 'corridors' | 'providers' | 'transfers' | 'billing' | 'sanctions';

export default function OutboundRemittanceDashboard() {
  const fetcher = useCallback(() =>
    lakehouseAPI.fetch<{ corridors: Corridor[]; providers: Provider[]; transfers: Transfer[] }>('/api/v1/remittances/outbound')
      .then(d => ({ corridors: d.corridors, providers: d.providers, transfers: d.transfers }))
      .catch((err: unknown) => { logger.error("API fallback:", err); return { corridors, providers, transfers: recentTransfers }; }), []);
  const { data: apiData } = useLakehouseData(fetcher, 30000);
  const activeCorridors = apiData?.corridors || corridors;
  const activeProviders = apiData?.providers || providers;
  const activeTransfers = apiData?.transfers || recentTransfers;
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  const tabs: { id: TabType; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'corridors', label: 'Corridors' },
    { id: 'providers', label: 'Providers' },
    { id: 'transfers', label: 'Transfers' },
    { id: 'billing', label: 'Billing & Tiers' },
    { id: 'sanctions', label: 'Sanctions' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Outbound Remittance Platform</h1>
        <span className="px-3 py-1 text-xs font-medium rounded-full bg-green-500/20 text-green-400">
          Module Active
        </span>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Daily Volume" value="$2.4M" change={12.5} />
        <MetricCard label="Active Corridors" value="13" change={0} />
        <MetricCard label="Success Rate" value="99.1%" change={0.3} />
        <MetricCard label="Avg Latency" value="890ms" change={-5.2} />
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-700">
        <nav className="flex space-x-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && <OverviewTab />}
      {activeTab === 'corridors' && <CorridorsTab />}
      {activeTab === 'providers' && <ProvidersTab />}
      {activeTab === 'transfers' && <TransfersTab />}
      {activeTab === 'billing' && <BillingTab />}
      {activeTab === 'sanctions' && <SanctionsTab />}
    </div>
  );
}

function MetricCard({ label, value, change }: { label: string; value: string; change: number }) {
  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <p className="text-sm text-gray-400">{label}</p>
      <p className="text-2xl font-bold text-white mt-1">{value}</p>
      <p className={`text-xs mt-1 ${change > 0 ? 'text-green-400' : change < 0 ? 'text-red-400' : 'text-gray-500'}`}>
        {change > 0 ? '+' : ''}{change}% vs last hour
      </p>
    </div>
  );
}

function OverviewTab() {
  return (
    <div className="space-y-6">
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h3 className="text-lg font-medium text-white mb-4">Transaction Lifecycle (A-G)</h3>
        <div className="flex items-center space-x-2 text-sm overflow-x-auto">
          {['Admission', 'Workflow', 'Compliance', 'Pricing', 'Routing', 'Execution', 'Settlement'].map((step, i) => (
            <React.Fragment key={step}>
              <div className="flex-shrink-0 px-3 py-2 rounded bg-blue-500/20 text-blue-400 font-medium">
                {String.fromCharCode(65 + i)}. {step}
              </div>
              {i < 6 && <span className="text-gray-500 flex-shrink-0">→</span>}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h3 className="text-lg font-medium text-white mb-4">Corridor Volume (24h)</h3>
          <div className="space-y-3">
            {[
              { corridor: 'NG-GB', volume: '$890K', pct: 37 },
              { corridor: 'NG-US', volume: '$620K', pct: 26 },
              { corridor: 'NG-GH', volume: '$340K', pct: 14 },
              { corridor: 'NG-CN', volume: '$280K', pct: 12 },
              { corridor: 'NG-IN', volume: '$170K', pct: 7 },
              { corridor: 'Others', volume: '$100K', pct: 4 },
            ].map((item) => (
              <div key={item.corridor} className="flex items-center space-x-3">
                <span className="text-sm text-gray-300 w-16">{item.corridor}</span>
                <div className="flex-1 bg-gray-700 rounded-full h-2">
                  <div className="bg-blue-500 rounded-full h-2" style={{ width: `${item.pct}%` }} />
                </div>
                <span className="text-sm text-gray-400 w-16 text-right">{item.volume}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h3 className="text-lg font-medium text-white mb-4">Provider Health</h3>
          <div className="space-y-2">
            {providers.slice(0, 5).map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2">
                <div className="flex items-center space-x-2">
                  <div className={`w-2 h-2 rounded-full ${p.status === 'active' ? 'bg-green-400' : 'bg-yellow-400'}`} />
                  <span className="text-sm text-gray-300">{p.name}</span>
                </div>
                <div className="flex items-center space-x-4 text-xs text-gray-400">
                  <span>{p.successRate}%</span>
                  <span>{p.avgLatencyMs}ms</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CorridorsTab() {
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-900">
          <tr>
            <th className="px-4 py-3 text-left text-gray-400">Corridor</th>
            <th className="px-4 py-3 text-left text-gray-400">Category</th>
            <th className="px-4 py-3 text-left text-gray-400">Currency</th>
            <th className="px-4 py-3 text-left text-gray-400">Max Amount</th>
            <th className="px-4 py-3 text-left text-gray-400">Spread Cap</th>
            <th className="px-4 py-3 text-left text-gray-400">CBN Approval</th>
            <th className="px-4 py-3 text-left text-gray-400">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-700">
          {corridors.map((c) => (
            <tr key={c.id} className="hover:bg-gray-750">
              <td className="px-4 py-3 text-white font-medium">{c.id}</td>
              <td className="px-4 py-3 text-gray-300">{c.category}</td>
              <td className="px-4 py-3 text-gray-300">{c.destCurrency}</td>
              <td className="px-4 py-3 text-gray-300">${c.maxAmountUSD.toLocaleString()}</td>
              <td className="px-4 py-3 text-gray-300">{c.spreadCapBPS} bps</td>
              <td className="px-4 py-3 text-gray-400 text-xs">{c.cbnApproval}</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-1 text-xs rounded-full ${
                  c.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                }`}>{c.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProvidersTab() {
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-900">
          <tr>
            <th className="px-4 py-3 text-left text-gray-400">Provider</th>
            <th className="px-4 py-3 text-left text-gray-400">Type</th>
            <th className="px-4 py-3 text-left text-gray-400">Status</th>
            <th className="px-4 py-3 text-left text-gray-400">Latency</th>
            <th className="px-4 py-3 text-left text-gray-400">Success Rate</th>
            <th className="px-4 py-3 text-left text-gray-400">Cost/Txn</th>
            <th className="px-4 py-3 text-left text-gray-400">Settlement</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-700">
          {providers.map((p) => (
            <tr key={p.id} className="hover:bg-gray-750">
              <td className="px-4 py-3 text-white font-medium">{p.name}</td>
              <td className="px-4 py-3 text-gray-300">{p.type}</td>
              <td className="px-4 py-3">
                <span className="px-2 py-1 text-xs rounded-full bg-green-500/20 text-green-400">{p.status}</span>
              </td>
              <td className="px-4 py-3 text-gray-300">{p.avgLatencyMs}ms</td>
              <td className="px-4 py-3 text-gray-300">{p.successRate}%</td>
              <td className="px-4 py-3 text-gray-300">${p.costPerTxnUSD.toFixed(2)}</td>
              <td className="px-4 py-3 text-gray-300">{p.settlementTime}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TransfersTab() {
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-900">
          <tr>
            <th className="px-4 py-3 text-left text-gray-400">Transfer ID</th>
            <th className="px-4 py-3 text-left text-gray-400">Sender</th>
            <th className="px-4 py-3 text-left text-gray-400">Beneficiary</th>
            <th className="px-4 py-3 text-left text-gray-400">Corridor</th>
            <th className="px-4 py-3 text-left text-gray-400">Amount</th>
            <th className="px-4 py-3 text-left text-gray-400">Provider</th>
            <th className="px-4 py-3 text-left text-gray-400">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-700">
          {recentTransfers.map((t) => (
            <tr key={t.id} className="hover:bg-gray-750">
              <td className="px-4 py-3 text-blue-400 font-mono text-xs">{t.id}</td>
              <td className="px-4 py-3 text-gray-300">{t.sender}</td>
              <td className="px-4 py-3 text-gray-300">{t.beneficiary}</td>
              <td className="px-4 py-3 text-white font-medium">{t.corridor}</td>
              <td className="px-4 py-3 text-gray-300">${t.amountUSD.toLocaleString()}</td>
              <td className="px-4 py-3 text-gray-300">{t.provider}</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-1 text-xs rounded-full ${
                  t.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                  t.status === 'processing' ? 'bg-blue-500/20 text-blue-400' :
                  'bg-yellow-500/20 text-yellow-400'
                }`}>{t.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BillingTab() {
  const tiers = [
    { id: 'starter', name: 'Starter', monthlyFee: 200, switchFee: 0.25, corridorDiscount: 0, maxTxns: 10000, sla: '99.0%', fxShare: 0 },
    { id: 'growth', name: 'Growth', monthlyFee: 500, switchFee: 0.15, corridorDiscount: 10, maxTxns: 50000, sla: '99.5%', fxShare: 5 },
    { id: 'enterprise', name: 'Enterprise', monthlyFee: 2000, switchFee: 0.10, corridorDiscount: 20, maxTxns: 500000, sla: '99.9%', fxShare: 15 },
    { id: 'premium', name: 'Premium', monthlyFee: 5000, switchFee: 0.05, corridorDiscount: 35, maxTxns: 0, sla: '99.99%', fxShare: 25 },
  ];

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-white">Subscription Tiers</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {tiers.map((tier) => (
          <div key={tier.id} className="bg-gray-800 rounded-lg p-5 border border-gray-700">
            <h4 className="text-lg font-bold text-white">{tier.name}</h4>
            <p className="text-2xl font-bold text-blue-400 mt-2">${tier.monthlyFee}<span className="text-sm text-gray-400">/mo</span></p>
            <ul className="mt-4 space-y-2 text-sm text-gray-300">
              <li>Switch fee: ${tier.switchFee}/txn</li>
              <li>Corridor discount: {tier.corridorDiscount}%</li>
              <li>Max txns: {tier.maxTxns > 0 ? tier.maxTxns.toLocaleString() : 'Unlimited'}</li>
              <li>SLA: {tier.sla}</li>
              <li>FX revenue share: {tier.fxShare}%</li>
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function SanctionsTab() {
  const lists = [
    { id: 'ofac_sdn', name: 'OFAC SDN List', entries: 12847, lastUpdated: '2024-12-15', mandatory: true },
    { id: 'un_consolidated', name: 'UN Consolidated List', entries: 789, lastUpdated: '2024-12-14', mandatory: true },
    { id: 'eu_sanctions', name: 'EU Sanctions', entries: 2156, lastUpdated: '2024-12-15', mandatory: true },
    { id: 'cbn_watchlist', name: 'CBN Domestic Watchlist', entries: 456, lastUpdated: '2024-12-15', mandatory: true },
    { id: 'interpol_red', name: 'INTERPOL Red Notice', entries: 7312, lastUpdated: '2024-12-13', mandatory: false },
    { id: 'pep_list', name: 'PEP List', entries: 15000, lastUpdated: '2024-12-15', mandatory: true },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard label="Transfers Screened (24h)" value="4,892" change={8.2} />
        <MetricCard label="Blocked" value="3" change={0} />
        <MetricCard label="Escalated to Review" value="12" change={-15} />
      </div>
      <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-900">
            <tr>
              <th className="px-4 py-3 text-left text-gray-400">List</th>
              <th className="px-4 py-3 text-left text-gray-400">Entries</th>
              <th className="px-4 py-3 text-left text-gray-400">Last Updated</th>
              <th className="px-4 py-3 text-left text-gray-400">Mandatory</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {lists.map((l) => (
              <tr key={l.id} className="hover:bg-gray-750">
                <td className="px-4 py-3 text-white">{l.name}</td>
                <td className="px-4 py-3 text-gray-300">{l.entries.toLocaleString()}</td>
                <td className="px-4 py-3 text-gray-400">{l.lastUpdated}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 text-xs rounded-full ${l.mandatory ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'}`}>
                    {l.mandatory ? 'Required' : 'Optional'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
