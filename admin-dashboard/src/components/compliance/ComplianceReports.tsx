import { logger } from "@/lib/logger";
import React, { useState, useCallback } from 'react';
import { FileText, Download, Eye, Filter, Calendar, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import { lakehouseAPI, useLakehouseData } from '@/lib/api';

const defaultReports = [
  { id: 'CTR-2026-0501', type: 'CTR', title: 'Currency Transaction Report', period: '2026-05-01', status: 'submitted', transactions: 156, totalAmount: 2400000000, regulator: 'CBN' },
  { id: 'SAR-2026-0428', type: 'SAR', title: 'Suspicious Activity Report', period: '2026-04-28', status: 'under_review', transactions: 3, totalAmount: 15000000, regulator: 'NFIU' },
  { id: 'AML-2026-Q1', type: 'AML', title: 'AML Quarterly Assessment', period: '2026-Q1', status: 'approved', transactions: 4500, totalAmount: 89000000000, regulator: 'CBN' },
  { id: 'STR-2026-0425', type: 'STR', title: 'Structuring Detection Report', period: '2026-04-25', status: 'submitted', transactions: 12, totalAmount: 48000000, regulator: 'NFIU' },
  { id: 'PEP-2026-0420', type: 'PEP', title: 'PEP Transaction Monitoring', period: '2026-04-20', status: 'approved', transactions: 8, totalAmount: 120000000, regulator: 'EFCC' },
  { id: 'SANC-2026-0415', type: 'Sanctions', title: 'Sanctions Screening Report', period: '2026-04-15', status: 'approved', transactions: 0, totalAmount: 0, regulator: 'OFAC/CBN' },
];

const statusColors: Record<string, string> = { submitted: 'bg-blue-100 text-blue-800', under_review: 'bg-yellow-100 text-yellow-800', approved: 'bg-green-100 text-green-800', rejected: 'bg-red-100 text-red-800' };
const typeColors: Record<string, string> = { CTR: 'bg-purple-100 text-purple-800', SAR: 'bg-red-100 text-red-800', AML: 'bg-blue-100 text-blue-800', STR: 'bg-orange-100 text-orange-800', PEP: 'bg-yellow-100 text-yellow-800', Sanctions: 'bg-gray-100 text-gray-800' };

export function ComplianceReports() {
  const fetcher = useCallback(() => lakehouseAPI.fetch<{ reports: typeof defaultReports }>('/api/v1/compliance/reports').catch((err: unknown) => { logger.error("API fallback:", err); return { reports: [] }; }), []);
  const { data } = useLakehouseData(fetcher, 60000);
  const reports = data?.reports || defaultReports;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><FileText className="h-6 w-6" /> Compliance Reports</h2>
          <p className="text-sm text-gray-500 mt-1">Regulatory reporting for CBN, NFIU, EFCC, and international bodies</p>
        </div>
        <button className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700"><FileText className="h-4 w-4" /> Generate Report</button>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border p-4"><div className="text-2xl font-bold">{reports.length}</div><div className="text-sm text-gray-500">Total Reports</div></div>
        <div className="bg-white rounded-lg border p-4"><div className="text-2xl font-bold text-green-600">{reports.filter(r => r.status === 'approved').length}</div><div className="text-sm text-gray-500">Approved</div></div>
        <div className="bg-white rounded-lg border p-4"><div className="text-2xl font-bold text-yellow-600">{reports.filter(r => r.status === 'under_review').length}</div><div className="text-sm text-gray-500">Under Review</div></div>
        <div className="bg-white rounded-lg border p-4"><div className="text-2xl font-bold text-blue-600">{reports.filter(r => r.status === 'submitted').length}</div><div className="text-sm text-gray-500">Submitted</div></div>
      </div>
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b"><tr><th className="text-left px-4 py-3 font-medium text-gray-600">ID</th><th className="text-left px-4 py-3 font-medium text-gray-600">Type</th><th className="text-left px-4 py-3 font-medium text-gray-600">Title</th><th className="text-left px-4 py-3 font-medium text-gray-600">Period</th><th className="text-left px-4 py-3 font-medium text-gray-600">Transactions</th><th className="text-left px-4 py-3 font-medium text-gray-600">Amount</th><th className="text-left px-4 py-3 font-medium text-gray-600">Regulator</th><th className="text-left px-4 py-3 font-medium text-gray-600">Status</th><th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th></tr></thead>
          <tbody className="divide-y">
            {reports.map(r => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs">{r.id}</td>
                <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeColors[r.type]}`}>{r.type}</span></td>
                <td className="px-4 py-3">{r.title}</td>
                <td className="px-4 py-3">{r.period}</td>
                <td className="px-4 py-3">{r.transactions.toLocaleString()}</td>
                <td className="px-4 py-3 font-medium">₦{(r.totalAmount / 1000000).toFixed(1)}M</td>
                <td className="px-4 py-3">{r.regulator}</td>
                <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[r.status]}`}>{r.status.replace(/_/g, ' ')}</span></td>
                <td className="px-4 py-3"><div className="flex gap-1"><button className="p-1 hover:bg-gray-100 rounded"><Eye className="h-4 w-4 text-gray-500" /></button><button className="p-1 hover:bg-gray-100 rounded"><Download className="h-4 w-4 text-gray-500" /></button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
