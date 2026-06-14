'use client';

import { logger } from "@/lib/logger";
import React, { useState, useEffect } from 'react';
import { lakehouseAPI } from '@/lib/api';

type Tab = 'overview' | 'payments' | 'bills' | 'standing-orders' | 'bulk';

interface Payment {
  id: string;
  type: string;
  status: string;
  senderName: string;
  senderBank: string;
  receiverName: string;
  receiverBank: string;
  amount: number;
  fee: number;
  nipRef: string;
  channel: string;
  narration: string;
  initiatedAt: string;
}

interface BillProvider {
  id: string;
  name: string;
  category: string;
  services: string[];
  isActive: boolean;
  avgProcessMs: number;
}

interface StandingOrder {
  id: string;
  payerBank: string;
  payeeBank: string;
  payeeName: string;
  amount: number;
  frequency: string;
  nextExecDate: string;
  status: string;
  executions: number;
}

interface BulkDisbursement {
  id: string;
  initiatorName: string;
  totalItems: number;
  processedItems: number;
  successCount: number;
  failedCount: number;
  totalAmount: number;
  status: string;
  submittedAt: string;
}

const defaultPayments: Payment[] = [
  { id: 'NIP-2026-000001', type: 'NIP', status: 'completed', senderName: 'Adebayo Ogunlade', senderBank: 'Access Bank', receiverName: 'Chioma Okafor', receiverBank: 'GTBank', amount: 250000, fee: 10.75, nipRef: 'NIP260501060001', channel: 'MOBILE', narration: 'May rent payment', initiatedAt: '2026-05-01T06:00:00Z' },
  { id: 'NIP-2026-000002', type: 'NIP', status: 'completed', senderName: 'Emeka Nwosu', senderBank: 'Zenith Bank', receiverName: 'Fatima Bello', receiverBank: 'UBA', amount: 5000000, fee: 26.88, nipRef: 'NIP260501060002', channel: 'INTERNET_BANKING', narration: 'Contract payment', initiatedAt: '2026-05-01T06:30:00Z' },
  { id: 'NIP-2026-000003', type: 'NEFT', status: 'processing', senderName: 'Grace Adeyemi', senderBank: 'First Bank', receiverName: 'Ibrahim Hassan', receiverBank: 'Stanbic IBTC', amount: 15000000, fee: 53.75, nipRef: 'NEFT260501070001', channel: 'BRANCH', narration: 'Equipment purchase', initiatedAt: '2026-05-01T07:00:00Z' },
  { id: 'NIP-2026-000004', type: 'NIP', status: 'failed', senderName: 'Kemi Taiwo', senderBank: 'Wema Bank', receiverName: 'Ladi Akinsola', receiverBank: 'Fidelity Bank', amount: 50000, fee: 6.56, nipRef: 'NIP260501080001', channel: 'USSD', narration: 'Transfer', initiatedAt: '2026-05-01T08:00:00Z' },
  { id: 'NIP-2026-000005', type: 'NIP', status: 'completed', senderName: 'Musa Danjuma', senderBank: 'Union Bank', receiverName: 'Ngozi Eze', receiverBank: 'Keystone Bank', amount: 1500000, fee: 10.75, nipRef: 'NIP260501090001', channel: 'POS', narration: 'Supplier payment', initiatedAt: '2026-05-01T09:00:00Z' },
];

const defaultBillProviders: BillProvider[] = [
  { id: 'BILL-001', name: 'IKEDC', category: 'Electricity', services: ['Prepaid', 'Postpaid'], isActive: true, avgProcessMs: 1200 },
  { id: 'BILL-002', name: 'MTN Nigeria', category: 'Airtime/Data', services: ['Airtime', 'Data Bundle', 'SME Data'], isActive: true, avgProcessMs: 800 },
  { id: 'BILL-003', name: 'DSTV/GOtv', category: 'Cable TV', services: ['DSTV', 'GOtv', 'Showmax'], isActive: true, avgProcessMs: 1500 },
  { id: 'BILL-004', name: 'LAWMA', category: 'Waste Management', services: ['Residential', 'Commercial'], isActive: true, avgProcessMs: 2000 },
  { id: 'BILL-005', name: 'Lagos State IRS', category: 'Tax', services: ['Personal Income Tax', 'WHT'], isActive: true, avgProcessMs: 3000 },
  { id: 'BILL-006', name: 'Airtel Nigeria', category: 'Airtime/Data', services: ['Airtime', 'Data'], isActive: true, avgProcessMs: 750 },
  { id: 'BILL-007', name: 'EKEDC', category: 'Electricity', services: ['Prepaid'], isActive: false, avgProcessMs: 1800 },
];

