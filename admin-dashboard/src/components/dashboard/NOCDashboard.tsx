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

// Default data generators
const generateDefaultMetrics = (): DashboardMetrics => ({
  tps: 1247 + Math.random() * 100,
  successRate: 99.2 + Math.random() * 0.5,
  avgLatencyMs: 45 + Math.random() * 10,
  activeParticipants: 24,
  pendingSettlements: 3,
  openAlerts: 12,
  totalTransactionsToday: 2847392,
  totalVolumeToday: 15234567800,
  currency: 'NGN',
});

const generateDefaultChartData = () => {
  const data = [];
  const now = new Date();
  for (let i = 59; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 60000);
    data.push({
      timestamp: time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      tps: 1000 + Math.random() * 500,
      successRate: 98 + Math.random() * 2,
      latency: 40 + Math.random() * 20,
    });
  }
  return data;
};

const generateDefaultParticipants = (): ParticipantHealth[] => [
  { fspId: 'firstbank', name: 'FirstBank', status: 'HEALTHY', tps: 156.3, successRate: 99.8, avgLatencyMs: 42, lastTransactionAt: new Date().toISOString(), errorRate: 0.2 },
  { fspId: 'gtbank', name: 'GTBank', status: 'HEALTHY', tps: 142.1, successRate: 99.5, avgLatencyMs: 38, lastTransactionAt: new Date().toISOString(), errorRate: 0.5 },
  { fspId: 'zenith', name: 'Zenith Bank', status: 'HEALTHY', tps: 134.8, successRate: 99.7, avgLatencyMs: 45, lastTransactionAt: new Date().toISOString(), errorRate: 0.3 },
  { fspId: 'uba', name: 'UBA', status: 'DEGRADED', tps: 89.2, successRate: 97.2, avgLatencyMs: 78, lastTransactionAt: new Date().toISOString(), errorRate: 2.8 },
  { fspId: 'access', name: 'Access Bank', status: 'HEALTHY', tps: 128.5, successRate: 99.4, avgLatencyMs: 41, lastTransactionAt: new Date().toISOString(), errorRate: 0.6 },
  { fspId: 'stanbic', name: 'Stanbic IBTC', status: 'HEALTHY', tps: 67.3, successRate: 99.9, avgLatencyMs: 35, lastTransactionAt: new Date().toISOString(), errorRate: 0.1 },
  { fspId: 'fidelity', name: 'Fidelity Bank', status: 'HEALTHY', tps: 54.2, successRate: 99.6, avgLatencyMs: 48, lastTransactionAt: new Date().toISOString(), errorRate: 0.4 },
  { fspId: 'sterling', name: 'Sterling Bank', status: 'DOWN', tps: 0, successRate: 0, avgLatencyMs: 0, lastTransactionAt: new Date(Date.now() - 300000).toISOString(), errorRate: 100 },
  { fspId: 'wema', name: 'Wema Bank', status: 'HEALTHY', tps: 45.8, successRate: 99.3, avgLatencyMs: 52, lastTransactionAt: new Date().toISOString(), errorRate: 0.7 },
  { fspId: 'fcmb', name: 'FCMB', status: 'HEALTHY', tps: 78.4, successRate: 99.5, avgLatencyMs: 44, lastTransactionAt: new Date().toISOString(), errorRate: 0.5 },
  { fspId: 'ecobank', name: 'Ecobank', status: 'HEALTHY', tps: 62.1, successRate: 99.7, avgLatencyMs: 39, lastTransactionAt: new Date().toISOString(), errorRate: 0.3 },
  { fspId: 'keystone', name: 'Keystone Bank', status: 'HEALTHY', tps: 34.5, successRate: 99.4, avgLatencyMs: 55, lastTransactionAt: new Date().toISOString(), errorRate: 0.6 },
];

