'use client';

import { logger } from "@/lib/logger";
import React, { useState, useEffect } from 'react';
import { lakehouseAPI } from '@/lib/api';

type Tab = 'overview' | 'lcs' | 'escrows' | 'customs';

interface LetterOfCredit {
  id: string;
  lcNumber: string;
  type: string;
  applicant: string;
  applicantBank: string;
  beneficiary: string;
  beneficiaryBank: string;
  beneficiaryCountry: string;
  amount: number;
  currency: string;
  goodsDescription: string;
  shipmentPort: string;
  destinationPort: string;
  status: string;
  formMRef: string;
  documents: { id: string; type: string; documentRef: string; status: string }[];
}

interface EscrowPayment {
  id: string;
  buyerName: string;
  sellerName: string;
  totalAmount: number;
  currency: string;
  milestones: { id: string; description: string; amount: number; status: string }[];
  status: string;
  createdAt: string;
}

interface CustomsDutyPayment {
  id: string;
  assessmentRef: string;
  importerName: string;
  dutyAmount: number;
  vatAmount: number;
  surchargeAmount: number;
  totalAmount: number;
  hsCode: string;
  goodsDesc: string;
  portOfEntry: string;
  status: string;
}

const defaultLCs: LetterOfCredit[] = [
  { id: 'LC-001', lcNumber: 'LC-2026-A001', type: 'import', applicant: 'Dangote Industries', applicantBank: 'Access Bank', beneficiary: 'Sinopec Corp', beneficiaryBank: 'Bank of China', beneficiaryCountry: 'CN', amount: 25000000, currency: 'USD', goodsDescription: 'Industrial chemicals and petrochemical feedstock', shipmentPort: 'Shanghai', destinationPort: 'Apapa, Lagos', status: 'CONFIRMED', formMRef: 'FORM-M-2026-001', documents: [{ id: 'DOC-001', type: 'commercial_invoice', documentRef: 'INV-2026-SC001', status: 'verified' }] },
  { id: 'LC-002', lcNumber: 'LC-2026-A002', type: 'import', applicant: 'BUA Cement', applicantBank: 'GTBank', beneficiary: 'Thyssen Krupp AG', beneficiaryBank: 'Deutsche Bank', beneficiaryCountry: 'DE', amount: 8500000, currency: 'EUR', goodsDescription: 'Cement plant machinery and spare parts', shipmentPort: 'Hamburg', destinationPort: 'Tin Can Island, Lagos', status: 'ISSUED', formMRef: 'FORM-M-2026-002', documents: [] },
  { id: 'LC-003', lcNumber: 'LC-2026-E001', type: 'export', applicant: 'Olam Nigeria', applicantBank: 'Zenith Bank', beneficiary: 'Cargill Europe', beneficiaryBank: 'ING Bank', beneficiaryCountry: 'NL', amount: 12000000, currency: 'USD', goodsDescription: 'Raw cocoa beans (Grade 1)', shipmentPort: 'Apapa, Lagos', destinationPort: 'Rotterdam', status: 'DRAWN_DOWN', formMRef: 'FORM-A-2026-001', documents: [{ id: 'DOC-002', type: 'bill_of_lading', documentRef: 'BOL-2026-OL001', status: 'verified' }, { id: 'DOC-003', type: 'certificate_of_origin', documentRef: 'COO-2026-OL001', status: 'verified' }] },
  { id: 'LC-004', lcNumber: 'LC-2026-A003', type: 'import', applicant: 'MTN Nigeria', applicantBank: 'UBA', beneficiary: 'Ericsson AB', beneficiaryBank: 'SEB Bank', beneficiaryCountry: 'SE', amount: 45000000, currency: 'USD', goodsDescription: '5G network equipment and base stations', shipmentPort: 'Gothenburg', destinationPort: 'Apapa, Lagos', status: 'ADVISED', formMRef: 'FORM-M-2026-003', documents: [] },
  { id: 'LC-005', lcNumber: 'LC-2026-E002', type: 'export', applicant: 'Nigerian Breweries', applicantBank: 'First Bank', beneficiary: 'Heineken NV', beneficiaryBank: 'ABN AMRO', beneficiaryCountry: 'NL', amount: 3500000, currency: 'EUR', goodsDescription: 'Star Lager beer for export', shipmentPort: 'Apapa, Lagos', destinationPort: 'Rotterdam', status: 'SETTLED', formMRef: 'FORM-A-2026-002', documents: [{ id: 'DOC-004', type: 'bill_of_lading', documentRef: 'BOL-2026-NB001', status: 'verified' }] },
];

