'use client';

import { logger } from "@/lib/logger";
import React, { useState, useCallback } from 'react';
import { lakehouseAPI, useLakehouseData } from '@/lib/api';

interface Corridor {
  id: string;
  sourceCountry: string;
  sourceCountryName: string;
  sourceCurrency: string;
  rails: string[];
  receivingBanks: string[];
  dailyVolumeUSD: number;
  avgSettlementMs: number;
  complianceLevel: string;
  isActive: boolean;
}

interface ReceivingBank {
  code: string;
  name: string;
  nipCode: string;
  swiftCode: string;
  dailyCapacity: number;
  status: string;
}

interface Transfer {
  id: string;
  externalRef: string;
  sourceRail: string;
  sourceCountry: string;
  sourceCountryName: string;
  sourceCurrency: string;
  sourceAmount: number;
  destAmount: number;
  fxRate: number;
  senderName: string;
  senderBank: string;
  beneficiaryName: string;
  beneficiaryBank: string;
  beneficiaryAcct: string;
  nipRef: string;
  status: string;
  complianceScore: number;
  screeningResult: string;
}

const corridors: Corridor[] = [
  { id: 'GB-NG', sourceCountry: 'GB', sourceCountryName: 'United Kingdom', sourceCurrency: 'GBP', rails: ['SWIFT', 'FASTER_PAY'], receivingBanks: ['ACCESS', 'GTB', 'ZENITH'], dailyVolumeUSD: 2_400_000, avgSettlementMs: 45000, complianceLevel: 'standard', isActive: true },
  { id: 'US-NG', sourceCountry: 'US', sourceCountryName: 'United States', sourceCurrency: 'USD', rails: ['SWIFT', 'ACH'], receivingBanks: ['ACCESS', 'GTB', 'ZENITH', 'UBA', 'FIRSTBANK'], dailyVolumeUSD: 5_800_000, avgSettlementMs: 120000, complianceLevel: 'enhanced', isActive: true },
  { id: 'CA-NG', sourceCountry: 'CA', sourceCountryName: 'Canada', sourceCurrency: 'CAD', rails: ['SWIFT'], receivingBanks: ['GTB', 'UBA'], dailyVolumeUSD: 890_000, avgSettlementMs: 180000, complianceLevel: 'standard', isActive: true },
  { id: 'GH-NG', sourceCountry: 'GH', sourceCountryName: 'Ghana', sourceCurrency: 'GHS', rails: ['PAPSS', 'MOBILE_MONEY'], receivingBanks: ['ACCESS', 'ZENITH'], dailyVolumeUSD: 450_000, avgSettlementMs: 8000, complianceLevel: 'standard', isActive: true },
  { id: 'KE-NG', sourceCountry: 'KE', sourceCountryName: 'Kenya', sourceCurrency: 'KES', rails: ['PAPSS'], receivingBanks: ['UBA', 'FIRSTBANK'], dailyVolumeUSD: 320_000, avgSettlementMs: 12000, complianceLevel: 'standard', isActive: true },
  { id: 'ZA-NG', sourceCountry: 'ZA', sourceCountryName: 'South Africa', sourceCurrency: 'ZAR', rails: ['SWIFT', 'PAPSS'], receivingBanks: ['ACCESS', 'GTB'], dailyVolumeUSD: 670_000, avgSettlementMs: 60000, complianceLevel: 'standard', isActive: true },
  { id: 'AE-NG', sourceCountry: 'AE', sourceCountryName: 'UAE', sourceCurrency: 'AED', rails: ['SWIFT'], receivingBanks: ['GTB', 'ZENITH', 'UBA'], dailyVolumeUSD: 1_200_000, avgSettlementMs: 90000, complianceLevel: 'enhanced', isActive: true },
  { id: 'CN-NG', sourceCountry: 'CN', sourceCountryName: 'China', sourceCurrency: 'CNY', rails: ['CIPS'], receivingBanks: ['ACCESS'], dailyVolumeUSD: 340_000, avgSettlementMs: 240000, complianceLevel: 'enhanced', isActive: true },
  { id: 'IN-NG', sourceCountry: 'IN', sourceCountryName: 'India', sourceCurrency: 'INR', rails: ['UPI'], receivingBanks: ['FIRSTBANK'], dailyVolumeUSD: 180_000, avgSettlementMs: 5000, complianceLevel: 'standard', isActive: true },
  { id: 'DE-NG', sourceCountry: 'DE', sourceCountryName: 'Germany', sourceCurrency: 'EUR', rails: ['SEPA', 'SWIFT'], receivingBanks: ['GTB', 'ZENITH'], dailyVolumeUSD: 780_000, avgSettlementMs: 35000, complianceLevel: 'standard', isActive: true },
  { id: 'FR-NG', sourceCountry: 'FR', sourceCountryName: 'France', sourceCurrency: 'EUR', rails: ['SEPA'], receivingBanks: ['ACCESS', 'UBA'], dailyVolumeUSD: 560_000, avgSettlementMs: 40000, complianceLevel: 'standard', isActive: true },
  { id: 'IT-NG', sourceCountry: 'IT', sourceCountryName: 'Italy', sourceCurrency: 'EUR', rails: ['SEPA'], receivingBanks: ['GTB'], dailyVolumeUSD: 420_000, avgSettlementMs: 45000, complianceLevel: 'standard', isActive: true },
];

