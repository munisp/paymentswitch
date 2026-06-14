'use client';

import { logger } from "@/lib/logger";
import React, { useState, useEffect } from 'react';
import { lakehouseAPI } from '@/lib/api';

type Tab = 'overview' | 'cards' | 'transactions' | 'chargebacks' | 'terminals';

interface IssuedCard {
  id: string;
  last4: string;
  scheme: string;
  type: string;
  issuerBankName: string;
  holderName: string;
  expiryMonth: number;
  expiryYear: number;
  status: string;
  dailyLimit: number;
  is3DSEnrolled: boolean;
}

interface CardTransaction {
  id: string;
  authCode: string;
  rrn: string;
  type: string;
  cardLast4: string;
  scheme: string;
  merchantName: string;
  merchantCategory: string;
  channel: string;
  amount: number;
  feeAmount: number;
  status: string;
  declineReason: string;
  is3DSVerified: boolean;
  riskScore: number;
  processedAt: string;
}

interface Chargeback {
  id: string;
  transactionId: string;
  originalAmount: number;
  disputeAmount: number;
  reasonCode: string;
  reasonDesc: string;
  cardholderName: string;
  merchantName: string;
  status: string;
  filedAt: string;
  dueDate: string;
}

interface MerchantTerminal {
  id: string;
  terminalId: string;
  merchantName: string;
  mcc: string;
  mccDescription: string;
  location: string;
  type: string;
  acquirerBank: string;
  status: string;
  dailyVolume: number;
}

const defaultCards: IssuedCard[] = [
  { id: 'CRD-001', last4: '4532', scheme: 'VISA', type: 'DEBIT', issuerBankName: 'Access Bank', holderName: 'Adebayo Ogunlade', expiryMonth: 12, expiryYear: 2028, status: 'active', dailyLimit: 5000000, is3DSEnrolled: true },
  { id: 'CRD-002', last4: '8891', scheme: 'MASTERCARD', type: 'CREDIT', issuerBankName: 'GTBank', holderName: 'Chioma Okafor', expiryMonth: 8, expiryYear: 2027, status: 'active', dailyLimit: 10000000, is3DSEnrolled: true },
  { id: 'CRD-003', last4: '2245', scheme: 'VERVE', type: 'DEBIT', issuerBankName: 'Zenith Bank', holderName: 'Emeka Nwosu', expiryMonth: 3, expiryYear: 2029, status: 'active', dailyLimit: 2000000, is3DSEnrolled: true },
  { id: 'CRD-004', last4: '6678', scheme: 'VISA', type: 'VIRTUAL', issuerBankName: 'UBA', holderName: 'Fatima Bello', expiryMonth: 6, expiryYear: 2027, status: 'active', dailyLimit: 1000000, is3DSEnrolled: true },
  { id: 'CRD-005', last4: '1123', scheme: 'MASTERCARD', type: 'PREPAID', issuerBankName: 'First Bank', holderName: 'Grace Adeyemi', expiryMonth: 9, expiryYear: 2028, status: 'blocked', dailyLimit: 500000, is3DSEnrolled: false },
];

const defaultTransactions: CardTransaction[] = [
  { id: 'CTX-001', authCode: 'A12345', rrn: '260501000001', type: 'PURCHASE', cardLast4: '4532', scheme: 'VISA', merchantName: 'Shoprite Ikeja', merchantCategory: 'Grocery', channel: 'POS', amount: 45000, feeAmount: 100, status: 'approved', declineReason: '', is3DSVerified: true, riskScore: 12, processedAt: '2026-05-01T10:00:00Z' },
  { id: 'CTX-002', authCode: 'B67890', rrn: '260501000002', type: 'PURCHASE', cardLast4: '8891', scheme: 'MASTERCARD', merchantName: 'Amazon.com', merchantCategory: 'E-Commerce', channel: 'WEB', amount: 250000, feeAmount: 250, status: 'approved', declineReason: '', is3DSVerified: true, riskScore: 25, processedAt: '2026-05-01T11:00:00Z' },
  { id: 'CTX-003', authCode: '', rrn: '260501000003', type: 'PURCHASE', cardLast4: '2245', scheme: 'VERVE', merchantName: 'Total Filling Station', merchantCategory: 'Fuel', channel: 'POS', amount: 30000, feeAmount: 75, status: 'declined', declineReason: 'Insufficient funds', is3DSVerified: false, riskScore: 8, processedAt: '2026-05-01T12:00:00Z' },
  { id: 'CTX-004', authCode: 'C11111', rrn: '260501000004', type: 'WITHDRAWAL', cardLast4: '4532', scheme: 'VISA', merchantName: 'Access Bank ATM Lekki', merchantCategory: 'ATM', channel: 'ATM', amount: 100000, feeAmount: 65, status: 'approved', declineReason: '', is3DSVerified: false, riskScore: 5, processedAt: '2026-05-01T13:00:00Z' },
  { id: 'CTX-005', authCode: 'D22222', rrn: '260501000005', type: 'PURCHASE', cardLast4: '6678', scheme: 'VISA', merchantName: 'Netflix', merchantCategory: 'Streaming', channel: 'WEB', amount: 6500, feeAmount: 50, status: 'approved', declineReason: '', is3DSVerified: true, riskScore: 3, processedAt: '2026-05-01T14:00:00Z' },
];

