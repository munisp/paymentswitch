'use client';

import { useState, useEffect, useCallback } from 'react';

const webhookData = [
  { id: 'WH-001', url: 'https://api.firstbank.ng/webhooks/ps', events: ['payment.success', 'payment.failed', 'settlement.complete'], status: 'active', lastDelivery: '2026-05-02 16:44', successRate: 99.8 },
  { id: 'WH-002', url: 'https://hooks.gtbank.com/payment-switch', events: ['payment.success', 'dispute.created'], status: 'active', lastDelivery: '2026-05-02 16:42', successRate: 98.5 },
  { id: 'WH-003', url: 'https://zenith-api.com/webhooks/receive', events: ['payment.success', 'payment.failed', 'refund.processed'], status: 'degraded', lastDelivery: '2026-05-02 16:30', successRate: 85.2 },
  { id: 'WH-004', url: 'https://uba-integration.ng/callback', events: ['settlement.complete', 'batch.processed'], status: 'active', lastDelivery: '2026-05-02 16:40', successRate: 99.1 },
  { id: 'WH-005', url: 'https://failing-endpoint.test/hook', events: ['payment.success'], status: 'failed', lastDelivery: '2026-05-01 08:00', successRate: 12.5 },
];

const statusColors: Record<string, string> = { active: 'bg-green-100 text-green-800', degraded: 'bg-yellow-100 text-yellow-800', failed: 'bg-red-100 text-red-800', disabled: 'bg-gray-100 text-gray-800' };

export function WebhookConfig() {
  const [activeWebhooks, setActiveWebhooks] = useState(webhookData);

  const fetchWebhooks = useCallback(async () => {
    try {
      const apiUrl = 'http://localhost:8080';
      const resp = await fetch(`${apiUrl}/api/v1/webhooks`, {
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.webhooks) setActiveWebhooks(data.webhooks);
      }
    } catch {
      // API unreachable — use default data
    }
  }, []);

  useEffect(() => {
    fetchWebhooks();
    const interval = setInterval(fetchWebhooks, 15000);
    return () => clearInterval(interval);
  }, [fetchWebhooks]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 .64 7.95"/></svg>
            {' '}Webhook Configuration
          </h2>
          <p className="text-sm text-gray-500 mt-1">Manage webhook endpoints and delivery with Go high-performance dispatcher</p>
        </div>
        <button className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
          {' '}Add Endpoint
        </button>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border p-4"><div className="text-2xl font-bold text-green-600">{activeWebhooks.filter(w => w.status === 'active').length}</div><div className="text-sm text-gray-500">Active Endpoints</div></div>
        <div className="bg-white rounded-lg border p-4"><div className="text-2xl font-bold text-yellow-600">{activeWebhooks.filter(w => w.status === 'degraded').length}</div><div className="text-sm text-gray-500">Degraded</div></div>
        <div className="bg-white rounded-lg border p-4"><div className="text-2xl font-bold text-red-600">{activeWebhooks.filter(w => w.status === 'failed').length}</div><div className="text-sm text-gray-500">Failed</div></div>
      </div>
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b"><tr><th className="text-left px-4 py-3 font-medium text-gray-600">Endpoint</th><th className="text-left px-4 py-3 font-medium text-gray-600">Events</th><th className="text-left px-4 py-3 font-medium text-gray-600">Status</th><th className="text-left px-4 py-3 font-medium text-gray-600">Success Rate</th><th className="text-left px-4 py-3 font-medium text-gray-600">Last Delivery</th><th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th></tr></thead>
          <tbody className="divide-y">
            {activeWebhooks.map(w => (
              <tr key={w.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs max-w-xs truncate">{w.url}</td>
                <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{w.events.slice(0, 2).map(e => <span key={e} className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">{e}</span>)}{w.events.length > 2 && <span className="text-xs text-gray-400">+{w.events.length - 2}</span>}</div></td>
                <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[w.status]}`}>{w.status}</span></td>
                <td className="px-4 py-3"><span className={w.successRate > 95 ? 'text-green-600' : w.successRate > 80 ? 'text-yellow-600' : 'text-red-600'}>{w.successRate}%</span></td>
                <td className="px-4 py-3 text-xs">{w.lastDelivery}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button className="p-1 hover:bg-gray-100 rounded" title="Refresh">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
                    </button>
                    <button className="p-1 hover:bg-gray-100 rounded" title="Edit">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                    </button>
                    <button className="p-1 hover:bg-gray-100 rounded" title="Delete">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
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