const receivingBanks: ReceivingBank[] = [
  { code: 'ACCESS', name: 'Access Bank Plc', nipCode: '044', swiftCode: 'ABORNGLA', dailyCapacity: 50_000_000, status: 'active' },
  { code: 'GTB', name: 'Guaranty Trust Bank', nipCode: '058', swiftCode: 'GTBINGLA', dailyCapacity: 45_000_000, status: 'active' },
  { code: 'ZENITH', name: 'Zenith Bank Plc', nipCode: '057', swiftCode: 'ZELOIGLA', dailyCapacity: 48_000_000, status: 'active' },
  { code: 'UBA', name: 'United Bank for Africa', nipCode: '033', swiftCode: 'UNAFNGLA', dailyCapacity: 40_000_000, status: 'active' },
  { code: 'FIRSTBANK', name: 'First Bank of Nigeria', nipCode: '011', swiftCode: 'FBNINGLA', dailyCapacity: 42_000_000, status: 'active' },
];

const transfers: Transfer[] = [
  { id: 'INB-001', externalRef: 'SWIFT-GPI-20260501-001', sourceRail: 'SWIFT', sourceCountry: 'GB', sourceCountryName: 'United Kingdom', sourceCurrency: 'GBP', sourceAmount: 5000, destAmount: 9_750_000, fxRate: 1950, senderName: 'James Wilson', senderBank: 'Barclays UK', beneficiaryName: 'Adebayo Ogunlade', beneficiaryBank: 'Access Bank', beneficiaryAcct: '0044123456', nipRef: 'NIP-20260501-001', status: 'CREDITED', complianceScore: 12, screeningResult: 'CLEAR' },
  { id: 'INB-002', externalRef: 'SWIFT-GPI-20260501-002', sourceRail: 'SWIFT', sourceCountry: 'US', sourceCountryName: 'United States', sourceCurrency: 'USD', sourceAmount: 10000, destAmount: 15_200_000, fxRate: 1520, senderName: 'Michael Johnson', senderBank: 'Wells Fargo', beneficiaryName: 'Chioma Okafor', beneficiaryBank: 'GTBank', beneficiaryAcct: '0058234567', nipRef: 'NIP-20260501-002', status: 'CREDITED', complianceScore: 8, screeningResult: 'CLEAR' },
  { id: 'INB-003', externalRef: 'PAPSS-20260501-001', sourceRail: 'PAPSS', sourceCountry: 'GH', sourceCountryName: 'Ghana', sourceCurrency: 'GHS', sourceAmount: 15000, destAmount: 2_850_000, fxRate: 190, senderName: 'Kwame Mensah', senderBank: 'GCB Bank', beneficiaryName: 'Emeka Nwosu', beneficiaryBank: 'Zenith Bank', beneficiaryAcct: '0057345678', nipRef: 'NIP-20260501-003', status: 'CREDITED', complianceScore: 5, screeningResult: 'CLEAR' },
  { id: 'INB-004', externalRef: 'CIPS-20260501-001', sourceRail: 'CIPS', sourceCountry: 'CN', sourceCountryName: 'China', sourceCurrency: 'CNY', sourceAmount: 50000, destAmount: 10_640_000, fxRate: 212.8, senderName: 'Wei Zhang', senderBank: 'Bank of China', beneficiaryName: 'Ibrahim Musa', beneficiaryBank: 'Access Bank', beneficiaryAcct: '0044456789', nipRef: 'NIP-20260501-004', status: 'SCREENING_HELD', complianceScore: 68, screeningResult: 'HELD' },
  { id: 'INB-005', externalRef: 'UPI-20260501-001', sourceRail: 'UPI', sourceCountry: 'IN', sourceCountryName: 'India', sourceCurrency: 'INR', sourceAmount: 200000, destAmount: 3_648_000, fxRate: 18.24, senderName: 'Rajesh Patel', senderBank: 'SBI', beneficiaryName: 'Oluwaseun Adesanya', beneficiaryBank: 'First Bank', beneficiaryAcct: '0011567890', nipRef: 'NIP-20260501-005', status: 'CREDITED', complianceScore: 15, screeningResult: 'CLEAR' },
  { id: 'INB-006', externalRef: 'SEPA-20260501-001', sourceRail: 'SEPA', sourceCountry: 'DE', sourceCountryName: 'Germany', sourceCurrency: 'EUR', sourceAmount: 3000, destAmount: 4_920_000, fxRate: 1640, senderName: 'Hans Mueller', senderBank: 'Deutsche Bank', beneficiaryName: 'Fatima Bello', beneficiaryBank: 'UBA', beneficiaryAcct: '0033678901', nipRef: 'NIP-20260501-006', status: 'CREDITED', complianceScore: 10, screeningResult: 'CLEAR' },
  { id: 'INB-007', externalRef: 'SWIFT-GPI-20260501-003', sourceRail: 'SWIFT', sourceCountry: 'AE', sourceCountryName: 'UAE', sourceCurrency: 'AED', sourceAmount: 20000, destAmount: 8_280_000, fxRate: 414, senderName: 'Mohammed Al-Rashid', senderBank: 'Emirates NBD', beneficiaryName: 'Tunde Bakare', beneficiaryBank: 'GTBank', beneficiaryAcct: '0058789012', nipRef: 'NIP-20260501-007', status: 'FAILED', complianceScore: 22, screeningResult: 'CLEAR' },
  { id: 'INB-008', externalRef: 'PAPSS-20260501-002', sourceRail: 'PAPSS', sourceCountry: 'KE', sourceCountryName: 'Kenya', sourceCurrency: 'KES', sourceAmount: 100000, destAmount: 1_200_000, fxRate: 12, senderName: 'Wanjiku Kamau', senderBank: 'Equity Bank', beneficiaryName: 'Grace Adeyemi', beneficiaryBank: 'First Bank', beneficiaryAcct: '0011890123', nipRef: 'NIP-20260501-008', status: 'FX_CONVERSION', complianceScore: 7, screeningResult: 'CLEAR' },
];