const defaultChargebacks: Chargeback[] = [
  { id: 'CB-001', transactionId: 'CTX-100', originalAmount: 150000, disputeAmount: 150000, reasonCode: '4837', reasonDesc: 'No Cardholder Authorization', cardholderName: 'Adebayo Ogunlade', merchantName: 'QuickMart Online', status: 'under_review', filedAt: '2026-04-28', dueDate: '2026-05-28' },
  { id: 'CB-002', transactionId: 'CTX-101', originalAmount: 85000, disputeAmount: 85000, reasonCode: '4853', reasonDesc: 'Goods Not Received', cardholderName: 'Chioma Okafor', merchantName: 'Lagos Electronics', status: 'escalated', filedAt: '2026-04-25', dueDate: '2026-05-25' },
  { id: 'CB-003', transactionId: 'CTX-102', originalAmount: 500000, disputeAmount: 250000, reasonCode: '4855', reasonDesc: 'Defective Merchandise', cardholderName: 'Emeka Nwosu', merchantName: 'AutoParts NG', status: 'resolved_merchant', filedAt: '2026-04-20', dueDate: '2026-05-20' },
];

const defaultTerminals: MerchantTerminal[] = [
  { id: 'TRM-001', terminalId: '2044ACCS0001', merchantName: 'Shoprite Ikeja City Mall', mcc: '5411', mccDescription: 'Grocery Stores', location: 'Ikeja, Lagos', type: 'POS', acquirerBank: 'Access Bank', status: 'active', dailyVolume: 450 },
  { id: 'TRM-002', terminalId: '2058GTB00002', merchantName: 'Chicken Republic V/I', mcc: '5812', mccDescription: 'Eating Places/Restaurants', location: 'Victoria Island, Lagos', type: 'POS', acquirerBank: 'GTBank', status: 'active', dailyVolume: 320 },
  { id: 'TRM-003', terminalId: '2057ZEN00003', merchantName: 'NNPC Retail Station Lekki', mcc: '5541', mccDescription: 'Service Stations', location: 'Lekki, Lagos', type: 'POS', acquirerBank: 'Zenith Bank', status: 'active', dailyVolume: 280 },
  { id: 'TRM-004', terminalId: '2033FBN00004', merchantName: 'Konga Warehouse', mcc: '5999', mccDescription: 'Miscellaneous Retail', location: 'Agidingbi, Lagos', type: 'mPOS', acquirerBank: 'First Bank', status: 'active', dailyVolume: 180 },
  { id: 'TRM-005', terminalId: '2044ACCS0005', merchantName: 'Total Filling Station Ajah', mcc: '5541', mccDescription: 'Service Stations', location: 'Ajah, Lagos', type: 'POS', acquirerBank: 'Access Bank', status: 'maintenance', dailyVolume: 0 },
];

