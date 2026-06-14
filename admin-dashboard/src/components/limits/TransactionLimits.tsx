import { logger } from "@/lib/logger";
import React, { useCallback } from 'react';
import { lakehouseAPI, useLakehouseData } from '@/lib/api';
import { Gauge, Edit, Plus } from 'lucide-react';

const limits = [
  { id: 'LIM-001', name: 'Single Transfer', tier: 'Standard', daily: 5000000, weekly: 20000000, monthly: 50000000, perTransaction: 2000000, utilized: 45 },
  { id: 'LIM-002', name: 'Single Transfer', tier: 'Premium', daily: 20000000, weekly: 80000000, monthly: 200000000, perTransaction: 10000000, utilized: 32 },
  { id: 'LIM-003', name: 'Card Payment', tier: 'Standard', daily: 1000000, weekly: 5000000, monthly: 15000000, perTransaction: 500000, utilized: 67 },
  { id: 'LIM-004', name: 'International', tier: 'Standard', daily: 10000000, weekly: 40000000, monthly: 100000000, perTransaction: 5000000, utilized: 28 },
  { id: 'LIM-005', name: 'Batch Transfer', tier: 'Enterprise', daily: 500000000, weekly: 2000000000, monthly: 5000000000, perTransaction: 100000000, utilized: 12 },
];

export function TransactionLimits() {
  const fetcher = useCallback(() =>
    lakehouseAPI.fetch<{ limits: typeof limits }>('/api/v1/limits')
      .then(d => d.limits)
      .catch((err: unknown) => { logger.error("API fallback:", err); return limits; }), []);
  const { data: apiLimits } = useLakehouseData(fetcher, 60000);
  const activeLimits = apiLimits || limits;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Gauge className="h-6 w-6" /> Transaction Limits</h2><p className="text-sm text-gray-500 mt-1">Configure per-tier and per-transaction limits with CBN compliance</p></div>
        <button className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700"><Plus className="h-4 w-4" /> Add Limit Rule</button>
      </div>
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b"><tr><th className="text-left px-4 py-3 font-medium text-gray-600">Type</th><th className="text-left px-4 py-3 font-medium text-gray-600">Tier</th><th className="text-left px-4 py-3 font-medium text-gray-600">Per Transaction</th><th className="text-left px-4 py-3 font-medium text-gray-600">Daily</th><th className="text-left px-4 py-3 font-medium text-gray-600">Weekly</th><th className="text-left px-4 py-3 font-medium text-gray-600">Monthly</th><th className="text-left px-4 py-3 font-medium text-gray-600">Utilization</th><th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th></tr></thead>
          <tbody className="divide-y">
            {activeLimits.map(l => (
              <tr key={l.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{l.name}</td>
                <td className="px-4 py-3"><span className="px-2 py-0.5 bg-gray-100 rounded text-xs">{l.tier}</span></td>
                <td className="px-4 py-3">₦{(l.perTransaction/1000000).toFixed(1)}M</td>
                <td className="px-4 py-3">₦{(l.daily/1000000).toFixed(0)}M</td>
                <td className="px-4 py-3">₦{(l.weekly/1000000).toFixed(0)}M</td>
                <td className="px-4 py-3">₦{(l.monthly/1000000).toFixed(0)}M</td>
                <td className="px-4 py-3"><div className="flex items-center gap-2"><div className="w-16 h-2 bg-gray-200 rounded-full"><div className={`h-full rounded-full ${l.utilized > 80 ? 'bg-red-500' : l.utilized > 50 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{width:`${l.utilized}%`}} /></div><span className="text-xs">{l.utilized}%</span></div></td>
                <td className="px-4 py-3"><button className="p-1 hover:bg-gray-100 rounded"><Edit className="h-4 w-4 text-gray-500" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