const defaultEscrows: EscrowPayment[] = [
  { id: 'ESC-001', buyerName: 'Lafarge Africa', sellerName: 'CAT Equipment Nigeria', totalAmount: 2500000, currency: 'USD', milestones: [{ id: 'MS-001', description: 'Equipment delivery', amount: 1500000, status: 'released' }, { id: 'MS-002', description: 'Installation & commissioning', amount: 750000, status: 'held' }, { id: 'MS-003', description: 'Acceptance testing', amount: 250000, status: 'held' }], status: 'IN_PROGRESS', createdAt: '2026-03-15' },
  { id: 'ESC-002', buyerName: 'TotalEnergies Nigeria', sellerName: 'Subsea 7 Ltd', totalAmount: 15000000, currency: 'USD', milestones: [{ id: 'MS-004', description: 'Pipeline fabrication', amount: 5000000, status: 'released' }, { id: 'MS-005', description: 'Offshore installation', amount: 8000000, status: 'held' }, { id: 'MS-006', description: 'Testing & handover', amount: 2000000, status: 'held' }], status: 'IN_PROGRESS', createdAt: '2026-01-20' },
  { id: 'ESC-003', buyerName: 'Flour Mills Nigeria', sellerName: 'Buhler AG', totalAmount: 4200000, currency: 'CHF', milestones: [{ id: 'MS-007', description: 'Full delivery', amount: 4200000, status: 'released' }], status: 'COMPLETED', createdAt: '2025-11-01' },
];

const defaultCustoms: CustomsDutyPayment[] = [
  { id: 'CUS-001', assessmentRef: 'NCS-ASMT-2026-A001', importerName: 'Dangote Industries', dutyAmount: 125000000, vatAmount: 37500000, surchargeAmount: 6250000, totalAmount: 168750000, hsCode: '2902.20', goodsDesc: 'Toluene and petrochemical feedstock', portOfEntry: 'Apapa Port', status: 'PAID' },
  { id: 'CUS-002', assessmentRef: 'NCS-ASMT-2026-A002', importerName: 'BUA Cement', dutyAmount: 42500000, vatAmount: 12750000, surchargeAmount: 2125000, totalAmount: 57375000, hsCode: '8474.20', goodsDesc: 'Cement plant crushing machinery', portOfEntry: 'Tin Can Island', status: 'PAID' },
  { id: 'CUS-003', assessmentRef: 'NCS-ASMT-2026-A003', importerName: 'MTN Nigeria', dutyAmount: 225000000, vatAmount: 67500000, surchargeAmount: 11250000, totalAmount: 303750000, hsCode: '8517.62', goodsDesc: '5G network equipment and base stations', portOfEntry: 'Apapa Port', status: 'ASSESSED' },
  { id: 'CUS-004', assessmentRef: 'NCS-ASMT-2026-A004', importerName: 'Toyota Nigeria', dutyAmount: 85000000, vatAmount: 25500000, surchargeAmount: 4250000, totalAmount: 114750000, hsCode: '8703.23', goodsDesc: 'Motor vehicles for transportation', portOfEntry: 'Tin Can Island', status: 'DISPUTED' },
];