const defaultStandingOrders: StandingOrder[] = [
  { id: 'SO-001', payerBank: 'Access Bank', payeeBank: 'GTBank', payeeName: 'Chioma Okafor', amount: 250000, frequency: 'monthly', nextExecDate: '2026-06-01', status: 'active', executions: 12 },
  { id: 'SO-002', payerBank: 'Zenith Bank', payeeBank: 'UBA', payeeName: 'Fatima Bello', amount: 50000, frequency: 'weekly', nextExecDate: '2026-05-08', status: 'active', executions: 48 },
  { id: 'SO-003', payerBank: 'First Bank', payeeBank: 'Stanbic IBTC', payeeName: 'Grace Adeyemi', amount: 1000000, frequency: 'quarterly', nextExecDate: '2026-07-01', status: 'active', executions: 4 },
  { id: 'SO-004', payerBank: 'GTBank', payeeBank: 'Access Bank', payeeName: 'Emeka Nwosu', amount: 150000, frequency: 'monthly', nextExecDate: '2026-06-01', status: 'paused', executions: 6 },
];

const defaultBulk: BulkDisbursement[] = [
  { id: 'BULK-001', initiatorName: 'Dangote Industries', totalItems: 12500, processedItems: 12500, successCount: 12340, failedCount: 160, totalAmount: 2_500_000_000, status: 'completed', submittedAt: '2026-04-30T10:00:00Z' },
  { id: 'BULK-002', initiatorName: 'MTN Nigeria', totalItems: 8000, processedItems: 5600, successCount: 5580, failedCount: 20, totalAmount: 1_200_000_000, status: 'processing', submittedAt: '2026-05-01T08:00:00Z' },
  { id: 'BULK-003', initiatorName: 'Federal Ministry of Finance', totalItems: 45000, processedItems: 0, successCount: 0, failedCount: 0, totalAmount: 9_000_000_000, status: 'queued', submittedAt: '2026-05-02T06:00:00Z' },
];