type TabType = 'overview' | 'corridors' | 'banks' | 'transfers' | 'compliance' | 'rails';

export default function InboundRemittanceDashboard() {
  const fetcher = useCallback(() =>
    lakehouseAPI.fetch<{ corridors: Corridor[]; banks: ReceivingBank[]; transfers: Transfer[] }>('/api/v1/remittances/inbound')
      .then(d => ({ corridors: d.corridors, banks: d.banks, transfers: d.transfers }))
      .catch((err: unknown) => { logger.error("API fallback:", err); return { corridors, banks: receivingBanks, transfers }; }), []);
  const { data: apiData } = useLakehouseData(fetcher, 30000);
  const activeCorridors = apiData?.corridors || corridors;
  const activeBanks = apiData?.banks || receivingBanks;
  const activeTransfers = apiData?.transfers || transfers;
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  const totalDailyVolume = activeCorridors.reduce((s, c) => s + c.dailyVolumeUSD, 0);
  const creditedCount = activeTransfers.filter(t => t.status === 'CREDITED').length;
  const heldCount = activeTransfers.filter(t => t.status === 'SCREENING_HELD').length;
  const failedCount = activeTransfers.filter(t => t.status === 'FAILED').length;

  const tabs: { id: TabType; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'corridors', label: 'Corridors' },
    { id: 'banks', label: 'Receiving Banks' },
    { id: 'transfers', label: 'Transfers' },
    { id: 'compliance', label: 'Compliance' },
    { id: 'rails', label: 'Settlement Rails' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Inbound Remittance Platform</h1>
        <span className="px-3 py-1 text-xs font-medium rounded-full bg-green-500/20 text-green-400">
          Module Active
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Daily Inflow Volume" value={`$${(totalDailyVolume / 1e6).toFixed(1)}M`} change={12.4} />
        <MetricCard label="Active Corridors" value={String(activeCorridors.filter(c => c.isActive).length)} change={0} />
        <MetricCard label="Success Rate" value="98.5%" change={0.8} />
        <MetricCard label="Avg Settlement" value="42s" change={-3.1} />
      </div>

      <div className="border-b border-gray-700">
        <nav className="flex space-x-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'overview' && <OverviewTab corridors={activeCorridors} transfers={activeTransfers} banks={activeBanks} creditedCount={creditedCount} heldCount={heldCount} failedCount={failedCount} totalDailyVolume={totalDailyVolume} />}
      {activeTab === 'corridors' && <CorridorsTab corridors={activeCorridors} />}
      {activeTab === 'banks' && <BanksTab banks={activeBanks} />}
      {activeTab === 'transfers' && <TransfersTab transfers={activeTransfers} />}
      {activeTab === 'compliance' && <ComplianceTab transfers={activeTransfers} />}
      {activeTab === 'rails' && <RailsTab corridors={activeCorridors} />}
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

function OverviewTab({ corridors, transfers, banks, creditedCount, heldCount, failedCount, totalDailyVolume }: {
  corridors: Corridor[]; transfers: Transfer[]; banks: ReceivingBank[]; creditedCount: number; heldCount: number; failedCount: number; totalDailyVolume: number;
}) {
  const topCorridors = [...corridors].sort((a, b) => b.dailyVolumeUSD - a.dailyVolumeUSD).slice(0, 6);
  const maxVol = topCorridors[0]?.dailyVolumeUSD || 1;

  return (
    <div className="space-y-6">
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h3 className="text-lg font-medium text-white mb-4">Inbound Processing Pipeline</h3>
        <div className="flex items-center space-x-2 text-sm overflow-x-auto">
          {['Receive', 'Validate', 'Screen', 'FX Convert', 'NIP Credit', 'Reconcile', 'Settle'].map((step, i) => (
            <React.Fragment key={step}>
              <div className="flex-shrink-0 px-3 py-2 rounded bg-emerald-500/20 text-emerald-400 font-medium">
                {String.fromCharCode(65 + i)}. {step}
              </div>
              {i < 6 && <span className="text-gray-500 flex-shrink-0">→</span>}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <p className="text-sm text-gray-400">Credited</p>
          <p className="text-3xl font-bold text-green-400 mt-1">{creditedCount}</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <p className="text-sm text-gray-400">Held for Review</p>
          <p className="text-3xl font-bold text-yellow-400 mt-1">{heldCount}</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <p className="text-sm text-gray-400">Failed</p>
          <p className="text-3xl font-bold text-red-400 mt-1">{failedCount}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h3 className="text-lg font-medium text-white mb-4">Top Inbound Corridors (Daily USD)</h3>
          <div className="space-y-3">
            {topCorridors.map((c) => (
              <div key={c.id} className="flex items-center space-x-3">
                <span className="text-sm text-gray-300 w-16">{c.id}</span>
                <div className="flex-1 bg-gray-700 rounded-full h-2">
                  <div className="bg-emerald-500 rounded-full h-2" style={{ width: `${(c.dailyVolumeUSD / maxVol) * 100}%` }} />
                </div>
                <span className="text-sm text-gray-400 w-20 text-right">${(c.dailyVolumeUSD / 1e6).toFixed(1)}M</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h3 className="text-lg font-medium text-white mb-4">Receiving Bank Capacity</h3>
          <div className="space-y-2">
            {banks.map((b) => (
              <div key={b.code} className="flex items-center justify-between py-2">
                <div className="flex items-center space-x-2">
                  <div className={`w-2 h-2 rounded-full ${b.status === 'active' ? 'bg-green-400' : 'bg-yellow-400'}`} />
                  <span className="text-sm text-gray-300">{b.name}</span>
                </div>
                <div className="flex items-center space-x-4 text-xs text-gray-400">
                  <span>₦{(b.dailyCapacity / 1e6).toFixed(0)}M cap</span>
                  <span>{b.swiftCode}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CorridorsTab({ corridors }: { corridors: Corridor[] }) {
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-900">
          <tr>
            <th className="px-4 py-3 text-left text-gray-400">Corridor</th>
            <th className="px-4 py-3 text-left text-gray-400">Source Country</th>
            <th className="px-4 py-3 text-left text-gray-400">Currency</th>
            <th className="px-4 py-3 text-left text-gray-400">Rails</th>
            <th className="px-4 py-3 text-left text-gray-400">Daily Volume</th>
            <th className="px-4 py-3 text-left text-gray-400">Avg Settlement</th>
            <th className="px-4 py-3 text-left text-gray-400">Compliance</th>
            <th className="px-4 py-3 text-left text-gray-400">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-700">
          {corridors.map((c) => (
            <tr key={c.id} className="hover:bg-gray-750">
              <td className="px-4 py-3 text-white font-medium">{c.id}</td>
              <td className="px-4 py-3 text-gray-300">{c.sourceCountryName}</td>
              <td className="px-4 py-3 text-gray-300">{c.sourceCurrency}</td>
              <td className="px-4 py-3 text-gray-300">{c.rails.join(', ')}</td>
              <td className="px-4 py-3 text-gray-300">${(c.dailyVolumeUSD / 1e6).toFixed(1)}M</td>
              <td className="px-4 py-3 text-gray-300">{(c.avgSettlementMs / 1000).toFixed(0)}s</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-1 text-xs rounded-full ${
                  c.complianceLevel === 'enhanced' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'
                }`}>{c.complianceLevel}</span>
              </td>
              <td className="px-4 py-3">
                <span className={`px-2 py-1 text-xs rounded-full ${
                  c.isActive ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                }`}>{c.isActive ? 'active' : 'inactive'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BanksTab({ banks }: { banks: ReceivingBank[] }) {
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-900">
          <tr>
            <th className="px-4 py-3 text-left text-gray-400">Bank Code</th>
            <th className="px-4 py-3 text-left text-gray-400">Bank Name</th>
            <th className="px-4 py-3 text-left text-gray-400">NIP Code</th>
            <th className="px-4 py-3 text-left text-gray-400">SWIFT Code</th>
            <th className="px-4 py-3 text-left text-gray-400">Daily Capacity</th>
            <th className="px-4 py-3 text-left text-gray-400">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-700">
          {banks.map((b) => (
            <tr key={b.code} className="hover:bg-gray-750">
              <td className="px-4 py-3 text-white font-medium">{b.code}</td>
              <td className="px-4 py-3 text-gray-300">{b.name}</td>
              <td className="px-4 py-3 text-gray-400 font-mono">{b.nipCode}</td>
              <td className="px-4 py-3 text-gray-400 font-mono">{b.swiftCode}</td>
              <td className="px-4 py-3 text-gray-300">₦{(b.dailyCapacity / 1e6).toFixed(0)}M</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-1 text-xs rounded-full ${
                  b.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                }`}>{b.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TransfersTab({ transfers }: { transfers: Transfer[] }) {
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-900">
          <tr>
            <th className="px-4 py-3 text-left text-gray-400">Transfer ID</th>
            <th className="px-4 py-3 text-left text-gray-400">Sender</th>
            <th className="px-4 py-3 text-left text-gray-400">Beneficiary</th>
            <th className="px-4 py-3 text-left text-gray-400">Rail</th>
            <th className="px-4 py-3 text-left text-gray-400">Source</th>
            <th className="px-4 py-3 text-left text-gray-400">Dest (₦)</th>
            <th className="px-4 py-3 text-left text-gray-400">FX Rate</th>
            <th className="px-4 py-3 text-left text-gray-400">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-700">
          {transfers.map((t) => (
            <tr key={t.id} className="hover:bg-gray-750">
              <td className="px-4 py-3 text-emerald-400 font-mono text-xs">{t.id}</td>
              <td className="px-4 py-3 text-gray-300">{t.senderName} ({t.sourceCountry})</td>
              <td className="px-4 py-3 text-gray-300">{t.beneficiaryName}</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-1 text-xs rounded-full font-medium ${
                  t.sourceRail === 'SWIFT' ? 'bg-blue-600/20 text-blue-400' :
                  t.sourceRail === 'PAPSS' ? 'bg-green-600/20 text-green-400' :
                  t.sourceRail === 'CIPS' ? 'bg-red-600/20 text-red-400' :
                  t.sourceRail === 'UPI' ? 'bg-orange-600/20 text-orange-400' :
                  t.sourceRail === 'SEPA' ? 'bg-indigo-600/20 text-indigo-400' :
                  'bg-gray-600/20 text-gray-400'
                }`}>{t.sourceRail}</span>
              </td>
              <td className="px-4 py-3 text-gray-300">{t.sourceCurrency} {t.sourceAmount.toLocaleString()}</td>
              <td className="px-4 py-3 text-gray-300">₦{t.destAmount.toLocaleString()}</td>
              <td className="px-4 py-3 text-gray-400 text-xs">{t.fxRate}</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-1 text-xs rounded-full ${
                  t.status === 'CREDITED' ? 'bg-green-500/20 text-green-400' :
                  t.status === 'SCREENING_HELD' ? 'bg-yellow-500/20 text-yellow-400' :
                  t.status === 'FAILED' ? 'bg-red-500/20 text-red-400' :
                  t.status === 'FX_CONVERSION' ? 'bg-purple-500/20 text-purple-400' :
                  'bg-blue-500/20 text-blue-400'
                }`}>{t.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComplianceTab({ transfers }: { transfers: Transfer[] }) {
  const clearCount = transfers.filter(t => t.screeningResult === 'CLEAR').length;
  const heldCount = transfers.filter(t => t.screeningResult === 'HELD').length;
  const enhancedCorridors = corridors.filter(c => c.complianceLevel === 'enhanced');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard label="Total Screened" value={String(transfers.length)} change={5.2} />
        <MetricCard label="Cleared" value={String(clearCount)} change={3.1} />
        <MetricCard label="Held for Review" value={String(heldCount)} change={0} />
        <MetricCard label="Avg Compliance Score" value={`${(transfers.reduce((s, t) => s + t.complianceScore, 0) / transfers.length).toFixed(0)}`} change={-2.3} />
      </div>

      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h3 className="text-lg font-medium text-white mb-4">Enhanced Due Diligence Corridors</h3>
        <div className="space-y-2">
          {enhancedCorridors.map(c => (
            <div key={c.id} className="flex items-center justify-between py-2 border-b border-gray-700 last:border-0">
              <div className="flex items-center space-x-3">
                <span className="text-white font-medium">{c.id}</span>
                <span className="text-sm text-gray-400">{c.sourceCountryName}</span>
              </div>
              <div className="flex items-center space-x-3">
                <span className="px-2 py-1 text-xs rounded-full bg-purple-500/20 text-purple-400">Enhanced</span>
                <span className="text-xs text-gray-400">{c.rails.join(', ')}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-900">
            <tr>
              <th className="px-4 py-3 text-left text-gray-400">Transfer</th>
              <th className="px-4 py-3 text-left text-gray-400">Sender</th>
              <th className="px-4 py-3 text-left text-gray-400">Origin</th>
              <th className="px-4 py-3 text-left text-gray-400">Amount</th>
              <th className="px-4 py-3 text-left text-gray-400">Score</th>
              <th className="px-4 py-3 text-left text-gray-400">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {transfers.map(t => (
              <tr key={t.id} className="hover:bg-gray-750">
                <td className="px-4 py-3 text-emerald-400 font-mono text-xs">{t.id}</td>
                <td className="px-4 py-3 text-gray-300">{t.senderName}</td>
                <td className="px-4 py-3 text-gray-300">{t.sourceCountryName}</td>
                <td className="px-4 py-3 text-gray-300">{t.sourceCurrency} {t.sourceAmount.toLocaleString()}</td>
                <td className="px-4 py-3">
                  <span className={`font-medium ${t.complianceScore > 50 ? 'text-red-400' : t.complianceScore > 20 ? 'text-yellow-400' : 'text-green-400'}`}>
                    {t.complianceScore}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 text-xs rounded-full ${
                    t.screeningResult === 'CLEAR' ? 'bg-green-500/20 text-green-400' :
                    t.screeningResult === 'HELD' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-blue-500/20 text-blue-400'
                  }`}>{t.screeningResult}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RailsTab({ corridors }: { corridors: Corridor[] }) {
  const railStats = new Map<string, { corridorCount: number; totalVolume: number; avgSettlement: number; corridorList: string[] }>();
  for (const c of corridors) {
    for (const rail of c.rails) {
      const existing = railStats.get(rail) || { corridorCount: 0, totalVolume: 0, avgSettlement: 0, corridorList: [] };
      existing.corridorCount++;
      existing.totalVolume += c.dailyVolumeUSD;
      existing.avgSettlement = (existing.avgSettlement * (existing.corridorCount - 1) + c.avgSettlementMs) / existing.corridorCount;
      existing.corridorList.push(c.id);
      railStats.set(rail, existing);
    }
  }

  const railDescriptions: Record<string, { fullName: string; region: string; speed: string }> = {
    'SWIFT': { fullName: 'SWIFT GPI', region: 'Global', speed: '1-4 hours' },
    'PAPSS': { fullName: 'Pan-African Payment & Settlement System', region: 'Africa', speed: '< 2 minutes' },
    'SEPA': { fullName: 'Single Euro Payments Area', region: 'Europe', speed: '< 1 minute' },
    'ACH': { fullName: 'Automated Clearing House', region: 'United States', speed: '1-3 hours' },
    'CIPS': { fullName: 'Cross-border Interbank Payment System', region: 'China', speed: '4-6 hours' },
    'UPI': { fullName: 'Unified Payments Interface', region: 'India', speed: '< 10 seconds' },
    'FASTER_PAY': { fullName: 'UK Faster Payments', region: 'United Kingdom', speed: '< 2 hours' },
    'MOBILE_MONEY': { fullName: 'Mobile Money Interop', region: 'Africa', speed: '< 30 seconds' },
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Active Rails" value={String(railStats.size)} change={0} />
        <MetricCard label="Total Daily Volume" value={`$${(Array.from(railStats.values()).reduce((s, r) => s + r.totalVolume, 0) / 1e6 / 2).toFixed(1)}M`} change={8.5} />
        <MetricCard label="Fastest Rail" value="UPI (5s)" change={0} />
        <MetricCard label="Most Corridors" value="SWIFT (7)" change={0} />
      </div>

      <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-900">
            <tr>
              <th className="px-4 py-3 text-left text-gray-400">Rail</th>
              <th className="px-4 py-3 text-left text-gray-400">Full Name</th>
              <th className="px-4 py-3 text-left text-gray-400">Region</th>
              <th className="px-4 py-3 text-left text-gray-400">Speed</th>
              <th className="px-4 py-3 text-left text-gray-400">Corridors</th>
              <th className="px-4 py-3 text-left text-gray-400">Daily Volume</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {Array.from(railStats.entries()).sort((a, b) => b[1].totalVolume - a[1].totalVolume).map(([rail, stats]) => {
              const desc = railDescriptions[rail] || { fullName: rail, region: 'N/A', speed: 'N/A' };
              return (
                <tr key={rail} className="hover:bg-gray-750">
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full font-medium ${
                      rail === 'SWIFT' ? 'bg-blue-600/20 text-blue-400' :
                      rail === 'PAPSS' ? 'bg-green-600/20 text-green-400' :
                      rail === 'SEPA' ? 'bg-indigo-600/20 text-indigo-400' :
                      rail === 'CIPS' ? 'bg-red-600/20 text-red-400' :
                      rail === 'UPI' ? 'bg-orange-600/20 text-orange-400' :
                      rail === 'ACH' ? 'bg-gray-600/20 text-gray-400' :
                      rail === 'FASTER_PAY' ? 'bg-purple-600/20 text-purple-400' :
                      'bg-yellow-600/20 text-yellow-400'
                    }`}>{rail}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{desc.fullName}</td>
                  <td className="px-4 py-3 text-gray-400">{desc.region}</td>
                  <td className="px-4 py-3 text-gray-300">{desc.speed}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{stats.corridorList.join(', ')}</td>
                  <td className="px-4 py-3 text-gray-300">${(stats.totalVolume / 1e6).toFixed(1)}M</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
