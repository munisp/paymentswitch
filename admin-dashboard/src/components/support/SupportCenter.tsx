import { logger } from "@/lib/logger";
import React, { useState, useCallback } from 'react';
import { lakehouseAPI, useLakehouseData } from '@/lib/api';
import { HeadphonesIcon, Search, Plus, MessageSquare, Clock, CheckCircle, AlertCircle, User } from 'lucide-react';

const tickets = [
  { id: 'TKT-4501', subject: 'Failed transfer to GTBank', customer: 'Oluwaseun A.', priority: 'high', status: 'open', category: 'Transfer Issue', assignee: 'Support L2', createdAt: '2026-05-02 15:30', lastUpdate: '10 min ago' },
  { id: 'TKT-4500', subject: 'Cannot complete KYC verification', customer: 'Fatima B.', priority: 'medium', status: 'in_progress', category: 'KYC', assignee: 'KYC Team', createdAt: '2026-05-02 14:15', lastUpdate: '25 min ago' },
  { id: 'TKT-4499', subject: 'Double charge on card payment', customer: 'Chidi N.', priority: 'critical', status: 'escalated', category: 'Billing', assignee: 'Finance', createdAt: '2026-05-02 12:00', lastUpdate: '1 hr ago' },
  { id: 'TKT-4498', subject: 'API integration 500 errors', customer: 'TechCo Ltd', priority: 'high', status: 'in_progress', category: 'API', assignee: 'Dev Team', createdAt: '2026-05-02 10:30', lastUpdate: '2 hrs ago' },
  { id: 'TKT-4497', subject: 'Settlement delay for 3 days', customer: 'MerchantPro', priority: 'high', status: 'open', category: 'Settlement', assignee: 'Treasury', createdAt: '2026-05-01 16:45', lastUpdate: '5 hrs ago' },
  { id: 'TKT-4496', subject: 'Password reset not working', customer: 'Ibrahim M.', priority: 'low', status: 'resolved', category: 'Account', assignee: 'Support L1', createdAt: '2026-05-01 09:20', lastUpdate: '1 day ago' },
  { id: 'TKT-4495', subject: 'Webhook delivery failures', customer: 'PayFast Ltd', priority: 'medium', status: 'resolved', category: 'Integration', assignee: 'Dev Team', createdAt: '2026-04-30 14:10', lastUpdate: '2 days ago' },
];

const statusColors: Record<string, string> = { open: 'bg-yellow-100 text-yellow-800', in_progress: 'bg-blue-100 text-blue-800', escalated: 'bg-red-100 text-red-800', resolved: 'bg-green-100 text-green-800', closed: 'bg-gray-100 text-gray-800' };
const priorityColors: Record<string, string> = { low: 'text-gray-500', medium: 'text-yellow-600', high: 'text-orange-600', critical: 'text-red-600' };

export function SupportCenter() {
  const ticketFetcher = useCallback(() =>
    lakehouseAPI.fetch<{ tickets: typeof tickets }>('/api/v1/support/tickets')
      .then(d => d.tickets)
      .catch((err: unknown) => { logger.error("API fallback:", err); return tickets; }), []);
  const { data: apiTickets } = useLakehouseData(ticketFetcher, 15000);
  const activeTickets = apiTickets || tickets;
  const [search, setSearch] = useState('');
  const filtered = activeTickets.filter(t => search === '' || t.subject.toLowerCase().includes(search.toLowerCase()) || t.customer.toLowerCase().includes(search.toLowerCase()) || t.id.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><HeadphonesIcon className="h-6 w-6" /> Support Center</h2>
          <p className="text-sm text-gray-500 mt-1">Manage customer support tickets and escalations</p>
        </div>
        <button className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700"><Plus className="h-4 w-4" /> New Ticket</button>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border p-4"><div className="text-2xl font-bold text-yellow-600">{tickets.filter(t => t.status === 'open').length}</div><div className="text-sm text-gray-500">Open</div></div>
        <div className="bg-white rounded-lg border p-4"><div className="text-2xl font-bold text-blue-600">{tickets.filter(t => t.status === 'in_progress').length}</div><div className="text-sm text-gray-500">In Progress</div></div>
        <div className="bg-white rounded-lg border p-4"><div className="text-2xl font-bold text-red-600">{tickets.filter(t => t.status === 'escalated').length}</div><div className="text-sm text-gray-500">Escalated</div></div>
        <div className="bg-white rounded-lg border p-4"><div className="text-2xl font-bold text-green-600">{tickets.filter(t => t.status === 'resolved').length}</div><div className="text-sm text-gray-500">Resolved</div></div>
      </div>
      <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" /><input type="text" placeholder="Search tickets..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm" /></div>
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b"><tr><th className="text-left px-4 py-3 font-medium text-gray-600">ID</th><th className="text-left px-4 py-3 font-medium text-gray-600">Subject</th><th className="text-left px-4 py-3 font-medium text-gray-600">Customer</th><th className="text-left px-4 py-3 font-medium text-gray-600">Category</th><th className="text-left px-4 py-3 font-medium text-gray-600">Priority</th><th className="text-left px-4 py-3 font-medium text-gray-600">Status</th><th className="text-left px-4 py-3 font-medium text-gray-600">Assignee</th><th className="text-left px-4 py-3 font-medium text-gray-600">Last Update</th></tr></thead>
          <tbody className="divide-y">
            {filtered.map(t => (
              <tr key={t.id} className="hover:bg-gray-50 cursor-pointer">
                <td className="px-4 py-3 font-mono text-xs">{t.id}</td>
                <td className="px-4 py-3 font-medium">{t.subject}</td>
                <td className="px-4 py-3">{t.customer}</td>
                <td className="px-4 py-3">{t.category}</td>
                <td className="px-4 py-3"><span className={`font-medium ${priorityColors[t.priority]}`}>{t.priority}</span></td>
                <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[t.status]}`}>{t.status.replace(/_/g, ' ')}</span></td>
                <td className="px-4 py-3">{t.assignee}</td>
                <td className="px-4 py-3 text-gray-500">{t.lastUpdate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