const fmt = (n: number) => n >= 1e9 ? `₦${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `₦${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `₦${(n / 1e3).toFixed(0)}K` : `₦${n.toLocaleString()}`;

export default function CardProcessingDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [cards, setCards] = useState<IssuedCard[]>([]);
  const [transactions, setTransactions] = useState<CardTransaction[]>([]);
  const [chargebacks, setChargebacks] = useState<Chargeback[]>([]);
  const [terminals, setTerminals] = useState<MerchantTerminal[]>([]);

  useEffect(() => {
    lakehouseAPI.fetch<{ cards: IssuedCard[] }>('/api/card-processing/cards').then(d => setCards(d.cards || [])).catch((err: unknown) => { logger.error("API fallback:", err); setCards([]); });
    lakehouseAPI.fetch<{ transactions: CardTransaction[] }>('/api/card-processing/transactions').then(d => setTransactions(d.transactions || [])).catch((err: unknown) => { logger.error("API fallback:", err); setTransactions([]); });
    lakehouseAPI.fetch<{ chargebacks: Chargeback[] }>('/api/card-processing/chargebacks').then(d => setChargebacks(d.chargebacks || [])).catch((err: unknown) => { logger.error("API fallback:", err); setChargebacks([]); });
    lakehouseAPI.fetch<{ terminals: MerchantTerminal[] }>('/api/card-processing/terminals').then(d => setTerminals(d.terminals || [])).catch((err: unknown) => { logger.error("API fallback:", err); setTerminals([]); });
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'cards', label: 'Cards' },
    { id: 'transactions', label: 'Transactions' },
    { id: 'chargebacks', label: 'Chargebacks' },
    { id: 'terminals', label: 'Terminals' },
  ];

  const schemeColor = (s: string): string => {
    const m: Record<string, string> = { VISA: '#1a1f71', MASTERCARD: '#eb001b', VERVE: '#00425f' };
    return m[s] || '#6b7280';
  };

  const statusColor = (s: string) => {
    const m: Record<string, string> = { active: '#22c55e', blocked: '#ef4444', approved: '#22c55e', declined: '#ef4444', under_review: '#f59e0b', escalated: '#ef4444', resolved_merchant: '#22c55e', maintenance: '#f59e0b' };
    return m[s] || '#6b7280';
  };

  return (
    <div style={{ padding: '24px', fontFamily: 'Inter, system-ui, sans-serif', color: '#e2e8f0', minHeight: '100vh' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '4px' }}>Card Processing</h1>
        <p style={{ color: '#94a3b8', fontSize: '14px' }}>VISA, Mastercard, Verve — issuance, transactions, chargebacks &amp; terminal management</p>
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
              { label: 'Cards Issued', value: '2.4M', sub: '850K active this month' },
              { label: 'Daily Transactions', value: '₦4.2B', sub: '1.8M transactions' },
              { label: 'Approval Rate', value: '96.8%', sub: '3.2% decline rate' },
              { label: 'Active Terminals', value: '185,000', sub: '12,500 merchants' },
              { label: 'Chargebacks', value: '0.12%', sub: 'Below 1% threshold' },
              { label: '3DS Adoption', value: '78%', sub: 'Target: 90% by Q4' },
            ].map((c, i) => (
              <div key={i} style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>{c.label}</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#f8fafc' }}>{c.value}</div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>{c.sub}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Card Schemes</h3>
              {[
                { scheme: 'VISA', share: '45%', cards: '1.08M', color: '#1a1f71' },
                { scheme: 'MASTERCARD', share: '30%', cards: '720K', color: '#eb001b' },
                { scheme: 'VERVE', share: '25%', cards: '600K', color: '#00425f' },
              ].map((s, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i < 2 ? '1px solid #334155' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '32px', height: '20px', background: s.color, borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '8px', fontWeight: 700 }}>{s.scheme.slice(0, 2)}</div>
                    <span style={{ fontWeight: 600 }}>{s.scheme}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 600 }}>{s.share}</div>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>{s.cards} cards</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Transaction Channels</h3>
              {[
                { channel: 'POS', share: '52%', volume: '₦2.2B' },
                { channel: 'Web/E-Commerce', share: '28%', volume: '₦1.2B' },
                { channel: 'ATM', share: '15%', volume: '₦630M' },
                { channel: 'Contactless', share: '5%', volume: '₦210M' },
              ].map((ch, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i < 3 ? '1px solid #334155' : 'none' }}>
                  <span style={{ fontWeight: 600 }}>{ch.channel}</span>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 600 }}>{ch.share}</div>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>{ch.volume}/day</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'cards' && (
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Issued Cards</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['Card ID', 'Last 4', 'Scheme', 'Type', 'Holder', 'Issuer', 'Expiry', 'Daily Limit', '3DS', 'Status'].map(h => (
                  <th key={h} style={{ padding: '10px 8px', textAlign: 'left', color: '#94a3b8', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cards.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '12px' }}>{c.id}</td>
                  <td style={{ padding: '10px 8px', fontFamily: 'monospace' }}>●●●● {c.last4}</td>
                  <td style={{ padding: '10px 8px' }}><span style={{ background: schemeColor(c.scheme), color: '#fff', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>{c.scheme}</span></td>
                  <td style={{ padding: '10px 8px', fontSize: '12px' }}>{c.type}</td>
                  <td style={{ padding: '10px 8px', fontWeight: 600 }}>{c.holderName}</td>
                  <td style={{ padding: '10px 8px', color: '#94a3b8' }}>{c.issuerBankName}</td>
                  <td style={{ padding: '10px 8px', color: '#94a3b8' }}>{String(c.expiryMonth).padStart(2, '0')}/{c.expiryYear}</td>
                  <td style={{ padding: '10px 8px', fontWeight: 600 }}>{fmt(c.dailyLimit)}</td>
                  <td style={{ padding: '10px 8px' }}>{c.is3DSEnrolled ? <span style={{ color: '#22c55e' }}>✓</span> : <span style={{ color: '#ef4444' }}>✗</span>}</td>
                  <td style={{ padding: '10px 8px' }}><span style={{ color: statusColor(c.status), fontWeight: 600, fontSize: '12px' }}>● {c.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'transactions' && (
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Card Transactions</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155' }}>
                  {['RRN', 'Type', 'Card', 'Merchant', 'Channel', 'Amount', 'Risk', '3DS', 'Status'].map(h => (
                    <th key={h} style={{ padding: '10px 8px', textAlign: 'left', color: '#94a3b8', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transactions.map(t => (
                  <tr key={t.id} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '12px' }}>{t.rrn}</td>
                    <td style={{ padding: '10px 8px' }}><span style={{ background: '#1e3a5f', color: '#60a5fa', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>{t.type}</span></td>
                    <td style={{ padding: '10px 8px' }}><span style={{ background: schemeColor(t.scheme), color: '#fff', padding: '1px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: 600 }}>{t.scheme}</span> ●●{t.cardLast4}</td>
                    <td style={{ padding: '10px 8px' }}><div style={{ fontWeight: 600 }}>{t.merchantName}</div><div style={{ fontSize: '11px', color: '#64748b' }}>{t.merchantCategory}</div></td>
                    <td style={{ padding: '10px 8px' }}>{t.channel}</td>
                    <td style={{ padding: '10px 8px', fontWeight: 600 }}>{fmt(t.amount)}</td>
                    <td style={{ padding: '10px 8px' }}><span style={{ color: t.riskScore > 50 ? '#ef4444' : t.riskScore > 20 ? '#f59e0b' : '#22c55e', fontWeight: 600 }}>{t.riskScore}</span></td>
                    <td style={{ padding: '10px 8px' }}>{t.is3DSVerified ? <span style={{ color: '#22c55e', fontSize: '12px' }}>Verified</span> : <span style={{ color: '#64748b', fontSize: '12px' }}>No</span>}</td>
                    <td style={{ padding: '10px 8px' }}><span style={{ color: statusColor(t.status), fontWeight: 600, fontSize: '12px' }}>● {t.status}</span>{t.declineReason && <div style={{ fontSize: '11px', color: '#ef4444' }}>{t.declineReason}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'chargebacks' && (
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Chargebacks</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['ID', 'Transaction', 'Cardholder', 'Merchant', 'Original', 'Dispute', 'Reason', 'Due Date', 'Status'].map(h => (
                  <th key={h} style={{ padding: '10px 8px', textAlign: 'left', color: '#94a3b8', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chargebacks.map(cb => (
                <tr key={cb.id} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '12px' }}>{cb.id}</td>
                  <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '12px' }}>{cb.transactionId}</td>
                  <td style={{ padding: '10px 8px', fontWeight: 600 }}>{cb.cardholderName}</td>
                  <td style={{ padding: '10px 8px' }}>{cb.merchantName}</td>
                  <td style={{ padding: '10px 8px' }}>{fmt(cb.originalAmount)}</td>
                  <td style={{ padding: '10px 8px', fontWeight: 600, color: '#f59e0b' }}>{fmt(cb.disputeAmount)}</td>
                  <td style={{ padding: '10px 8px' }}><div style={{ fontSize: '12px' }}>{cb.reasonCode}</div><div style={{ fontSize: '11px', color: '#64748b' }}>{cb.reasonDesc}</div></td>
                  <td style={{ padding: '10px 8px', color: '#94a3b8' }}>{cb.dueDate}</td>
                  <td style={{ padding: '10px 8px' }}><span style={{ color: statusColor(cb.status), fontWeight: 600, fontSize: '12px' }}>● {cb.status.replace('_', ' ')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'terminals' && (
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Merchant Terminals</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['Terminal ID', 'Merchant', 'MCC', 'Location', 'Type', 'Acquirer', 'Daily Volume', 'Status'].map(h => (
                  <th key={h} style={{ padding: '10px 8px', textAlign: 'left', color: '#94a3b8', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {terminals.map(t => (
                <tr key={t.id} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '12px' }}>{t.terminalId}</td>
                  <td style={{ padding: '10px 8px', fontWeight: 600 }}>{t.merchantName}</td>
                  <td style={{ padding: '10px 8px' }}><div>{t.mcc}</div><div style={{ fontSize: '11px', color: '#64748b' }}>{t.mccDescription}</div></td>
                  <td style={{ padding: '10px 8px', color: '#94a3b8' }}>{t.location}</td>
                  <td style={{ padding: '10px 8px' }}><span style={{ background: '#1e3a5f', color: '#60a5fa', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>{t.type}</span></td>
                  <td style={{ padding: '10px 8px' }}>{t.acquirerBank}</td>
                  <td style={{ padding: '10px 8px', fontWeight: 600 }}>{t.dailyVolume}</td>
                  <td style={{ padding: '10px 8px' }}><span style={{ color: statusColor(t.status), fontWeight: 600, fontSize: '12px' }}>● {t.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
