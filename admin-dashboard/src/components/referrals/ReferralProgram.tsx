import { logger } from "@/lib/logger";
import React, { useCallback } from 'react';
import { lakehouseAPI, useLakehouseData } from '@/lib/api';
import { Gift, Users, TrendingUp, DollarSign } from 'lucide-react';

const referrals = [
  { id: 'REF-001', referrer: 'Oluwaseun Adeyemi', referred: 'TechStartup Ltd', status: 'active', reward: 50000, signupDate: '2026-04-15', firstTransaction: '2026-04-20', volume: 2500000 },
  { id: 'REF-002', referrer: 'Chioma Eze', referred: 'QuickPay Inc', status: 'active', reward: 50000, signupDate: '2026-04-10', firstTransaction: '2026-04-12', volume: 8900000 },
  { id: 'REF-003', referrer: 'Ibrahim Musa', referred: 'AgriTech Solutions', status: 'pending', reward: 0, signupDate: '2026-04-28', firstTransaction: null, volume: 0 },
  { id: 'REF-004', referrer: 'Fatima Bello', referred: 'EduPay Nigeria', status: 'active', reward: 75000, signupDate: '2026-03-20', firstTransaction: '2026-03-25', volume: 15000000 },
  { id: 'REF-005', referrer: 'Emeka Obi', referred: 'HealthPay Ltd', status: 'expired', reward: 0, signupDate: '2026-01-15', firstTransaction: null, volume: 0 },
];

const statusColors: Record<string, string> = { active: 'bg-green-100 text-green-800', pending: 'bg-yellow-100 text-yellow-800', expired: 'bg-gray-100 text-gray-800' };

export function ReferralProgram() {
  const fetcher = useCallback(() =>
    lakehouseAPI.fetch<{ referrals: typeof referrals }>('/api/v1/referrals')
      .then(d => d.referrals)
      .catch((err: unknown) => { logger.error("API fallback:", err); return referrals; }), []);
  const { data: apiReferrals } = useLakehouseData(fetcher, 30000);
  const activeReferrals = apiReferrals || referrals;
  const totalRewards = activeReferrals.reduce((sum, r) => sum + r.reward, 0);
  const totalVolume = activeReferrals.reduce((sum, r) => sum + r.volume, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Gift className="h-6 w-6" /> Referral Program</h2><p className="text-sm text-gray-500 mt-1">Track merchant referrals, rewards, and program performance</p></div>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border p-4"><div className="flex items-center gap-2 text-sm text-gray-500"><Users className="h-4 w-4" /> Total Referrals</div><div className="text-2xl font-bold mt-1">{activeReferrals.length}</div></div>
        <div className="bg-white rounded-lg border p-4"><div className="flex items-center gap-2 text-sm text-gray-500"><TrendingUp className="h-4 w-4" /> Active</div><div className="text-2xl font-bold mt-1 text-green-600">{activeReferrals.filter(r => r.status === 'active').length}</div></div>
        <div className="bg-white rounded-lg border p-4"><div className="flex items-center gap-2 text-sm text-gray-500"><DollarSign className="h-4 w-4" /> Rewards Paid</div><div className="text-2xl font-bold mt-1">₦{(totalRewards/1000).toFixed(0)}K</div></div>
        <div className="bg-white rounded-lg border p-4"><div className="flex items-center gap-2 text-sm text-gray-500"><TrendingUp className="h-4 w-4" /> Volume Generated</div><div className="text-2xl font-bold mt-1">₦{(totalVolume/1000000).toFixed(1)}M</div></div>
      </div>
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b"><tr><th className="text-left px-4 py-3 font-medium text-gray-600">Referrer</th><th className="text-left px-4 py-3 font-medium text-gray-600">Referred</th><th className="text-left px-4 py-3 font-medium text-gray-600">Status</th><th className="text-left px-4 py-3 font-medium text-gray-600">Reward</th><th className="text-left px-4 py-3 font-medium text-gray-600">Signup</th><th className="text-left px-4 py-3 font-medium text-gray-600">1st Transaction</th><th className="text-left px-4 py-3 font-medium text-gray-600">Volume</th></tr></thead>
          <tbody className="divide-y">
            {activeReferrals.map(r => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{r.referrer}</td>
                <td className="px-4 py-3">{r.referred}</td>
                <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[r.status]}`}>{r.status}</span></td>
                <td className="px-4 py-3">₦{r.reward.toLocaleString()}</td>
                <td className="px-4 py-3 text-xs">{r.signupDate}</td>
                <td className="px-4 py-3 text-xs">{r.firstTransaction || '—'}</td>
                <td className="px-4 py-3">₦{r.volume.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