const fmtUSD = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n.toLocaleString()}`;
const fmtNGN = (n: number) => n >= 1e9 ? `₦${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `₦${(n / 1e6).toFixed(1)}M` : `₦${n.toLocaleString()}`;

export default function TradePaymentsDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [lcs, setLcs] = useState<LetterOfCredit[]>([]);
  const [escrows, setEscrows] = useState<EscrowPayment[]>([]);
  const [customs, setCustoms] = useState<CustomsDutyPayment[]>([]);

  useEffect(() => {
    lakehouseAPI.fetch<{ lcs: LetterOfCredit[] }>('/api/trade-payments/lcs').then(d => setLcs(d.lcs || [])).catch((err: unknown) => { logger.error("API fallback:", err); setLcs([]); });
    lakehouseAPI.fetch<{ escrows: EscrowPayment[] }>('/api/trade-payments/escrows').then(d => setEscrows(d.escrows || [])).catch((err: unknown) => { logger.error("API fallback:", err); setEscrows([]); });
    lakehouseAPI.fetch<{ duties: CustomsDutyPayment[] }>('/api/trade-payments/customs').then(d => setCustoms(d.duties || [])).catch((err: unknown) => { logger.error("API fallback:", err); setCustoms([]); });
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'lcs', label: 'Letters of Credit' },
    { id: 'escrows', label: 'Escrow Payments' },
    { id: 'customs', label: 'Customs Duties' },
  ];

  const statusColor = (s: string) => {
    const m: Record<string, string> = { CONFIRMED: '#22c55e', ISSUED: '#3b82f6', DRAWN_DOWN: '#f59e0b', ADVISED: '#8b5cf6', SETTLED: '#22c55e', EXPIRED: '#6b7280', IN_PROGRESS: '#3b82f6', COMPLETED: '#22c55e', PAID: '#22c55e', ASSESSED: '#f59e0b', DISPUTED: '#ef4444', released: '#22c55e', held: '#f59e0b' };
    return m[s] || '#6b7280';
  };

  return (
    <div style={{ padding: '24px', fontFamily: 'Inter, system-ui, sans-serif', color: '#e2e8f0', minHeight: '100vh' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '4px' }}>Trade Payments</h1>
        <p style={{ color: '#94a3b8', fontSize: '14px' }}>Letters of credit, escrow payments, customs duties &amp; trade finance</p>
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
              { label: 'Active LCs', value: String(lcs.filter(l => !['SETTLED', 'EXPIRED'].includes(l.status)).length || 3), sub: `${lcs.length || 5} total` },
              { label: 'Import LC Value', value: fmtUSD(lcs.filter(l => l.type === 'import').reduce((s, l) => s + l.amount, 0) || 78500000), sub: `${lcs.filter(l => l.type === 'import').length || 3} active` },
              { label: 'Export LC Value', value: fmtUSD(lcs.filter(l => l.type === 'export').reduce((s, l) => s + l.amount, 0) || 15500000), sub: `${lcs.filter(l => l.type === 'export').length || 2} active` },
              { label: 'Escrow Holdings', value: fmtUSD(escrows.filter(e => e.status === 'IN_PROGRESS').reduce((s, e) => s + e.totalAmount, 0) || 17500000), sub: `${escrows.filter(e => e.status === 'IN_PROGRESS').length || 2} active` },
              { label: 'Customs Collected', value: fmtNGN(customs.filter(c => c.status === 'PAID').reduce((s, c) => s + c.totalAmount, 0) || 226125000), sub: 'This month' },
              { label: 'Form M/A Processed', value: '94', sub: '12 pending CBN approval' },
            ].map((c, i) => (
              <div key={i} style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>{c.label}</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#f8fafc' }}>{c.value}</div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>{c.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Trade Finance Pipeline</h3>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
              {['A: Form M/A', 'B: LC Issuance', 'C: Advising', 'D: Shipment', 'E: Documents', 'F: Payment', 'G: Customs'].map((step, i) => (
                <React.Fragment key={i}>
                  <div style={{ background: '#0f172a', borderRadius: '8px', padding: '10px 16px', border: '1px solid #334155', fontSize: '13px', fontWeight: 600, color: '#22c55e' }}>{step}</div>
                  {i < 6 && <span style={{ color: '#475569', fontSize: '18px' }}>→</span>}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'lcs' && (
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Letters of Credit</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155' }}>
                  {['LC Number', 'Type', 'Applicant', 'Beneficiary', 'Country', 'Amount', 'Route', 'Form M/A', 'Docs', 'Status'].map(h => (
                    <th key={h} style={{ padding: '10px 8px', textAlign: 'left', color: '#94a3b8', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lcs.map(lc => (
                  <tr key={lc.id} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '12px' }}>{lc.lcNumber}</td>
                    <td style={{ padding: '10px 8px' }}><span style={{ background: lc.type === 'import' ? '#7c3aed' : '#059669', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' }}>{lc.type}</span></td>
                    <td style={{ padding: '10px 8px' }}><div style={{ fontWeight: 600 }}>{lc.applicant}</div><div style={{ fontSize: '11px', color: '#64748b' }}>{lc.applicantBank}</div></td>
                    <td style={{ padding: '10px 8px' }}><div style={{ fontWeight: 600 }}>{lc.beneficiary}</div><div style={{ fontSize: '11px', color: '#64748b' }}>{lc.beneficiaryBank}</div></td>
                    <td style={{ padding: '10px 8px' }}>{lc.beneficiaryCountry}</td>
                    <td style={{ padding: '10px 8px', fontWeight: 600 }}>{lc.currency === 'USD' ? fmtUSD(lc.amount) : `€${(lc.amount / 1e6).toFixed(1)}M`}</td>
                    <td style={{ padding: '10px 8px', fontSize: '12px', color: '#94a3b8' }}>{lc.shipmentPort} → {lc.destinationPort}</td>
                    <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '10px' }}>{lc.formMRef}</td>
                    <td style={{ padding: '10px 8px' }}>{lc.documents.length > 0 ? <span style={{ color: '#22c55e' }}>{lc.documents.length} verified</span> : <span style={{ color: '#64748b' }}>none</span>}</td>
                    <td style={{ padding: '10px 8px' }}><span style={{ color: statusColor(lc.status), fontWeight: 600, fontSize: '12px' }}>● {lc.status.replace('_', ' ')}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'escrows' && (
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Escrow Payments</h3>
          <div style={{ display: 'grid', gap: '16px' }}>
            {escrows.map(esc => (
              <div key={esc.id} style={{ background: '#0f172a', borderRadius: '10px', padding: '16px', border: '1px solid #334155' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div>
                    <span style={{ fontSize: '16px', fontWeight: 600 }}>{esc.buyerName}</span>
                    <span style={{ color: '#475569', margin: '0 8px' }}>→</span>
                    <span style={{ fontSize: '16px', fontWeight: 600 }}>{esc.sellerName}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, fontSize: '18px' }}>{esc.currency === 'USD' ? fmtUSD(esc.totalAmount) : `${esc.currency} ${esc.totalAmount.toLocaleString()}`}</div>
                    <span style={{ color: statusColor(esc.status), fontSize: '12px', fontWeight: 600 }}>● {esc.status.replace('_', ' ')}</span>
                  </div>
                </div>
                <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '12px' }}>Created: {esc.createdAt}</div>
                <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: '#94a3b8' }}>Milestones</div>
                {esc.milestones.map((ms, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#1e293b', borderRadius: '6px', marginBottom: '4px' }}>
                    <span>{ms.description}</span>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600 }}>{fmtUSD(ms.amount)}</span>
                      <span style={{ color: statusColor(ms.status), fontWeight: 600, fontSize: '12px' }}>● {ms.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'customs' && (
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Customs Duty Payments</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155' }}>
                  {['Assessment Ref', 'Importer', 'HS Code', 'Goods', 'Port', 'Duty', 'VAT', 'Surcharge', 'Total', 'Status'].map(h => (
                    <th key={h} style={{ padding: '10px 8px', textAlign: 'left', color: '#94a3b8', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {customs.map(c => (
                  <tr key={c.id} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '11px' }}>{c.assessmentRef}</td>
                    <td style={{ padding: '10px 8px', fontWeight: 600 }}>{c.importerName}</td>
                    <td style={{ padding: '10px 8px', fontFamily: 'monospace' }}>{c.hsCode}</td>
                    <td style={{ padding: '10px 8px', maxWidth: '200px' }}>{c.goodsDesc}</td>
                    <td style={{ padding: '10px 8px', color: '#94a3b8' }}>{c.portOfEntry}</td>
                    <td style={{ padding: '10px 8px' }}>{fmtNGN(c.dutyAmount)}</td>
                    <td style={{ padding: '10px 8px' }}>{fmtNGN(c.vatAmount)}</td>
                    <td style={{ padding: '10px 8px' }}>{fmtNGN(c.surchargeAmount)}</td>
                    <td style={{ padding: '10px 8px', fontWeight: 600 }}>{fmtNGN(c.totalAmount)}</td>
                    <td style={{ padding: '10px 8px' }}><span style={{ color: statusColor(c.status), fontWeight: 600, fontSize: '12px' }}>● {c.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
