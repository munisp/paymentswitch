import { logger } from "@/lib/logger";
import React, { useState, useCallback } from 'react';
import { ScrollText, Search, Filter, Download, Eye, User, Clock } from 'lucide-react';
import { lakehouseAPI, useLakehouseData } from '@/lib/api';

const fallbackAuditEntries = [
  { id: 'AUD-9001', timestamp: '2026-05-02 16:45:12', actor: 'admin@payment-switch.com', action: 'kill_switch.activate', resource: 'Sterling Bank', details: 'Suspended participant due to high failure rate', ip: '10.0.1.55', risk: 'high' },
  { id: 'AUD-9000', timestamp: '2026-05-02 16:30:05', actor: 'compliance@payment-switch.com', action: 'dispute.escalate', resource: 'DSP-005', details: 'Escalated to fraud team for investigation', ip: '10.0.1.42', risk: 'medium' },
  { id: 'AUD-8999', timestamp: '2026-05-02 15:20:33', actor: 'treasury@payment-switch.com', action: 'settlement.approve', resource: 'STL-2026-0502', details: 'Approved ₦2.4B settlement batch', ip: '10.0.1.38', risk: 'high' },
  { id: 'AUD-8998', timestamp: '2026-05-02 14:15:22', actor: 'kyc-team@payment-switch.com', action: 'kyc.approve', resource: 'KYC-APP-445', details: 'Approved KYC for TechStartup Ltd', ip: '10.0.1.60', risk: 'low' },
  { id: 'AUD-8997', timestamp: '2026-05-02 13:00:10', actor: 'admin@payment-switch.com', action: 'user.role_change', resource: 'user-234', details: 'Elevated to compliance_officer role', ip: '10.0.1.55', risk: 'high' },
  { id: 'AUD-8996', timestamp: '2026-05-02 11:45:55', actor: 'dev-ops@payment-switch.com', action: 'maintenance.schedule', resource: 'MAINT-045', details: 'Scheduled maintenance window 2026-05-05 02:00-04:00', ip: '10.0.1.70', risk: 'medium' },
  { id: 'AUD-8995', timestamp: '2026-05-02 10:30:18', actor: 'system', action: 'rate_limit.trigger', resource: 'API /payments', details: 'Rate limit triggered for IP 41.58.120.33', ip: 'system', risk: 'low' },
];

const riskColors: Record<string, string> = { low: 'text-gray-500', medium: 'text-yellow-600', high: 'text-red-600' };

export function AuditLog() {
  const [search, setSearch] = useState('');
  const fetcher = useCallback(() => lakehouseAPI.fetch<{ entries: typeof fallbackAuditEntries }>('/api/v1/audit/log').catch((err: unknown) => { logger.error("API fallback:", err); return { entries: [] }; }), []);
  const { data } = useLakehouseData(fetcher, 15000);
  const auditEntries = data?.entries || fallbackAuditEntries;
  const filtered = auditEntries.filter(e => search === '' || e.action.includes(search.toLowerCase()) || e.actor.includes(search.toLowerCase()) || e.details.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><ScrollText className="h-6 w-6" /> Audit Log</h2><p className="text-sm text-gray-500 mt-1">Complete audit trail of all platform actions</p></div>
        <button className="flex items-center gap-2 border px-4 py-2 rounded-lg hover:bg-gray-50"><Download className="h-4 w-4" /> Export</button>
      </div>
      <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" /><input type="text" placeholder="Search by action, actor, or details..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm" /></div>
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b"><tr><th className="text-left px-4 py-3 font-medium text-gray-600">Timestamp</th><th className="text-left px-4 py-3 font-medium text-gray-600">Actor</th><th className="text-left px-4 py-3 font-medium text-gray-600">Action</th><th className="text-left px-4 py-3 font-medium text-gray-600">Resource</th><th className="text-left px-4 py-3 font-medium text-gray-600">Details</th><th className="text-left px-4 py-3 font-medium text-gray-600">IP</th><th className="text-left px-4 py-3 font-medium text-gray-600">Risk</th></tr></thead>
          <tbody className="divide-y">
            {filtered.map(e => (
              <tr key={e.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-xs font-mono">{e.timestamp}</td>
                <td className="px-4 py-3 text-xs">{e.actor}</td>
                <td className="px-4 py-3 font-mono text-xs"><span className="px-1.5 py-0.5 bg-gray-100 rounded">{e.action}</span></td>
                <td className="px-4 py-3 text-xs">{e.resource}</td>
                <td className="px-4 py-3 text-xs max-w-xs truncate">{e.details}</td>
                <td className="px-4 py-3 font-mono text-xs">{e.ip}</td>
                <td className="px-4 py-3"><span className={`font-medium text-xs ${riskColors[e.risk]}`}>{e.risk}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