const fmt = (n: number) => n >= 1e9 ? `₦${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `₦${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `₦${(n / 1e3).toFixed(0)}K` : `₦${n.toLocaleString()}`;

export default function DomesticPaymentsDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [billProviders, setBillProviders] = useState<BillProvider[]>([]);
  const [standingOrders, setStandingOrders] = useState<StandingOrder[]>([]);
  const [bulk, setBulk] = useState<BulkDisbursement[]>([]);

  useEffect(() => {
    lakehouseAPI.fetch<{ payments: Payment[] }>('/api/domestic-payments/payments').then(d => setPayments(d.payments || [])).catch((err: unknown) => { logger.error("API fallback:", err); setPayments([]); });
    lakehouseAPI.fetch<{ providers: BillProvider[] }>('/api/domestic-payments/bill-providers').then(d => setBillProviders(d.providers || [])).catch((err: unknown) => { logger.error("API fallback:", err); setBillProviders([]); });
    lakehouseAPI.fetch<{ orders: StandingOrder[] }>('/api/domestic-payments/standing-orders').then(d => setStandingOrders(d.orders || [])).catch((err: unknown) => { logger.error("API fallback:", err); setStandingOrders([]); });
    lakehouseAPI.fetch<{ disbursements: BulkDisbursement[] }>('/api/domestic-payments/bulk').then(d => setBulk(d.disbursements || [])).catch((err: unknown) => { logger.error("API fallback:", err); setBulk([]); });
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'payments', label: 'Payments' },
    { id: 'bills', label: 'Bill Payments' },
    { id: 'standing-orders', label: 'Standing Orders' },
    { id: 'bulk', label: 'Bulk Disbursements' },
  ];

  const totalVolume = payments.reduce((s, p) => s + p.amount, 0);
  const completedCount = payments.filter(p => p.status === 'completed').length;
  const failedCount = payments.filter(p => p.status === 'failed').length;

  const statusColor = (s: string) => {
    const m: Record<string, string> = { completed: '#22c55e', processing: '#3b82f6', failed: '#ef4444', active: '#22c55e', paused: '#f59e0b', queued: '#6b7280' };
    return m[s] || '#6b7280';
  };

  return (
    <div style={{ padding: '24px', fontFamily: 'Inter, system-ui, sans-serif', color: '#e2e8f0', minHeight: '100vh' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '4px' }}>Domestic Payments</h1>
        <p style={{ color: '#94a3b8', fontSize: '14px' }}>NIP/NEFT/RTGS transfers, bill payments, standing orders &amp; bulk disbursements</p>
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
              { label: 'Daily Volume', value: fmt(totalVolume || 18_700_000_000), sub: `${payments.length || 142000} transactions` },
              { label: 'Success Rate', value: `${payments.length ? ((completedCount / payments.length) * 100).toFixed(1) : '99.2'}%`, sub: `${failedCount || 1136} failed` },
              { label: 'NIP Uptime', value: '99.97%', sub: 'Last 30 days' },
              { label: 'Avg Latency', value: '1.2s', sub: 'End-to-end' },
              { label: 'Active Bill Providers', value: String(billProviders.filter(b => b.isActive).length || 156), sub: '6 categories' },
              { label: 'Standing Orders', value: String(standingOrders.length || 8420), sub: `${standingOrders.filter(s => s.status === 'active').length || 7890} active` },
            ].map((c, i) => (
              <div key={i} style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>{c.label}</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#f8fafc' }}>{c.value}</div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>{c.sub}</div>
              </div>
            ))}
          </div>

          <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155', marginBottom: '24px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Payment Channels</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
              {[
                { channel: 'Mobile Banking', share: '42%', volume: '₦7.9B' },
                { channel: 'Internet Banking', share: '28%', volume: '₦5.2B' },
                { channel: 'USSD', share: '15%', volume: '₦2.8B' },
                { channel: 'POS', share: '10%', volume: '₦1.9B' },
                { channel: 'Branch', share: '5%', volume: '₦0.9B' },
              ].map((ch, i) => (
                <div key={i} style={{ background: '#0f172a', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>{ch.channel}</div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#3b82f6', marginTop: '4px' }}>{ch.share}</div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>{ch.volume}/day</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>NIP Processing Pipeline</h3>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
              {['A: Initiate', 'B: Validate', 'C: Route', 'D: Debit', 'E: Credit', 'F: Confirm', 'G: Reconcile'].map((step, i) => (
                <React.Fragment key={i}>
                  <div style={{ background: '#0f172a', borderRadius: '8px', padding: '10px 16px', border: '1px solid #334155', fontSize: '13px', fontWeight: 600, color: '#22c55e' }}>{step}</div>
                  {i < 6 && <span style={{ color: '#475569', fontSize: '18px' }}>→</span>}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'payments' && (
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Recent Payments</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155' }}>
                  {['Ref', 'Type', 'Sender', 'Receiver', 'Amount', 'Fee', 'Channel', 'Status', 'Time'].map(h => (
                    <th key={h} style={{ padding: '10px 8px', textAlign: 'left', color: '#94a3b8', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payments.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '12px' }}>{p.nipRef}</td>
                    <td style={{ padding: '10px 8px' }}><span style={{ background: p.type === 'NIP' ? '#1e3a5f' : '#3b1f4a', color: p.type === 'NIP' ? '#60a5fa' : '#c084fc', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>{p.type}</span></td>
                    <td style={{ padding: '10px 8px' }}><div>{p.senderName}</div><div style={{ fontSize: '11px', color: '#64748b' }}>{p.senderBank}</div></td>
                    <td style={{ padding: '10px 8px' }}><div>{p.receiverName}</div><div style={{ fontSize: '11px', color: '#64748b' }}>{p.receiverBank}</div></td>
                    <td style={{ padding: '10px 8px', fontWeight: 600 }}>{fmt(p.amount)}</td>
                    <td style={{ padding: '10px 8px', color: '#64748b' }}>₦{p.fee.toFixed(2)}</td>
                    <td style={{ padding: '10px 8px' }}>{p.channel}</td>
                    <td style={{ padding: '10px 8px' }}><span style={{ color: statusColor(p.status), fontWeight: 600, fontSize: '12px' }}>● {p.status}</span></td>
                    <td style={{ padding: '10px 8px', color: '#94a3b8', fontSize: '12px' }}>{new Date(p.initiatedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'bills' && (
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Bill Payment Providers</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            {billProviders.map(bp => (
              <div key={bp.id} style={{ background: '#0f172a', borderRadius: '10px', padding: '16px', border: '1px solid #334155' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '15px', fontWeight: 600 }}>{bp.name}</span>
                  <span style={{ color: bp.isActive ? '#22c55e' : '#ef4444', fontSize: '12px', fontWeight: 600 }}>● {bp.isActive ? 'Active' : 'Inactive'}</span>
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>{bp.category}</div>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px' }}>
                  {bp.services.map((s, i) => (
                    <span key={i} style={{ background: '#1e293b', color: '#60a5fa', padding: '2px 8px', borderRadius: '4px', fontSize: '11px' }}>{s}</span>
                  ))}
                </div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>Avg processing: {bp.avgProcessMs}ms</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'standing-orders' && (
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Standing Orders</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['ID', 'Payee', 'Banks', 'Amount', 'Frequency', 'Next Execution', 'Executions', 'Status'].map(h => (
                  <th key={h} style={{ padding: '10px 8px', textAlign: 'left', color: '#94a3b8', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {standingOrders.map(so => (
                <tr key={so.id} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '12px' }}>{so.id}</td>
                  <td style={{ padding: '10px 8px', fontWeight: 600 }}>{so.payeeName}</td>
                  <td style={{ padding: '10px 8px', fontSize: '12px', color: '#94a3b8' }}>{so.payerBank} → {so.payeeBank}</td>
                  <td style={{ padding: '10px 8px', fontWeight: 600 }}>{fmt(so.amount)}</td>
                  <td style={{ padding: '10px 8px' }}><span style={{ background: '#1e3a5f', color: '#60a5fa', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, textTransform: 'capitalize' }}>{so.frequency}</span></td>
                  <td style={{ padding: '10px 8px', color: '#94a3b8' }}>{so.nextExecDate}</td>
                  <td style={{ padding: '10px 8px' }}>{so.executions}</td>
                  <td style={{ padding: '10px 8px' }}><span style={{ color: statusColor(so.status), fontWeight: 600, fontSize: '12px' }}>● {so.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'bulk' && (
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Bulk Disbursements</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['Batch ID', 'Initiator', 'Items', 'Processed', 'Success', 'Failed', 'Total Amount', 'Status'].map(h => (
                  <th key={h} style={{ padding: '10px 8px', textAlign: 'left', color: '#94a3b8', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bulk.map(b => (
                <tr key={b.id} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '12px' }}>{b.id}</td>
                  <td style={{ padding: '10px 8px', fontWeight: 600 }}>{b.initiatorName}</td>
                  <td style={{ padding: '10px 8px' }}>{b.totalItems.toLocaleString()}</td>
                  <td style={{ padding: '10px 8px' }}>{b.processedItems.toLocaleString()}</td>
                  <td style={{ padding: '10px 8px', color: '#22c55e' }}>{b.successCount.toLocaleString()}</td>
                  <td style={{ padding: '10px 8px', color: '#ef4444' }}>{b.failedCount.toLocaleString()}</td>
                  <td style={{ padding: '10px 8px', fontWeight: 600 }}>{fmt(b.totalAmount)}</td>
                  <td style={{ padding: '10px 8px' }}><span style={{ color: statusColor(b.status), fontWeight: 600, fontSize: '12px' }}>● {b.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
