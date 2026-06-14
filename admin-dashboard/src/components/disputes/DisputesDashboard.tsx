import { logger } from "@/lib/logger";
import React, { useState, useCallback } from 'react';
import { Gavel, Search, Plus, Eye, MessageSquare, Clock, CheckCircle, XCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { lakehouseAPI, useLakehouseData } from '@/lib/api';

interface Dispute {
  id: string;
  transactionId: string;
  merchant: string;
  amount: number;
  currency: string;
  reason: string;
  status: 'open' | 'under_review' | 'evidence_requested' | 'resolved_merchant' | 'resolved_customer' | 'escalated';
  priority: 'low' | 'medium' | 'high' | 'critical';
  createdAt: string;
  updatedAt: string;
  assignee: string;
}

const defaultDisputes: Dispute[] = [
  { id: 'DSP-001', transactionId: 'TXN-89234', merchant: 'FirstBank PLC', amount: 250000, currency: 'NGN', reason: 'Unauthorized transaction', status: 'open', priority: 'critical', createdAt: '2026-05-02 10:30', updatedAt: '2026-05-02 14:15', assignee: 'Adunni Okafor' },
  { id: 'DSP-002', transactionId: 'TXN-89156', merchant: 'GTBank', amount: 75000, currency: 'NGN', reason: 'Amount mismatch', status: 'under_review', priority: 'high', createdAt: '2026-05-01 16:45', updatedAt: '2026-05-02 09:30', assignee: 'Chidi Nwankwo' },
  { id: 'DSP-003', transactionId: 'TXN-88901', merchant: 'Zenith Bank', amount: 500000, currency: 'NGN', reason: 'Service not received', status: 'evidence_requested', priority: 'medium', createdAt: '2026-04-30 11:20', updatedAt: '2026-05-01 15:00', assignee: 'Adunni Okafor' },
  { id: 'DSP-004', transactionId: 'TXN-88745', merchant: 'Access Bank', amount: 150000, currency: 'NGN', reason: 'Duplicate charge', status: 'resolved_customer', priority: 'low', createdAt: '2026-04-29 08:10', updatedAt: '2026-04-30 12:45', assignee: 'Emeka Eze' },
  { id: 'DSP-005', transactionId: 'TXN-88612', merchant: 'UBA', amount: 1200000, currency: 'NGN', reason: 'Fraudulent transaction', status: 'escalated', priority: 'critical', createdAt: '2026-04-28 14:55', updatedAt: '2026-05-02 16:30', assignee: 'Chidi Nwankwo' },
  { id: 'DSP-006', transactionId: 'TXN-88500', merchant: 'Stanbic IBTC', amount: 89000, currency: 'NGN', reason: 'Wrong beneficiary', status: 'under_review', priority: 'medium', createdAt: '2026-04-27 09:40', updatedAt: '2026-04-28 11:20', assignee: 'Fatima Ibrahim' },
];

const statusColors: Record<string, string> = {
  open: 'bg-yellow-100 text-yellow-800',
  under_review: 'bg-blue-100 text-blue-800',
  evidence_requested: 'bg-purple-100 text-purple-800',
  resolved_merchant: 'bg-green-100 text-green-800',
  resolved_customer: 'bg-green-100 text-green-800',
  escalated: 'bg-red-100 text-red-800',
};

const priorityColors: Record<string, string> = {
  low: 'bg-gray-100 text-gray-800',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
};

export function DisputesDashboard() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const fetcher = useCallback(() => lakehouseAPI.fetch<{ disputes: Dispute[] }>('/api/v1/disputes').catch((err: unknown) => { logger.error("API fallback:", err); return { disputes: [] }; }), []);
  const { data, loading } = useLakehouseData(fetcher, 30000);
  const disputes = data?.disputes || defaultDisputes;

  const filtered = disputes.filter(d => {
    const matchSearch = search === '' || d.transactionId.toLowerCase().includes(search.toLowerCase()) || d.merchant.toLowerCase().includes(search.toLowerCase()) || d.reason.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || d.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const stats = {
    total: disputes.length,
    open: disputes.filter(d => d.status === 'open').length,
    underReview: disputes.filter(d => d.status === 'under_review').length,
    escalated: disputes.filter(d => d.status === 'escalated').length,
    resolved: disputes.filter(d => d.status.startsWith('resolved')).length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Gavel className="h-6 w-6" /> Transaction Disputes
          </h2>
          <p className="text-sm text-gray-500 mt-1">Manage and resolve payment disputes across all participants</p>
        </div>
        <button className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition">
          <Plus className="h-4 w-4" /> File Dispute
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-4">
        <div className="bg-white rounded-lg border p-4">
          <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
          <div className="text-sm text-gray-500">Total Disputes</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-2xl font-bold text-yellow-600">{stats.open}</div>
          <div className="text-sm text-gray-500">Open</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-2xl font-bold text-blue-600">{stats.underReview}</div>
          <div className="text-sm text-gray-500">Under Review</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-2xl font-bold text-red-600">{stats.escalated}</div>
          <div className="text-sm text-gray-500">Escalated</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-2xl font-bold text-green-600">{stats.resolved}</div>
          <div className="text-sm text-gray-500">Resolved</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by transaction ID, merchant, or reason..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="under_review">Under Review</option>
          <option value="evidence_requested">Evidence Requested</option>
          <option value="escalated">Escalated</option>
          <option value="resolved_customer">Resolved (Customer)</option>
          <option value="resolved_merchant">Resolved (Merchant)</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">ID</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Transaction</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Merchant</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Amount</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Reason</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Priority</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Assignee</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map(d => (
              <tr key={d.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs">{d.id}</td>
                <td className="px-4 py-3 font-mono text-xs">{d.transactionId}</td>
                <td className="px-4 py-3">{d.merchant}</td>
                <td className="px-4 py-3 font-medium">₦{d.amount.toLocaleString()}</td>
                <td className="px-4 py-3">{d.reason}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${priorityColors[d.priority]}`}>
                    {d.priority}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[d.status]}`}>
                    {d.status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">{d.assignee}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button className="p-1 hover:bg-gray-100 rounded" title="View">
                      <Eye className="h-4 w-4 text-gray-500" />
                    </button>
                    <button className="p-1 hover:bg-gray-100 rounded" title="Comment">
                      <MessageSquare className="h-4 w-4 text-gray-500" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
