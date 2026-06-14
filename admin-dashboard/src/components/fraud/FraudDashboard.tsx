import { logger } from "@/lib/logger";
import React, { useState, useCallback, useEffect } from 'react';
import { lakehouseAPI, useLakehouseData } from '@/lib/api';
import {
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Eye,
  ThumbsUp,
  ThumbsDown,
  Filter,
  Search,
  TrendingUp,
  Activity,
  Zap,
  Clock,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../common/Card';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { Modal } from '../common/Modal';
import { Select, Textarea } from '../common/Input';
import { MetricCard, MetricGrid } from '../dashboard/MetricCard';
import { TransactionChart } from '../dashboard/TransactionChart';
import { formatCurrency, formatDateTime, cn } from '@/lib/utils';
import type { FraudAlert, FraudRule, AlertSeverity } from '@/types';

const defaultAlerts: FraudAlert[] = [
  {
    id: 'fa-001',
    transactionId: 'TRF-2024-001234',
    alertType: 'VELOCITY_BREACH',
    severity: 'HIGH',
    riskScore: 87,
    mlConfidence: 0.92,
    status: 'OPEN',
    createdAt: new Date(Date.now() - 300000).toISOString(),
    details: {
      payerFsp: 'firstbank',
      payeeFsp: 'gtbank',
      amount: 15000000,
      currency: 'NGN',
      triggerRules: ['VELOCITY_10MIN', 'AMOUNT_THRESHOLD'],
    },
  },
  {
    id: 'fa-002',
    transactionId: 'TRF-2024-001235',
    alertType: 'ML_DETECTION',
    severity: 'CRITICAL',
    riskScore: 95,
    mlConfidence: 0.98,
    status: 'INVESTIGATING',
    createdAt: new Date(Date.now() - 600000).toISOString(),
    details: {
      payerFsp: 'zenith',
      payeeFsp: 'uba',
      amount: 50000000,
      currency: 'NGN',
      triggerRules: ['ML_ANOMALY', 'PATTERN_MATCH'],
      mlFeatures: {
        amount_zscore: 3.2,
        velocity_score: 0.89,
        time_anomaly: 0.76,
      },
    },
  },
  {
    id: 'fa-003',
    transactionId: 'TRF-2024-001236',
    alertType: 'SANCTIONS_HIT',
    severity: 'CRITICAL',
    riskScore: 99,
    mlConfidence: 1.0,
    status: 'ESCALATED',
    createdAt: new Date(Date.now() - 1800000).toISOString(),
    details: {
      payerFsp: 'access',
      payeeFsp: 'stanbic',
      amount: 25000000,
      currency: 'NGN',
      triggerRules: ['OFAC_MATCH', 'PEP_MATCH'],
    },
  },
  {
    id: 'fa-004',
    transactionId: 'TRF-2024-001237',
    alertType: 'AMOUNT_ANOMALY',
    severity: 'MEDIUM',
    riskScore: 65,
    mlConfidence: 0.78,
    status: 'OPEN',
    createdAt: new Date(Date.now() - 900000).toISOString(),
    details: {
      payerFsp: 'fidelity',
      payeeFsp: 'wema',
      amount: 8500000,
      currency: 'NGN',
      triggerRules: ['AMOUNT_DEVIATION'],
    },
  },
  {
    id: 'fa-005',
    transactionId: 'TRF-2024-001238',
    alertType: 'PATTERN_MATCH',
    severity: 'LOW',
    riskScore: 45,
    mlConfidence: 0.65,
    status: 'RESOLVED',
    createdAt: new Date(Date.now() - 7200000).toISOString(),
    resolvedAt: new Date(Date.now() - 3600000).toISOString(),
    resolvedBy: 'analyst@payment-switch.com',
    resolution: 'FALSE_POSITIVE',
    details: {
      payerFsp: 'gtbank',
      payeeFsp: 'firstbank',
      amount: 2500000,
      currency: 'NGN',
      triggerRules: ['ROUND_AMOUNT'],
    },
  },
];

const defaultRules: FraudRule[] = [
  {
    id: 'fr-001',
    name: 'High Velocity Detection',
    description: 'Triggers when more than 10 transactions occur within 10 minutes from the same account',
    type: 'VELOCITY',
    enabled: true,
    priority: 1,
    conditions: [
      { field: 'transaction_count', operator: 'gt', value: 10 },
      { field: 'time_window', operator: 'lte', value: 600 },
    ],
    actions: [
      { type: 'ALERT', severity: 'HIGH' },
      { type: 'FLAG' },
    ],
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-12-01T14:30:00Z',
    createdBy: 'admin@payment-switch.com',
  },
  {
    id: 'fr-002',
    name: 'Large Amount Threshold',
    description: 'Flags transactions above 10 million NGN for review',
    type: 'AMOUNT',
    enabled: true,
    priority: 2,
    conditions: [
      { field: 'amount', operator: 'gt', value: 1000000000 },
    ],
    actions: [
      { type: 'REVIEW' },
      { type: 'LOG' },
    ],
    createdAt: '2024-01-20T09:00:00Z',
    updatedAt: '2024-11-15T11:00:00Z',
    createdBy: 'admin@payment-switch.com',
  },
];

const generateChartData = () => {
  const data = [];
  for (let i = 23; i >= 0; i--) {
    data.push({
      timestamp: `${23 - i}:00`,
      alerts: Math.floor(Math.random() * 20) + 5,
      blocked: Math.floor(Math.random() * 5),
    });
  }
  return data;
};

export function FraudDashboard() {
  const [alerts, setAlerts] = useState<FraudAlert[]>(defaultAlerts);
  const fetcher = useCallback(() => lakehouseAPI.getFraudMetrics().then(m => m.alerts as unknown as FraudAlert[]).catch((err: unknown) => { logger.error("API fallback:", err); return []; }), []);
  const { data: apiAlerts } = useLakehouseData(fetcher, 30000);
  useEffect(() => { if (apiAlerts && apiAlerts.length > 0) setAlerts(apiAlerts); }, [apiAlerts]);
  const [selectedAlert, setSelectedAlert] = useState<FraudAlert | null>(null);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [activeTab, setActiveTab] = useState<'alerts' | 'rules'>('alerts');

  const chartData = generateChartData();

  const openAlerts = alerts.filter(a => a.status === 'OPEN').length;
  const criticalAlerts = alerts.filter(a => a.severity === 'CRITICAL' && a.status !== 'RESOLVED').length;
  const resolvedToday = alerts.filter(a => a.status === 'RESOLVED').length;

  const filteredAlerts = alerts.filter(a => {
    const matchesStatus = statusFilter === 'all' || a.status === statusFilter;
    const matchesSeverity = severityFilter === 'all' || a.severity === severityFilter;
    return matchesStatus && matchesSeverity;
  });

  const handleResolve = (alertId: string, resolution: string) => {
    setAlerts(prev =>
      prev.map(a =>
        a.id === alertId
          ? {
              ...a,
              status: 'RESOLVED',
              resolvedAt: new Date().toISOString(),
              resolvedBy: 'analyst@payment-switch.com',
              resolution,
            }
          : a
      )
    );
    setShowAlertModal(false);
  };

  return (
    <div className="space-y-6">
      {/* Summary Metrics */}
      <MetricGrid columns={4}>
        <MetricCard
          title="Open Alerts"
          value={openAlerts}
          change={-15}
          trend="down"
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <MetricCard
          title="Critical Alerts"
          value={criticalAlerts}
          icon={<Shield className="h-5 w-5" />}
        />
        <MetricCard
          title="Resolved Today"
          value={resolvedToday}
          change={25}
          trend="up"
          icon={<CheckCircle className="h-5 w-5" />}
        />
        <MetricCard
          title="Avg Resolution Time"
          value="12m"
          change={-8}
          trend="down"
          icon={<Clock className="h-5 w-5" />}
        />
      </MetricGrid>

      {/* Alert Trend Chart */}
      <TransactionChart
        data={chartData}
        title="Alerts Over Time (24h)"
        dataKey="alerts"
        color="#ef4444"
        type="bar"
        height={200}
      />

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8">
          <button
            onClick={() => setActiveTab('alerts')}
            className={cn(
              'py-4 px-1 border-b-2 font-medium text-sm',
              activeTab === 'alerts'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            )}
          >
            Alert Queue ({openAlerts})
          </button>
          <button
            onClick={() => setActiveTab('rules')}
            className={cn(
              'py-4 px-1 border-b-2 font-medium text-sm',
              activeTab === 'rules'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            )}
          >
            Fraud Rules ({defaultRules.length})
          </button>
        </nav>
      </div>

      {activeTab === 'alerts' && (
        <>
          {/* Filters */}
          <Card>
            <CardContent className="py-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search alerts..."
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <Select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  options={[
                    { value: 'all', label: 'All Status' },
                    { value: 'OPEN', label: 'Open' },
                    { value: 'INVESTIGATING', label: 'Investigating' },
                    { value: 'ESCALATED', label: 'Escalated' },
                    { value: 'RESOLVED', label: 'Resolved' },
                  ]}
                  className="w-36"
                />
                <Select
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value)}
                  options={[
                    { value: 'all', label: 'All Severity' },
                    { value: 'CRITICAL', label: 'Critical' },
                    { value: 'HIGH', label: 'High' },
                    { value: 'MEDIUM', label: 'Medium' },
                    { value: 'LOW', label: 'Low' },
                  ]}
                  className="w-36"
                />
              </div>
            </CardContent>
          </Card>

          {/* Alert List */}
          <div className="space-y-3">
            {filteredAlerts.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onView={() => {
                  setSelectedAlert(alert);
                  setShowAlertModal(true);
                }}
                onResolve={(resolution) => handleResolve(alert.id, resolution)}
              />
            ))}
          </div>
        </>
      )}

      {activeTab === 'rules' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button variant="primary">
              <Zap className="h-4 w-4 mr-2" />
              Create Rule
            </Button>
          </div>
          {defaultRules.map((rule) => (
            <RuleCard key={rule.id} rule={rule} />
          ))}
        </div>
      )}

      {/* Alert Detail Modal */}
      {selectedAlert && (
        <AlertDetailModal
          isOpen={showAlertModal}
          onClose={() => setShowAlertModal(false)}
          alert={selectedAlert}
          onResolve={(resolution) => handleResolve(selectedAlert.id, resolution)}
        />
      )}
    </div>
  );
}