const generateDefaultKillSwitches = (): KillSwitch[] => [
  { id: 'ks-1', name: 'Global Transaction Halt', type: 'GLOBAL', scope: { type: 'GLOBAL' }, status: 'INACTIVE' },
  { id: 'ks-2', name: 'Sterling Bank Suspend', type: 'PARTICIPANT', scope: { type: 'PARTICIPANT', value: 'sterling' }, status: 'ACTIVE', activatedAt: new Date(Date.now() - 1800000).toISOString(), activatedBy: 'admin@payment-switch.com', reason: 'Technical issues reported' },
  { id: 'ks-3', name: 'USD Transactions', type: 'CURRENCY', scope: { type: 'CURRENCY', value: 'USD' }, status: 'INACTIVE' },
  { id: 'ks-4', name: 'Cross-border Transfers', type: 'TRANSACTION_TYPE', scope: { type: 'TRANSACTION_TYPE', value: 'CROSS_BORDER' }, status: 'INACTIVE' },
];

const generateRecentTransactions = (): Transaction[] => [
  { id: 'txn-1', transferId: 'TRF-2024-001234', payerFsp: 'firstbank', payeeFsp: 'gtbank', amount: 5000000, currency: 'NGN', state: 'COMMITTED', createdAt: new Date(Date.now() - 5000).toISOString(), latencyMs: 42 },
  { id: 'txn-2', transferId: 'TRF-2024-001235', payerFsp: 'zenith', payeeFsp: 'uba', amount: 15000000, currency: 'NGN', state: 'COMMITTED', createdAt: new Date(Date.now() - 8000).toISOString(), latencyMs: 38 },
  { id: 'txn-3', transferId: 'TRF-2024-001236', payerFsp: 'access', payeeFsp: 'firstbank', amount: 2500000, currency: 'NGN', state: 'FAILED', createdAt: new Date(Date.now() - 12000).toISOString(), errorCode: '3100', errorMessage: 'Insufficient funds' },
  { id: 'txn-4', transferId: 'TRF-2024-001237', payerFsp: 'gtbank', payeeFsp: 'stanbic', amount: 8750000, currency: 'NGN', state: 'COMMITTED', createdAt: new Date(Date.now() - 15000).toISOString(), latencyMs: 55 },
  { id: 'txn-5', transferId: 'TRF-2024-001238', payerFsp: 'fidelity', payeeFsp: 'wema', amount: 3200000, currency: 'NGN', state: 'RESERVED', createdAt: new Date(Date.now() - 2000).toISOString() },
];

export function NOCDashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics>(generateDefaultMetrics());
  const [chartData, setChartData] = useState(generateDefaultChartData());
  const [participants, setParticipants] = useState<ParticipantHealth[]>(generateDefaultParticipants());
  const [killSwitches, setKillSwitches] = useState<KillSwitch[]>(generateDefaultKillSwitches());
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>(generateRecentTransactions());
  const [isGlobalHalted, setIsGlobalHalted] = useState(false);

  // Try to fetch from API first, fall back to default data
  useEffect(() => {
    (async () => {
      try {
        const { lakehouseAPI } = await import('@/lib/api');
        const nocData = await lakehouseAPI.getNOCMetrics();
        if (nocData?.participant_health) setParticipants(nocData.participant_health as unknown as ParticipantHealth[]);
      } catch (err) { log.error('NOC API unavailable, using defaults:', err); }
    })();
  }, []);

  // Simulate real-time updates
  useEffect(() => {
    const interval = setInterval(() => {
      setMetrics(generateDefaultMetrics());
      setChartData((prev) => {
        const newData = [...prev.slice(1)];
        const now = new Date();
        newData.push({
          timestamp: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          tps: 1000 + Math.random() * 500,
          successRate: 98 + Math.random() * 2,
          latency: 40 + Math.random() * 20,
        });
        return newData;
      });
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const handleActivateKillSwitch = async (id: string, reason: string) => {
    setKillSwitches((prev) =>
      prev.map((ks) =>
        ks.id === id
          ? {
              ...ks,
              status: 'ACTIVE',
              activatedAt: new Date().toISOString(),
              activatedBy: 'admin@payment-switch.com',
              reason,
            }
          : ks
      )
    );
  };

  const handleDeactivateKillSwitch = async (id: string) => {
    setKillSwitches((prev) =>
      prev.map((ks) =>
        ks.id === id
          ? {
              ...ks,
              status: 'INACTIVE',
              deactivatedAt: new Date().toISOString(),
              deactivatedBy: 'admin@payment-switch.com',
            }
          : ks
      )
    );
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
