import { logger } from "@/lib/logger";
import React, { useCallback } from 'react';
import { lakehouseAPI, useLakehouseData } from '@/lib/api';
import { Wrench, Calendar, Clock, AlertTriangle, CheckCircle } from 'lucide-react';

const windows = [
  { id: 'MAINT-046', title: 'Database Migration v2.8', scheduled: '2026-05-05 02:00-04:00', status: 'scheduled', impact: 'Partial - Write operations suspended', teams: ['Database', 'Backend'] },
  { id: 'MAINT-045', title: 'Kafka Cluster Upgrade', scheduled: '2026-05-03 01:00-03:00', status: 'scheduled', impact: 'None - Rolling upgrade', teams: ['Infrastructure'] },
  { id: 'MAINT-044', title: 'SSL Certificate Renewal', scheduled: '2026-05-01 00:00-00:30', status: 'completed', impact: 'None', teams: ['Security'] },
  { id: 'MAINT-043', title: 'Rust Gateway Engine Deploy', scheduled: '2026-04-28 03:00-03:15', status: 'completed', impact: 'None - Blue/green deploy', teams: ['Platform'] },
  { id: 'MAINT-042', title: 'OpenSearch Index Rebuild', scheduled: '2026-04-25 02:00-06:00', status: 'completed', impact: 'Partial - Search degraded', teams: ['Search', 'Backend'] },
];

const statusColors: Record<string, string> = { scheduled: 'bg-blue-100 text-blue-800', in_progress: 'bg-yellow-100 text-yellow-800', completed: 'bg-green-100 text-green-800', cancelled: 'bg-gray-100 text-gray-800' };

export function MaintenanceDashboard() {
  const fetcher = useCallback(() =>
    lakehouseAPI.fetch<{ windows: typeof windows }>('/api/v1/maintenance/windows')
      .then(d => d.windows)
      .catch((err: unknown) => { logger.error("API fallback:", err); return windows; }), []);
  const { data: apiWindows } = useLakehouseData(fetcher, 30000);
  const activeWindows = apiWindows || windows;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Wrench className="h-6 w-6" /> Maintenance Mode</h2><p className="text-sm text-gray-500 mt-1">Schedule and manage platform maintenance windows</p></div>
        <button className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700"><Calendar className="h-4 w-4" /> Schedule Window</button>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border p-4"><div className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-yellow-500" /><div><div className="font-medium">Platform Status</div><div className="text-sm text-green-600">Fully Operational</div></div></div></div>
        <div className="bg-white rounded-lg border p-4"><div className="text-2xl font-bold text-blue-600">{activeWindows.filter(w => w.status === 'scheduled').length}</div><div className="text-sm text-gray-500">Upcoming Windows</div></div>
        <div className="bg-white rounded-lg border p-4"><div className="text-2xl font-bold text-green-600">{activeWindows.filter(w => w.status === 'completed').length}</div><div className="text-sm text-gray-500">Completed (30d)</div></div>
      </div>
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b"><tr><th className="text-left px-4 py-3 font-medium text-gray-600">ID</th><th className="text-left px-4 py-3 font-medium text-gray-600">Title</th><th className="text-left px-4 py-3 font-medium text-gray-600">Scheduled</th><th className="text-left px-4 py-3 font-medium text-gray-600">Impact</th><th className="text-left px-4 py-3 font-medium text-gray-600">Teams</th><th className="text-left px-4 py-3 font-medium text-gray-600">Status</th></tr></thead>
          <tbody className="divide-y">
            {activeWindows.map(w => (
              <tr key={w.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs">{w.id}</td>
                <td className="px-4 py-3 font-medium">{w.title}</td>
                <td className="px-4 py-3 text-xs">{w.scheduled}</td>
                <td className="px-4 py-3 text-xs">{w.impact}</td>
                <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{w.teams.map(t => <span key={t} className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">{t}</span>)}</div></td>
                <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[w.status]}`}>{w.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