interface AlertCardProps {
  alert: FraudAlert;
  onView: () => void;
  onResolve: (resolution: string) => void;
}

function AlertCard({ alert, onView, onResolve }: AlertCardProps) {
  const severityColors: Record<AlertSeverity, string> = {
    CRITICAL: 'border-l-red-600 bg-red-50',
    HIGH: 'border-l-orange-500 bg-orange-50',
    MEDIUM: 'border-l-yellow-500 bg-yellow-50',
    LOW: 'border-l-blue-500 bg-blue-50',
  };

  return (
    <Card className={cn('border-l-4', severityColors[alert.severity])}>
      <CardContent className="py-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Badge status={alert.severity}>{alert.severity}</Badge>
              <Badge status={alert.status}>{alert.status}</Badge>
              <span className="text-sm text-gray-500">{alert.alertType.replace('_', ' ')}</span>
            </div>
            <h4 className="font-medium text-gray-900 mb-1">
              Transaction {alert.transactionId}
            </h4>
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <span>{alert.details.payerFsp} → {alert.details.payeeFsp}</span>
              <span>{formatCurrency(alert.details.amount, alert.details.currency)}</span>
              <span>{formatDateTime(alert.createdAt)}</span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-sm text-gray-500">Risk Score:</span>
              <div className="flex items-center">
                <div className="w-24 bg-gray-200 rounded-full h-2">
                  <div
                    className={cn(
                      'h-2 rounded-full',
                      alert.riskScore >= 80 ? 'bg-red-500' :
                      alert.riskScore >= 60 ? 'bg-orange-500' :
                      alert.riskScore >= 40 ? 'bg-yellow-500' : 'bg-green-500'
                    )}
                    style={{ width: `${alert.riskScore}%` }}
                  />
                </div>
                <span className="ml-2 text-sm font-medium">{alert.riskScore}</span>
              </div>
              <span className="text-sm text-gray-500 ml-4">
                ML Confidence: {(alert.mlConfidence * 100).toFixed(0)}%
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onView}>
              <Eye className="h-4 w-4 mr-1" />
              View
            </Button>
            {alert.status !== 'RESOLVED' && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onResolve('FALSE_POSITIVE')}
                >
                  <ThumbsDown className="h-4 w-4 mr-1" />
                  False Positive
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => onResolve('CONFIRMED_FRAUD')}
                >
                  <ThumbsUp className="h-4 w-4 mr-1" />
                  Confirm Fraud
                </Button>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface RuleCardProps {
  rule: FraudRule;
}

