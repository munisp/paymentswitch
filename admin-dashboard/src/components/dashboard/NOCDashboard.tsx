'use client';

import React, { useEffect, useState } from 'react';
import { Activity, CheckCircle, Clock, Wallet } from 'lucide-react';
import { MetricCard, MetricGrid } from './MetricCard';
import { ParticipantHealthGrid } from './ParticipantHealth';
import { KillSwitchPanel } from './KillSwitchPanel';
import { Card, CardHeader, CardTitle, CardContent } from '../common/Card';
import { Badge } from '../common/Badge';
import { formatDateTime, formatCurrency } from '@/lib/utils';
import {
  lakehouseAPI,
  type NOCMetrics,
  type ParticipantHealth,
  type KillSwitch,
  type Transaction,
} from '@/lib/api';
import { createLogger } from '@/lib/logger';

const log = createLogger('NOCDashboard');

export function NOCDashboard() {
  const [metrics, setMetrics] = useState<NOCMetrics | null>(null);
  const [participants, setParticipants] = useState<ParticipantHealth[]>([]);
  const [killSwitches, setKillSwitches] = useState<KillSwitch[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);

  // The view displays only persisted operational-read-model records. A failure is
  // rendered as unavailable; it is never replaced with synthetic values.
  useEffect(() => {
    let active = true;

    const loadNocData = async () => {
      try {
        const nocData = await lakehouseAPI.getNOCMetrics();
        if (!active) return;
        setMetrics(nocData);
        setParticipants(nocData.participant_health);
        setKillSwitches(nocData.kill_switches);
        setRecentTransactions(nocData.recent_transactions);
      } catch (error) {
        if (active) {
          log.error('NOC API is unavailable; no synthetic dashboard data will be displayed', error);
        }
      }
    };

    void loadNocData();
    return () => {
      active = false;
    };
  }, []);

  const handleActivateKillSwitch = async (id: string, reason: string) => {
    await lakehouseAPI.activateKillSwitch(id, reason);
  };

  const handleDeactivateKillSwitch = async (id: string) => {
    await lakehouseAPI.deactivateKillSwitch(id);
  };

  if (!metrics) {
    return (
      <Card>
        <CardHeader><CardTitle>NOC data unavailable</CardTitle></CardHeader>
        <CardContent className="text-sm text-gray-600">
          No live NOC metrics were returned by the operational read model. Synthetic values are intentionally disabled.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <MetricGrid columns={4}>
        <MetricCard
          title={metrics.tps.label}
          value={metrics.tps.value}
          change={metrics.tps.change}
          changeLabel={metrics.tps.change_label}
          trend={metrics.tps.trend}
          format="number"
          icon={<Activity className="h-5 w-5" />}
        />
        <MetricCard
          title={metrics.success_rate.label}
          value={metrics.success_rate.value}
          change={metrics.success_rate.change}
          changeLabel={metrics.success_rate.change_label}
          trend={metrics.success_rate.trend}
          format="percentage"
          icon={<CheckCircle className="h-5 w-5" />}
        />
        <MetricCard
          title={metrics.avg_latency.label}
          value={`${metrics.avg_latency.value}ms`}
          change={metrics.avg_latency.change}
          changeLabel={metrics.avg_latency.change_label}
          trend={metrics.avg_latency.trend}
          icon={<Clock className="h-5 w-5" />}
        />
        <MetricCard
          title={metrics.daily_volume.label}
          value={metrics.daily_volume.value}
          change={metrics.daily_volume.change}
          changeLabel={metrics.daily_volume.change_label}
          trend={metrics.daily_volume.trend}
          format="currency"
          icon={<Wallet className="h-5 w-5" />}
        />
      </MetricGrid>

      <Card>
        <CardHeader><CardTitle>Historical performance series unavailable</CardTitle></CardHeader>
        <CardContent className="text-sm text-gray-600">
          The current PostgreSQL operational read model does not expose a persisted time-series projection. The dashboard does not draw a substitute chart.
        </CardContent>
      </Card>

      <ParticipantHealthGrid
        participants={participants}
        onParticipantClick={(participantId) => log.info('Participant selected', { participantId })}
      />

      <div className="grid grid-cols-1 gap-6">
        <KillSwitchPanel
          killSwitches={killSwitches}
          onActivate={handleActivateKillSwitch}
          onDeactivate={handleDeactivateKillSwitch}
        />
        <Card>
          <CardHeader><CardTitle>Global emergency control unavailable</CardTitle></CardHeader>
          <CardContent className="text-sm text-gray-600">
            No authoritative global kill-switch command endpoint is registered in the platform. The dashboard does not simulate a global halt locally.
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent Transactions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Transfer ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Payer</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Payee</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Latency</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {recentTransactions.map((transaction) => (
                  <tr key={transaction.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-primary-600">{transaction.id}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{transaction.payer}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{transaction.payee}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatCurrency(transaction.amount, transaction.currency)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Badge status={transaction.status}>{transaction.status}</Badge>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {transaction.latency_ms === undefined ? 'Unavailable' : `${transaction.latency_ms}ms`}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatDateTime(transaction.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
