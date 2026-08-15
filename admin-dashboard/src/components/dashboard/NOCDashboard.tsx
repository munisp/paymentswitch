import React, { useState, useEffect } from 'react';
import {
  Activity,
  TrendingUp,
  Clock,
  Users,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Wallet,
} from 'lucide-react';
import { MetricCard, MetricGrid } from './MetricCard';
import { TransactionChart, MultiLineChart } from './TransactionChart';
import { ParticipantHealthGrid } from './ParticipantHealth';
import { KillSwitchPanel, EmergencyActions } from './KillSwitchPanel';
import { Card, CardHeader, CardTitle, CardContent } from '../common/Card';
import { Badge } from '../common/Badge';
import { formatDateTime, formatCurrency } from '@/lib/utils';
import type { DashboardMetrics, ParticipantHealth, KillSwitch, Transaction } from '@/types';
import { createLogger } from '@/lib/logger';
const log = createLogger('NOCDashboard');

export function NOCDashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [chartData, setChartData] = useState<Array<{ timestamp: string; tps: number; successRate: number; latency: number }>>([]);
  const [participants, setParticipants] = useState<ParticipantHealth[]>([]);
  const [killSwitches, setKillSwitches] = useState<KillSwitch[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [isGlobalHalted, setIsGlobalHalted] = useState(false);

  // Render only backend-sourced data; synthetic defaults are prohibited.
  useEffect(() => {
    (async () => {
      try {
        const { lakehouseAPI } = await import('@/lib/api');
        const nocData = await lakehouseAPI.getNOCMetrics();
        if (nocData?.metrics) setMetrics(nocData.metrics as DashboardMetrics);
        if (nocData?.chart_data) setChartData(nocData.chart_data as typeof chartData);
        if (nocData?.participant_health) setParticipants(nocData.participant_health as unknown as ParticipantHealth[]);
        if (nocData?.kill_switches) setKillSwitches(nocData.kill_switches as unknown as KillSwitch[]);
        if (nocData?.recent_transactions) setRecentTransactions(nocData.recent_transactions as unknown as Transaction[]);
      } catch (err) { log.error('NOC API unavailable, using defaults:', err); }
    })();
  }, []);

  if (!metrics) {
    return (
      <Card>
        <CardHeader><CardTitle>NOC data unavailable</CardTitle></CardHeader>
        <CardContent className="text-sm text-gray-600">No live NOC metrics were returned by the backend. Synthetic values are intentionally disabled.</CardContent>
      </Card>
    );
  }

  const handleActivateKillSwitch = async (id: string, reason: string) => {
    log.error({ id, reason }, 'Kill-switch activation endpoint is not wired; refusing local-only mutation');
    throw new Error('Kill-switch activation is unavailable until the backend command endpoint is connected');
  };

  const handleDeactivateKillSwitch = async (id: string) => {
    log.error({ id }, 'Kill-switch deactivation endpoint is not wired; refusing local-only mutation');
    throw new Error('Kill-switch deactivation is unavailable until the backend command endpoint is connected');
  };

  return (
    <div className="space-y-6">
      {/* Key Metrics */}
      <MetricGrid columns={4}>
        <MetricCard
          title="Transactions Per Second"
          value={metrics.tps.toFixed(0)}
          change={5.2}
          trend="up"
          icon={<Activity className="h-5 w-5" />}
        />
        <MetricCard
          title="Success Rate"
          value={metrics.successRate}
          format="percentage"
          change={0.3}
          trend="up"
          icon={<CheckCircle className="h-5 w-5" />}
        />
        <MetricCard
          title="Avg Latency"
          value={`${metrics.avgLatencyMs.toFixed(0)}ms`}
          change={-2.1}
          trend="down"
          icon={<Clock className="h-5 w-5" />}
        />
        <MetricCard
          title="Today's Volume"
          value={metrics.totalVolumeToday}
          format="currency"
          change={12.5}
          trend="up"
          icon={<Wallet className="h-5 w-5" />}
        />
      </MetricGrid>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TransactionChart
          data={chartData}
          title="Transaction Rate (TPS)"
          dataKey="tps"
          color="#0ea5e9"
          type="area"
        />
        <MultiLineChart
          data={chartData}
          title="Performance Metrics"
          lines={[
            { dataKey: 'successRate', color: '#22c55e', name: 'Success Rate (%)' },
            { dataKey: 'latency', color: '#f59e0b', name: 'Latency (ms)' },
          ]}
        />
      </div>

      {/* Participant Health */}
      <ParticipantHealthGrid
        participants={participants}
        onParticipantClick={(fspId) => log.info('Clicked participant:', fspId)}
      />

      {/* Kill Switches and Emergency Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <KillSwitchPanel
            killSwitches={killSwitches}
            onActivate={handleActivateKillSwitch}
            onDeactivate={handleDeactivateKillSwitch}
          />
        </div>
        <EmergencyActions
          isGlobalHalted={isGlobalHalted}
          onGlobalHalt={() => setIsGlobalHalted(true)}
          onResumeAll={() => setIsGlobalHalted(false)}
        />
      </div>

      {/* Recent Transactions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent Transactions</CardTitle>
          <button className="text-sm text-primary-600 hover:text-primary-700 font-medium">
            View All
          </button>
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
                {recentTransactions.map((txn) => (
                  <tr key={txn.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-primary-600">
                      {txn.transferId}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{txn.payerFsp}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{txn.payeeFsp}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatCurrency(txn.amount, txn.currency)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Badge status={txn.state}>{txn.state}</Badge>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {txn.latencyMs ? `${txn.latencyMs}ms` : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDateTime(txn.createdAt)}
                    </td>
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
