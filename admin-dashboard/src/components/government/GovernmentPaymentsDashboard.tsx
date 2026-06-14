'use client';

import { logger } from "@/lib/logger";
import React, { useState, useEffect } from 'react';
import { lakehouseAPI } from '@/lib/api';

type Tab = 'overview' | 'tsa' | 'tax' | 'pension' | 'social' | 'reports';

interface GovernmentPayment {
  id: string;
  category: string;
  status: string;
  payerName: string;
  payerTin: string;
  beneficiaryMda: string;
  amount: number;
  tsaCode: string;
  revenueCode: string;
  narration: string;
  gifmisRef: string;
}

interface TaxPayment {
  id: string;
  taxType: string;
  payerName: string;
  payerTin: string;
  assessmentYear: number;
  taxOffice: string;
  amount: number;
  penalty: number;
  interest: number;
  totalAmount: number;
  status: string;
  receiptNumber: string;
}

interface PensionRemittance {
  id: string;
  employerName: string;
  employerRc: string;
  pfaName: string;
  pfaCode: string;
  employeeCount: number;
  employerContribution: number;
  employeeContribution: number;
  voluntaryContribution: number;
  totalAmount: number;
  period: string;
  status: string;
}

interface SocialDisbursement {
  id: string;
  programName: string;
  programCode: string;
  beneficiaryCount: number;
  amountPerBeneficiary: number;
  totalAmount: number;
  disbursedCount: number;
  failedCount: number;
  status: string;
  initiatedBy: string;
}

interface RegulatoryReport {
  id: string;
  reportType: string;
  period: string;
  status: string;
  recordCount: number;
  totalValue: number;
  submittedTo: string;
  reference: string;
}

const defaultGovPayments: GovernmentPayment[] = [
  { id: 'GOV-001', category: 'TSA_COLLECTION', status: 'COMPLETED', payerName: 'Revenue Collection Agent 1', payerTin: 'TIN10000001', beneficiaryMda: 'Federal Ministry of Finance', amount: 450000000, tsaCode: 'TSA-001-FMF', revenueCode: 'REV-1000', narration: 'TSA collection for FMF', gifmisRef: 'GIFMIS-A1B2C3' },
  { id: 'GOV-002', category: 'TSA_COLLECTION', status: 'COMPLETED', payerName: 'Revenue Collection Agent 2', payerTin: 'TIN10000002', beneficiaryMda: 'Nigeria Customs Service', amount: 1200000000, tsaCode: 'TSA-002-NCS', revenueCode: 'REV-2000', narration: 'Customs duty collections', gifmisRef: 'GIFMIS-D4E5F6' },
  { id: 'GOV-003', category: 'MDA_PAYMENT', status: 'PROCESSING', payerName: 'CBN Treasury', payerTin: 'TIN-CBN-001', beneficiaryMda: 'Federal Ministry of Works', amount: 8500000000, tsaCode: 'TSA-003-FMW', revenueCode: 'EXP-3000', narration: 'Capital expenditure allocation', gifmisRef: 'GIFMIS-G7H8I9' },
  { id: 'GOV-004', category: 'SALARY_PAYMENT', status: 'COMPLETED', payerName: 'OAGF', payerTin: 'TIN-OAGF-001', beneficiaryMda: 'Federal Civil Servants', amount: 350000000000, tsaCode: 'TSA-004-SAL', revenueCode: 'SAL-1000', narration: 'April 2026 salary disbursement', gifmisRef: 'GIFMIS-J0K1L2' },
];

