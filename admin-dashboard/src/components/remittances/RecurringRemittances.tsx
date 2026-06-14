import { logger } from "@/lib/logger";
import React, { useState, useCallback } from 'react';
import { lakehouseAPI, useLakehouseData } from '@/lib/api';
import { RefreshCw, Plus, Search, Play, Pause, Trash2, Edit } from 'lucide-react';

interface RecurringRemittance {
  id: string;
  sender: string;
  recipient: string;
  corridor: string;
  amount: number;
  currency: string;
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  nextExecution: string;
  status: 'active' | 'paused' | 'failed' | 'completed';
  successRate: number;
  totalExecuted: number;
}

const sampleRemittances: RecurringRemittance[] = [
  { id: 'RR-001', sender: 'Oluwaseun Adeyemi', recipient: 'Mary Adeyemi (Ghana)', corridor: 'NGN→GHS', amount: 150000, currency: 'NGN', frequency: 'monthly', nextExecution: '2026-06-01', status: 'active', successRate: 100, totalExecuted: 12 },
  { id: 'RR-002', sender: 'Chioma Eze', recipient: 'John Eze (UK)', corridor: 'NGN→GBP', amount: 500000, currency: 'NGN', frequency: 'monthly', nextExecution: '2026-05-15', status: 'active', successRate: 95.8, totalExecuted: 24 },
  { id: 'RR-003', sender: 'Ibrahim Musa', recipient: 'Ahmed Musa (Egypt)', corridor: 'NGN→EGP', amount: 80000, currency: 'NGN', frequency: 'biweekly', nextExecution: '2026-05-08', status: 'paused', successRate: 88.5, totalExecuted: 8 },
  { id: 'RR-004', sender: 'Fatima Bello', recipient: 'Amina Bello (Kenya)', corridor: 'NGN→KES', amount: 200000, currency: 'NGN', frequency: 'weekly', nextExecution: '2026-05-05', status: 'active', successRate: 97.2, totalExecuted: 36 },
  { id: 'RR-005', sender: 'Emeka Obi', recipient: 'Grace Obi (USA)', corridor: 'NGN→USD', amount: 1000000, currency: 'NGN', frequency: 'monthly', nextExecution: '2026-05-20', status: 'failed', successRate: 75.0, totalExecuted: 4 },
];

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  paused: 'bg-yellow-100 text-yellow-800',
  failed: 'bg-red-100 text-red-800',
  completed: 'bg-gray-100 text-gray-800',
};

export function RecurringRemittances() {
  const fetcher = useCallback(() =>
    lakehouseAPI.fetch<{ remittances: RecurringRemittance[] }>('/api/v1/remittances/recurring')
      .then(d => d.remittances)
      .catch((err: unknown) => { logger.error("API fallback:", err); return sampleRemittances; }), []);
  const { data: apiRemittances } = useLakehouseData(fetcher, 30000);
  const activeRemittances = apiRemittances || sampleRemittances;
  const [search, setSearch] = useState('');

  const filtered = activeRemittances.filter(r =>
    search === '' || r.sender.toLowerCase().includes(search.toLowerCase()) || r.recipient.toLowerCase().includes(search.toLowerCase()) || r.corridor.includes(search)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <RefreshCw className="h-6 w-6" /> Recurring Remittances
          </h2>
          <p className="text-sm text-gray-500 mt-1">Manage scheduled cross-border payment transfers</p>
        </div>
        <button className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700">
          <Plus className="h-4 w-4" /> New Schedule
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border p-4">
          <div className="text-2xl font-bold">{sampleRemittances.length}</div>
          <div className="text-sm text-gray-500">Total Schedules</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-2xl font-bold text-green-600">{sampleRemittances.filter(r => r.status === 'active').length}</div>
          <div className="text-sm text-gray-500">Active</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-2xl font-bold text-yellow-600">{sampleRemittances.filter(r => r.status === 'paused').length}</div>
          <div className="text-sm text-gray-500">Paused</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-2xl font-bold">₦{(sampleRemittances.reduce((sum, r) => sum + r.amount, 0) / 1000000).toFixed(1)}M</div>
          <div className="text-sm text-gray-500">Monthly Volume</div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input type="text" placeholder="Search by sender, recipient, or corridor..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">ID</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Sender</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Recipient</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Corridor</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Amount</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Frequency</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Next Run</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Success</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map(r => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs">{r.id}</td>
                <td className="px-4 py-3">{r.sender}</td>
                <td className="px-4 py-3">{r.recipient}</td>
                <td className="px-4 py-3 font-mono text-xs">{r.corridor}</td>
                <td className="px-4 py-3 font-medium">₦{r.amount.toLocaleString()}</td>
                <td className="px-4 py-3 capitalize">{r.frequency}</td>
                <td className="px-4 py-3">{r.nextExecution}</td>
                <td className="px-4 py-3">{r.successRate}%</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[r.status]}`}>{r.status}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {r.status === 'active' ? (
                      <button className="p-1 hover:bg-gray-100 rounded" title="Pause"><Pause className="h-4 w-4 text-yellow-500" /></button>
                    ) : (
                      <button className="p-1 hover:bg-gray-100 rounded" title="Resume"><Play className="h-4 w-4 text-green-500" /></button>
                    )}
                    <button className="p-1 hover:bg-gray-100 rounded" title="Edit"><Edit className="h-4 w-4 text-gray-500" /></button>
                    <button className="p-1 hover:bg-gray-100 rounded" title="Delete"><Trash2 className="h-4 w-4 text-red-500" /></button>
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
