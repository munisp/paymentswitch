import { logger } from "@/lib/logger";
import React, { useState, useCallback } from 'react';
import { lakehouseAPI, useLakehouseData } from '@/lib/api';
import { Layers, Plus, Search, Upload, Download, Eye, Clock, CheckCircle, XCircle } from 'lucide-react';

interface BatchTransfer {
  id: string;
  name: string;
  initiator: string;
  totalRecipients: number;
  totalAmount: number;
  currency: string;
  status: 'pending' | 'processing' | 'completed' | 'partial_failure' | 'failed';
  successCount: number;
  failCount: number;
  createdAt: string;
  completedAt: string | null;
}

const sampleBatches: BatchTransfer[] = [
  { id: 'BAT-001', name: 'May Salary Disbursement', initiator: 'HR Department', totalRecipients: 450, totalAmount: 135000000, currency: 'NGN', status: 'completed', successCount: 448, failCount: 2, createdAt: '2026-05-01 08:00', completedAt: '2026-05-01 08:45' },
  { id: 'BAT-002', name: 'Vendor Payments Q2', initiator: 'Finance Team', totalRecipients: 85, totalAmount: 28500000, currency: 'NGN', status: 'processing', successCount: 62, failCount: 0, createdAt: '2026-05-02 14:30', completedAt: null },
  { id: 'BAT-003', name: 'Agent Commissions April', initiator: 'Operations', totalRecipients: 1200, totalAmount: 45600000, currency: 'NGN', status: 'completed', successCount: 1195, failCount: 5, createdAt: '2026-04-30 10:00', completedAt: '2026-04-30 11:30' },
  { id: 'BAT-004', name: 'Refund Batch #422', initiator: 'Support Team', totalRecipients: 23, totalAmount: 890000, currency: 'NGN', status: 'partial_failure', successCount: 20, failCount: 3, createdAt: '2026-04-29 16:20', completedAt: '2026-04-29 16:35' },
  { id: 'BAT-005', name: 'Settlement Distribution', initiator: 'Treasury', totalRecipients: 12, totalAmount: 2400000000, currency: 'NGN', status: 'pending', successCount: 0, failCount: 0, createdAt: '2026-05-02 16:00', completedAt: null },
];

const statusColors: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-800',
  processing: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  partial_failure: 'bg-yellow-100 text-yellow-800',
  failed: 'bg-red-100 text-red-800',
};

export function BatchTransfers() {
  const batchFetcher = useCallback(() =>
    lakehouseAPI.fetch<{ batches: BatchTransfer[] }>('/api/v1/batch/transfers')
      .then(d => d.batches)
      .catch((err: unknown) => { logger.error("API fallback:", err); return sampleBatches; }), []);
  const { data: batches } = useLakehouseData(batchFetcher, 15000);
  const activeBatches = batches || sampleBatches;
  const [search, setSearch] = useState('');

  const filtered = activeBatches.filter(b =>
    search === '' || b.name.toLowerCase().includes(search.toLowerCase()) || b.id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Layers className="h-6 w-6" /> Batch Transfers
          </h2>
          <p className="text-sm text-gray-500 mt-1">Process bulk payment disbursements and settlements</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-2 border px-4 py-2 rounded-lg hover:bg-gray-50">
            <Upload className="h-4 w-4" /> Import CSV
          </button>
          <button className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700">
            <Plus className="h-4 w-4" /> New Batch
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border p-4">
          <div className="text-2xl font-bold">{activeBatches.length}</div>
          <div className="text-sm text-gray-500">Total Batches</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-2xl font-bold text-blue-600">{activeBatches.filter(b => b.status === 'processing').length}</div>
          <div className="text-sm text-gray-500">Processing</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-2xl font-bold">{activeBatches.reduce((sum, b) => sum + b.totalRecipients, 0).toLocaleString()}</div>
          <div className="text-sm text-gray-500">Total Recipients</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-2xl font-bold">₦{(activeBatches.reduce((sum, b) => sum + b.totalAmount, 0) / 1000000000).toFixed(1)}B</div>
          <div className="text-sm text-gray-500">Total Volume</div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input type="text" placeholder="Search batches..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">ID</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Initiator</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Recipients</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Amount</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Progress</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Created</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map(b => (
              <tr key={b.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs">{b.id}</td>
                <td className="px-4 py-3 font-medium">{b.name}</td>
                <td className="px-4 py-3">{b.initiator}</td>
                <td className="px-4 py-3">{b.totalRecipients.toLocaleString()}</td>
                <td className="px-4 py-3 font-medium">₦{b.totalAmount.toLocaleString()}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full" style={{ width: `${b.totalRecipients > 0 ? (b.successCount / b.totalRecipients) * 100 : 0}%` }} />
                    </div>
                    <span className="text-xs text-gray-500">{b.successCount}/{b.totalRecipients}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[b.status]}`}>{b.status.replace(/_/g, ' ')}</span>
                </td>
                <td className="px-4 py-3 text-xs">{b.createdAt}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button className="p-1 hover:bg-gray-100 rounded"><Eye className="h-4 w-4 text-gray-500" /></button>
                    <button className="p-1 hover:bg-gray-100 rounded"><Download className="h-4 w-4 text-gray-500" /></button>
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
