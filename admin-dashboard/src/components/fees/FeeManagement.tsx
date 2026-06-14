import { logger } from "@/lib/logger";
import React, { useState, useCallback } from 'react';
import { lakehouseAPI, useLakehouseData } from '@/lib/api';
import { DollarSign, Plus, Edit, Trash2, Calculator, ToggleLeft, ToggleRight } from 'lucide-react';

const feeConfigs = [
  { id: 'FEE-001', name: 'Standard Transfer Fee', tier: 'Standard', type: 'Transfer', flatFee: 50, percentFee: 1.5, minFee: 50, maxFee: 5000, active: true },
  { id: 'FEE-002', name: 'Premium Transfer Fee', tier: 'Premium', type: 'Transfer', flatFee: 25, percentFee: 1.0, minFee: 25, maxFee: 3000, active: true },
  { id: 'FEE-003', name: 'Card Payment Fee', tier: 'Standard', type: 'Card', flatFee: 0, percentFee: 2.5, minFee: 100, maxFee: 10000, active: true },
  { id: 'FEE-004', name: 'Cross-Border Fee', tier: 'Standard', type: 'International', flatFee: 500, percentFee: 3.0, minFee: 500, maxFee: 25000, active: true },
  { id: 'FEE-005', name: 'Bulk Transfer Fee', tier: 'Enterprise', type: 'Batch', flatFee: 100, percentFee: 0.5, minFee: 100, maxFee: 50000, active: true },
  { id: 'FEE-006', name: 'Promo: Zero-Fee Transfer', tier: 'Promotional', type: 'Transfer', flatFee: 0, percentFee: 0, minFee: 0, maxFee: 0, active: false },
];

export function FeeManagement() {
  const feesFetcher = useCallback(() =>
    lakehouseAPI.fetch<{ fees: typeof feeConfigs }>('/api/v1/fees')
      .then(d => d.fees)
      .catch((err: unknown) => { logger.error("API fallback:", err); return feeConfigs; }), []);
  const { data: fees } = useLakehouseData(feesFetcher, 60000);
  const activeFees = fees || feeConfigs;
  const [calcAmount, setCalcAmount] = useState(100000);
  const [calcType, setCalcType] = useState('Transfer');
  const standardFee = activeFees.find(f => f.type === calcType && f.tier === 'Standard');
  const estimatedFee = standardFee ? Math.min(Math.max(standardFee.flatFee + (calcAmount * standardFee.percentFee / 100), standardFee.minFee), standardFee.maxFee || Infinity) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><DollarSign className="h-6 w-6" /> Fee Management</h2><p className="text-sm text-gray-500 mt-1">Configure and manage transaction fee structures</p></div>
        <button className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700"><Plus className="h-4 w-4" /> Add Fee Config</button>
      </div>

      {/* Fee Calculator */}
      <div className="bg-white rounded-lg border p-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2"><Calculator className="h-5 w-5" /> Fee Calculator</h3>
        <div className="grid grid-cols-3 gap-4 items-end">
          <div><label className="text-sm text-gray-600">Amount (NGN)</label><input type="number" value={calcAmount} onChange={e => setCalcAmount(Number(e.target.value))} className="mt-1 w-full border rounded-lg px-3 py-2" /></div>
          <div><label className="text-sm text-gray-600">Type</label><select value={calcType} onChange={e => setCalcType(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2"><option>Transfer</option><option>Card</option><option>International</option><option>Batch</option></select></div>
          <div className="text-right"><div className="text-sm text-gray-500">Estimated Fee</div><div className="text-2xl font-bold text-primary-600">₦{estimatedFee.toLocaleString(undefined, {minimumFractionDigits: 2})}</div></div>
        </div>
      </div>

      {/* Fee Configs Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b"><tr><th className="text-left px-4 py-3 font-medium text-gray-600">Name</th><th className="text-left px-4 py-3 font-medium text-gray-600">Tier</th><th className="text-left px-4 py-3 font-medium text-gray-600">Type</th><th className="text-left px-4 py-3 font-medium text-gray-600">Flat</th><th className="text-left px-4 py-3 font-medium text-gray-600">%</th><th className="text-left px-4 py-3 font-medium text-gray-600">Min/Max</th><th className="text-left px-4 py-3 font-medium text-gray-600">Active</th><th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th></tr></thead>
          <tbody className="divide-y">
            {activeFees.map(f => (
              <tr key={f.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{f.name}</td>
                <td className="px-4 py-3"><span className="px-2 py-0.5 bg-gray-100 rounded text-xs">{f.tier}</span></td>
                <td className="px-4 py-3">{f.type}</td>
                <td className="px-4 py-3">₦{f.flatFee}</td>
                <td className="px-4 py-3">{f.percentFee}%</td>
                <td className="px-4 py-3 text-xs">₦{f.minFee} / ₦{f.maxFee || '∞'}</td>
                <td className="px-4 py-3">{f.active ? <ToggleRight className="h-5 w-5 text-primary-600" /> : <ToggleLeft className="h-5 w-5 text-gray-400" />}</td>
                <td className="px-4 py-3"><div className="flex gap-1"><button className="p-1 hover:bg-gray-100 rounded"><Edit className="h-4 w-4 text-gray-500" /></button><button className="p-1 hover:bg-gray-100 rounded"><Trash2 className="h-4 w-4 text-red-500" /></button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