function RuleCard({ rule }: RuleCardProps) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <h4 className="font-medium text-gray-900">{rule.name}</h4>
              <Badge variant={rule.enabled ? 'success' : 'default'}>
                {rule.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
              <Badge variant="info">{rule.type}</Badge>
            </div>
            <p className="text-sm text-gray-500 mb-2">{rule.description}</p>
            <div className="flex items-center gap-4 text-xs text-gray-400">
              <span>Priority: {rule.priority}</span>
              <span>Updated: {formatDateTime(rule.updatedAt)}</span>
              <span>By: {rule.createdBy}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm">Edit</Button>
            <Button variant="ghost" size="sm">
              {rule.enabled ? 'Disable' : 'Enable'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface AlertDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  alert: FraudAlert;
  onResolve: (resolution: string) => void;
}

function AlertDetailModal({ isOpen, onClose, alert, onResolve }: AlertDetailModalProps) {
  const [resolution, setResolution] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Alert Details - ${alert.transactionId}`}
      size="lg"
      footer={
        alert.status !== 'RESOLVED' ? (
          <>
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button
              variant="secondary"
              onClick={() => onResolve('FALSE_POSITIVE')}
            >
              Mark as False Positive
            </Button>
            <Button
              variant="danger"
              onClick={() => onResolve('CONFIRMED_FRAUD')}
            >
              Confirm as Fraud
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>Close</Button>
        )
      }
    >
      <div className="space-y-6">
        {/* Alert Summary */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-500">Alert Type</p>
            <p className="font-medium">{alert.alertType.replace('_', ' ')}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Severity</p>
            <Badge status={alert.severity}>{alert.severity}</Badge>
          </div>
          <div>
            <p className="text-sm text-gray-500">Risk Score</p>
            <p className="font-medium">{alert.riskScore}/100</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">ML Confidence</p>
            <p className="font-medium">{(alert.mlConfidence * 100).toFixed(1)}%</p>
          </div>
        </div>

        {/* Transaction Details */}
        <div>
          <h4 className="font-medium text-gray-900 mb-2">Transaction Details</h4>
          <div className="bg-gray-50 rounded-lg p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-500">Payer FSP</span>
              <span className="font-medium">{alert.details.payerFsp}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Payee FSP</span>
              <span className="font-medium">{alert.details.payeeFsp}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Amount</span>
              <span className="font-medium">{formatCurrency(alert.details.amount, alert.details.currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Created At</span>
              <span className="font-medium">{formatDateTime(alert.createdAt)}</span>
            </div>
          </div>
        </div>

        {/* Triggered Rules */}
        <div>
          <h4 className="font-medium text-gray-900 mb-2">Triggered Rules</h4>
          <div className="flex flex-wrap gap-2">
            {alert.details.triggerRules.map((rule) => (
              <Badge key={rule} variant="warning">{rule}</Badge>
            ))}
          </div>
        </div>

        {/* ML Features (if available) */}
        {alert.details.mlFeatures && (
          <div>
            <h4 className="font-medium text-gray-900 mb-2">ML Features</h4>
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              {Object.entries(alert.details.mlFeatures).map(([key, value]) => (
                <div key={key} className="flex justify-between">
                  <span className="text-gray-500">{key.replace('_', ' ')}</span>
                  <span className="font-medium">{value.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Resolution Notes */}
        {alert.status !== 'RESOLVED' && (
          <div>
            <Textarea
              label="Resolution Notes"
              placeholder="Add notes about your investigation..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        )}

        {/* Resolution Info (if resolved) */}
        {alert.status === 'RESOLVED' && (
          <div className="bg-green-50 rounded-lg p-4">
            <h4 className="font-medium text-green-800 mb-2">Resolution</h4>
            <div className="space-y-1 text-sm">
              <p><span className="text-green-600">Status:</span> {alert.resolution}</p>
              <p><span className="text-green-600">Resolved By:</span> {alert.resolvedBy}</p>
              <p><span className="text-green-600">Resolved At:</span> {formatDateTime(alert.resolvedAt!)}</p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