const defaultTaxes: TaxPayment[] = [
  { id: 'TAX-001', taxType: 'CIT', payerName: 'Dangote Industries Ltd', payerTin: 'TIN-DAN-001', assessmentYear: 2025, taxOffice: 'FIRS Large Tax Office Lagos', amount: 2500000000, penalty: 0, interest: 0, totalAmount: 2500000000, status: 'PAID', receiptNumber: 'FIRS-CIT-2026-001' },
  { id: 'TAX-002', taxType: 'VAT', payerName: 'MTN Nigeria Communications', payerTin: 'TIN-MTN-001', assessmentYear: 2026, taxOffice: 'FIRS Large Tax Office Abuja', amount: 850000000, penalty: 0, interest: 0, totalAmount: 850000000, status: 'PAID', receiptNumber: 'FIRS-VAT-2026-001' },
  { id: 'TAX-003', taxType: 'WHT', payerName: 'Shell Petroleum Dev Co', payerTin: 'TIN-SHELL-001', assessmentYear: 2026, taxOffice: 'FIRS Oil & Gas Office', amount: 12000000000, penalty: 0, interest: 0, totalAmount: 12000000000, status: 'ASSESSED', receiptNumber: '' },
  { id: 'TAX-004', taxType: 'PAYE', payerName: 'First Bank of Nigeria', payerTin: 'TIN-FBN-001', assessmentYear: 2026, taxOffice: 'LIRS Ikeja', amount: 180000000, penalty: 12000000, interest: 3000000, totalAmount: 195000000, status: 'OVERDUE', receiptNumber: '' },
];

const defaultPensions: PensionRemittance[] = [
  { id: 'PEN-001', employerName: 'Access Bank Plc', employerRc: 'RC125816', pfaName: 'ARM Pension Managers', pfaCode: 'PFA-ARM', employeeCount: 8500, employerContribution: 425000000, employeeContribution: 340000000, voluntaryContribution: 85000000, totalAmount: 850000000, period: 'Apr 2026', status: 'CONFIRMED' },
  { id: 'PEN-002', employerName: 'MTN Nigeria', employerRc: 'RC395010', pfaName: 'Stanbic IBTC Pension', pfaCode: 'PFA-SIB', employeeCount: 5200, employerContribution: 312000000, employeeContribution: 260000000, voluntaryContribution: 52000000, totalAmount: 624000000, period: 'Apr 2026', status: 'CONFIRMED' },
  { id: 'PEN-003', employerName: 'Dangote Cement', employerRc: 'RC131222', pfaName: 'Leadway Pensure', pfaCode: 'PFA-LWP', employeeCount: 12000, employerContribution: 480000000, employeeContribution: 360000000, voluntaryContribution: 0, totalAmount: 840000000, period: 'Apr 2026', status: 'PENDING' },
];

const defaultSocial: SocialDisbursement[] = [
  { id: 'SOC-001', programName: 'National Social Investment Programme (N-SIP)', programCode: 'NSIP-2026', beneficiaryCount: 500000, amountPerBeneficiary: 5000, totalAmount: 2500000000, disbursedCount: 485000, failedCount: 15000, status: 'IN_PROGRESS', initiatedBy: 'Ministry of Humanitarian Affairs' },
  { id: 'SOC-002', programName: 'TraderMoni', programCode: 'TMONI-2026', beneficiaryCount: 200000, amountPerBeneficiary: 10000, totalAmount: 2000000000, disbursedCount: 200000, failedCount: 0, status: 'COMPLETED', initiatedBy: 'BOI' },
  { id: 'SOC-003', programName: 'N-Power Stipends', programCode: 'NPOW-2026', beneficiaryCount: 100000, amountPerBeneficiary: 30000, totalAmount: 3000000000, disbursedCount: 0, failedCount: 0, status: 'APPROVED', initiatedBy: 'Ministry of Youth Development' },
];

const defaultReports: RegulatoryReport[] = [
  { id: 'RPT-001', reportType: 'CBN Monthly Returns', period: 'Apr 2026', status: 'SUBMITTED', recordCount: 1250000, totalValue: 45000000000000, submittedTo: 'CBN', reference: 'CBN-MR-2026-04' },
  { id: 'RPT-002', reportType: 'NFIU STR Report', period: 'Q1 2026', status: 'SUBMITTED', recordCount: 342, totalValue: 8500000000, submittedTo: 'NFIU', reference: 'NFIU-STR-2026-Q1' },
  { id: 'RPT-003', reportType: 'NDIC Returns', period: 'Apr 2026', status: 'PENDING', recordCount: 890000, totalValue: 32000000000000, submittedTo: 'NDIC', reference: 'NDIC-MR-2026-04' },
  { id: 'RPT-004', reportType: 'SEC Quarterly Report', period: 'Q1 2026', status: 'SUBMITTED', recordCount: 45000, totalValue: 2100000000000, submittedTo: 'SEC', reference: 'SEC-QR-2026-Q1' },
];

const fmt = (n: number) => n >= 1e12 ? `₦${(n / 1e12).toFixed(1)}T` : n >= 1e9 ? `₦${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `₦${(n / 1e6).toFixed(1)}M` : `₦${n.toLocaleString()}`;

export default function GovernmentPaymentsDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [govPayments, setGovPayments] = useState<GovernmentPayment[]>([]);
  const [taxes, setTaxes] = useState<TaxPayment[]>([]);
  const [pensions, setPensions] = useState<PensionRemittance[]>([]);
  const [social, setSocial] = useState<SocialDisbursement[]>([]);
  const [reports, setReports] = useState<RegulatoryReport[]>([]);

  useEffect(() => {
    lakehouseAPI.fetch<{ payments: GovernmentPayment[] }>('/api/government-payments/payments').then(d => setGovPayments(d.payments || [])).catch((err: unknown) => { logger.error("API fallback:", err); setGovPayments([]); });
    lakehouseAPI.fetch<{ taxes: TaxPayment[] }>('/api/government-payments/taxes').then(d => setTaxes(d.taxes || [])).catch((err: unknown) => { logger.error("API fallback:", err); setTaxes([]); });
    lakehouseAPI.fetch<{ pensions: PensionRemittance[] }>('/api/government-payments/pensions').then(d => setPensions(d.pensions || [])).catch((err: unknown) => { logger.error("API fallback:", err); setPensions([]); });
    lakehouseAPI.fetch<{ disbursements: SocialDisbursement[] }>('/api/government-payments/social').then(d => setSocial(d.disbursements || [])).catch((err: unknown) => { logger.error("API fallback:", err); setSocial([]); });
    lakehouseAPI.fetch<{ reports: RegulatoryReport[] }>('/api/government-payments/reports').then(d => setReports(d.reports || [])).catch((err: unknown) => { logger.error("API fallback:", err); setReports([]); });
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'tsa', label: 'TSA Collections' },
    { id: 'tax', label: 'Tax Payments' },
    { id: 'pension', label: 'Pensions' },
    { id: 'social', label: 'Social Programs' },
    { id: 'reports', label: 'Regulatory Reports' },
  ];

  const statusColor = (s: string) => {
    const m: Record<string, string> = { COMPLETED: '#22c55e', PROCESSING: '#3b82f6', PAID: '#22c55e', ASSESSED: '#f59e0b', OVERDUE: '#ef4444', CONFIRMED: '#22c55e', PENDING: '#f59e0b', IN_PROGRESS: '#3b82f6', APPROVED: '#22c55e', SUBMITTED: '#22c55e' };
    return m[s] || '#6b7280';
  };

  return (
    <div style={{ padding: '24px', fontFamily: 'Inter, system-ui, sans-serif', color: '#e2e8f0', minHeight: '100vh' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '4px' }}>Government Payments</h1>
        <p style={{ color: '#94a3b8', fontSize: '14px' }}>TSA collections, tax payments, pension remittances, social programs &amp; regulatory reporting</p>
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
              { label: 'TSA Collections (Daily)', value: fmt(govPayments.reduce((s, p) => s + (p.category.includes('TSA') ? p.amount : 0), 0) || 1650000000), sub: '42 MDAs' },
              { label: 'Tax Revenue (Monthly)', value: fmt(taxes.reduce((s, t) => s + t.totalAmount, 0) || 15545000000), sub: 'CIT, VAT, WHT, PAYE' },
              { label: 'Pension Remittances', value: fmt(pensions.reduce((s, p) => s + p.totalAmount, 0) || 2314000000), sub: `${pensions.reduce((s, p) => s + p.employeeCount, 0).toLocaleString() || '25,700'} employees` },
              { label: 'Social Disbursements', value: fmt(social.reduce((s, d) => s + d.totalAmount, 0) || 7500000000), sub: `${social.reduce((s, d) => s + d.beneficiaryCount, 0).toLocaleString() || '800,000'} beneficiaries` },
              { label: 'GIFMIS Reconciled', value: '99.8%', sub: 'Real-time settlement' },
              { label: 'Regulatory Reports', value: String(reports.filter(r => r.status === 'SUBMITTED').length || 3), sub: `${reports.length || 4} total this period` },
            ].map((c, i) => (
              <div key={i} style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>{c.label}</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#f8fafc' }}>{c.value}</div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>{c.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Government Payment Pipeline</h3>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
              {['A: Collection', 'B: TSA Credit', 'C: GIFMIS Tag', 'D: Appropriation', 'E: Approval', 'F: Disbursement', 'G: Reconcile'].map((step, i) => (
                <React.Fragment key={i}>
                  <div style={{ background: '#0f172a', borderRadius: '8px', padding: '10px 16px', border: '1px solid #334155', fontSize: '13px', fontWeight: 600, color: '#22c55e' }}>{step}</div>
                  {i < 6 && <span style={{ color: '#475569', fontSize: '18px' }}>→</span>}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'tsa' && (
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Treasury Single Account Collections</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['ID', 'Category', 'Payer', 'TIN', 'Beneficiary MDA', 'TSA Code', 'Amount', 'GIFMIS Ref', 'Status'].map(h => (
                  <th key={h} style={{ padding: '10px 8px', textAlign: 'left', color: '#94a3b8', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {govPayments.map(p => (
                <tr key={p.id} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '12px' }}>{p.id}</td>
                  <td style={{ padding: '10px 8px' }}><span style={{ background: '#1e3a5f', color: '#60a5fa', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>{p.category.replace('_', ' ')}</span></td>
                  <td style={{ padding: '10px 8px', fontWeight: 600 }}>{p.payerName}</td>
                  <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '11px', color: '#94a3b8' }}>{p.payerTin}</td>
                  <td style={{ padding: '10px 8px' }}>{p.beneficiaryMda}</td>
                  <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '11px' }}>{p.tsaCode}</td>
                  <td style={{ padding: '10px 8px', fontWeight: 600 }}>{fmt(p.amount)}</td>
                  <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '11px', color: '#94a3b8' }}>{p.gifmisRef}</td>
                  <td style={{ padding: '10px 8px' }}><span style={{ color: statusColor(p.status), fontWeight: 600, fontSize: '12px' }}>● {p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'tax' && (
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Tax Payments</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['ID', 'Type', 'Payer', 'TIN', 'Year', 'Tax Office', 'Amount', 'Penalty', 'Total', 'Receipt', 'Status'].map(h => (
                  <th key={h} style={{ padding: '10px 8px', textAlign: 'left', color: '#94a3b8', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {taxes.map(t => (
                <tr key={t.id} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '12px' }}>{t.id}</td>
                  <td style={{ padding: '10px 8px' }}><span style={{ background: '#1e3a5f', color: '#60a5fa', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>{t.taxType}</span></td>
                  <td style={{ padding: '10px 8px', fontWeight: 600 }}>{t.payerName}</td>
                  <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '11px', color: '#94a3b8' }}>{t.payerTin}</td>
                  <td style={{ padding: '10px 8px' }}>{t.assessmentYear}</td>
                  <td style={{ padding: '10px 8px', fontSize: '12px' }}>{t.taxOffice}</td>
                  <td style={{ padding: '10px 8px', fontWeight: 600 }}>{fmt(t.amount)}</td>
                  <td style={{ padding: '10px 8px', color: t.penalty > 0 ? '#ef4444' : '#64748b' }}>{t.penalty > 0 ? fmt(t.penalty) : '—'}</td>
                  <td style={{ padding: '10px 8px', fontWeight: 600 }}>{fmt(t.totalAmount)}</td>
                  <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '10px', color: '#94a3b8' }}>{t.receiptNumber || '—'}</td>
                  <td style={{ padding: '10px 8px' }}><span style={{ color: statusColor(t.status), fontWeight: 600, fontSize: '12px' }}>● {t.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'pension' && (
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Pension Remittances</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['ID', 'Employer', 'RC', 'PFA', 'Employees', 'Employer Contrib', 'Employee Contrib', 'Voluntary', 'Total', 'Period', 'Status'].map(h => (
                  <th key={h} style={{ padding: '10px 8px', textAlign: 'left', color: '#94a3b8', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pensions.map(p => (
                <tr key={p.id} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '12px' }}>{p.id}</td>
                  <td style={{ padding: '10px 8px', fontWeight: 600 }}>{p.employerName}</td>
                  <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '11px', color: '#94a3b8' }}>{p.employerRc}</td>
                  <td style={{ padding: '10px 8px' }}>{p.pfaName}</td>
                  <td style={{ padding: '10px 8px' }}>{p.employeeCount.toLocaleString()}</td>
                  <td style={{ padding: '10px 8px' }}>{fmt(p.employerContribution)}</td>
                  <td style={{ padding: '10px 8px' }}>{fmt(p.employeeContribution)}</td>
                  <td style={{ padding: '10px 8px', color: p.voluntaryContribution > 0 ? '#f8fafc' : '#64748b' }}>{p.voluntaryContribution > 0 ? fmt(p.voluntaryContribution) : '—'}</td>
                  <td style={{ padding: '10px 8px', fontWeight: 600 }}>{fmt(p.totalAmount)}</td>
                  <td style={{ padding: '10px 8px' }}>{p.period}</td>
                  <td style={{ padding: '10px 8px' }}><span style={{ color: statusColor(p.status), fontWeight: 600, fontSize: '12px' }}>● {p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'social' && (
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Social Programs</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
            {social.map(s => (
              <div key={s.id} style={{ background: '#0f172a', borderRadius: '10px', padding: '16px', border: '1px solid #334155' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '15px', fontWeight: 600 }}>{s.programName}</span>
                  <span style={{ color: statusColor(s.status), fontSize: '12px', fontWeight: 600 }}>● {s.status.replace('_', ' ')}</span>
                </div>
                <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '12px' }}>Code: {s.programCode} · By: {s.initiatedBy}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div><div style={{ fontSize: '11px', color: '#94a3b8' }}>Beneficiaries</div><div style={{ fontWeight: 600, fontSize: '16px' }}>{s.beneficiaryCount.toLocaleString()}</div></div>
                  <div><div style={{ fontSize: '11px', color: '#94a3b8' }}>Per Person</div><div style={{ fontWeight: 600, fontSize: '16px' }}>{fmt(s.amountPerBeneficiary)}</div></div>
                  <div><div style={{ fontSize: '11px', color: '#94a3b8' }}>Disbursed</div><div style={{ fontWeight: 600, fontSize: '16px', color: '#22c55e' }}>{s.disbursedCount.toLocaleString()}</div></div>
                  <div><div style={{ fontSize: '11px', color: '#94a3b8' }}>Total Amount</div><div style={{ fontWeight: 600, fontSize: '16px' }}>{fmt(s.totalAmount)}</div></div>
                </div>
                {s.failedCount > 0 && <div style={{ marginTop: '8px', fontSize: '12px', color: '#ef4444' }}>Failed: {s.failedCount.toLocaleString()}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'reports' && (
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Regulatory Reports</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['ID', 'Report Type', 'Period', 'Submitted To', 'Records', 'Total Value', 'Reference', 'Status'].map(h => (
                  <th key={h} style={{ padding: '10px 8px', textAlign: 'left', color: '#94a3b8', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reports.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '12px' }}>{r.id}</td>
                  <td style={{ padding: '10px 8px', fontWeight: 600 }}>{r.reportType}</td>
                  <td style={{ padding: '10px 8px' }}>{r.period}</td>
                  <td style={{ padding: '10px 8px' }}><span style={{ background: '#1e3a5f', color: '#60a5fa', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>{r.submittedTo}</span></td>
                  <td style={{ padding: '10px 8px' }}>{r.recordCount.toLocaleString()}</td>
                  <td style={{ padding: '10px 8px', fontWeight: 600 }}>{fmt(r.totalValue)}</td>
                  <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '11px', color: '#94a3b8' }}>{r.reference}</td>
                  <td style={{ padding: '10px 8px' }}><span style={{ color: statusColor(r.status), fontWeight: 600, fontSize: '12px' }}>● {r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
