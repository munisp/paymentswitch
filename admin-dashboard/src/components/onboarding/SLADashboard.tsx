'use client';

import { logger } from "@/lib/logger";
import React, { useState, useEffect, useCallback } from 'react';
import { lakehouseAPI, useLakehouseData } from '@/lib/api';
import {
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  TrendingUp,
  TrendingDown,
  Bell,
  Filter,
  RefreshCw,
  ChevronRight,
  Calendar,
  User,
  Building2,
} from 'lucide-react';

interface SLATracking {
  caseId: string;
  organizationName: string;
  stakeholderType: string;
  targetDays: number;
  elapsedDays: number;
  remainingDays: number;
  isOverdue: boolean;
  overdueDays: number;
  currentPhase: string;
  phaseStartedAt: string;
  phaseTargetDays: number;
  phaseElapsedDays: number;
  phaseIsOverdue: boolean;
  assignedReviewer?: string;
  alerts: SLAAlert[];
}

interface SLAAlert {
  id: string;
  type: 'WARNING' | 'BREACH' | 'ESCALATION';
  message: string;
  createdAt: string;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
}

interface SLAMetrics {
  totalCases: number;
  onTrack: number;
  atRisk: number;
  overdue: number;
  avgCompletionDays: number;
  slaComplianceRate: number;
  breachesThisMonth: number;
  breachesLastMonth: number;
}

const API_BASE = process.env.NEXT_PUBLIC_ONBOARDING_API || 'http://localhost:8082';

const defaultSLAData: SLATracking[] = [
  {
    caseId: 'CASE-001',
    organizationName: 'First Bank Nigeria',
    stakeholderType: 'BANK',
    targetDays: 14,
    elapsedDays: 10,
    remainingDays: 4,
    isOverdue: false,
    overdueDays: 0,
    currentPhase: 'KYB_REVIEW',
    phaseStartedAt: '2024-12-20T10:00:00Z',
    phaseTargetDays: 3,
    phaseElapsedDays: 2,
    phaseIsOverdue: false,
    assignedReviewer: 'John Reviewer',
    alerts: [],
  },
  {
    caseId: 'CASE-002',
    organizationName: 'Mobile Money Ltd',
    stakeholderType: 'MOBILE_MONEY_OPERATOR',
    targetDays: 10,
    elapsedDays: 8,
    remainingDays: 2,
    isOverdue: false,
    overdueDays: 0,
    currentPhase: 'DOCUMENT_REVIEW',
    phaseStartedAt: '2024-12-22T14:00:00Z',
    phaseTargetDays: 2,
    phaseElapsedDays: 1,
    phaseIsOverdue: false,
    assignedReviewer: 'Jane Analyst',
    alerts: [
      { id: 'alert-1', type: 'WARNING', message: 'Case approaching SLA deadline', createdAt: '2024-12-23T10:00:00Z' },
    ],
  },
  {
    caseId: 'CASE-003',
    organizationName: 'FinTech Solutions',
    stakeholderType: 'FINTECH',
    targetDays: 7,
    elapsedDays: 9,
    remainingDays: -2,
    isOverdue: true,
    overdueDays: 2,
    currentPhase: 'COMPLIANCE_CHECK',
    phaseStartedAt: '2024-12-18T09:00:00Z',
    phaseTargetDays: 2,
    phaseElapsedDays: 5,
    phaseIsOverdue: true,
    assignedReviewer: 'Mike Compliance',
    alerts: [
      { id: 'alert-2', type: 'BREACH', message: 'SLA breached - 2 days overdue', createdAt: '2024-12-22T00:00:00Z' },
      { id: 'alert-3', type: 'ESCALATION', message: 'Escalated to management', createdAt: '2024-12-23T08:00:00Z' },
    ],
  },
  {
    caseId: 'CASE-004',
    organizationName: 'Microfinance Bank',
    stakeholderType: 'MICROFINANCE_INSTITUTION',
    targetDays: 10,
    elapsedDays: 6,
    remainingDays: 4,
    isOverdue: false,
    overdueDays: 0,
    currentPhase: 'TECHNICAL_REVIEW',
    phaseStartedAt: '2024-12-21T11:00:00Z',
    phaseTargetDays: 3,
    phaseElapsedDays: 2,
    phaseIsOverdue: false,
    alerts: [],
  },
  {
    caseId: 'CASE-005',
    organizationName: 'Payment Gateway Inc',
    stakeholderType: 'FINTECH',
    targetDays: 7,
    elapsedDays: 5,
    remainingDays: 2,
    isOverdue: false,
    overdueDays: 0,
    currentPhase: 'FINAL_APPROVAL',
    phaseStartedAt: '2024-12-23T09:00:00Z',
    phaseTargetDays: 1,
    phaseElapsedDays: 0,
    phaseIsOverdue: false,
    assignedReviewer: 'Sarah Manager',
    alerts: [],
  },
];

const defaultMetrics: SLAMetrics = {
  totalCases: 45,
  onTrack: 38,
  atRisk: 4,
  overdue: 3,
  avgCompletionDays: 8.5,
  slaComplianceRate: 91.2,
  breachesThisMonth: 3,
  breachesLastMonth: 5,
};

export function SLADashboard() {
  const slaFetcher = useCallback(() =>
    lakehouseAPI.fetch<{ data: SLATracking[]; metrics: SLAMetrics }>('/api/v1/onboarding/sla')
      .then(d => ({ data: d.data, metrics: d.metrics }))
      .catch((err: unknown) => { logger.error("API fallback:", err); return { data: defaultSLAData, metrics: defaultMetrics }; }), []);
  const { data: apiSla } = useLakehouseData(slaFetcher, 15000);
  const [slaData, setSlaData] = useState<SLATracking[]>(defaultSLAData);
  const [metrics, setMetrics] = useState<SLAMetrics>(defaultMetrics);
  useEffect(() => { if (apiSla) { setSlaData(apiSla.data); setMetrics(apiSla.metrics); } }, [apiSla]);
  const [filter, setFilter] = useState<'ALL' | 'ON_TRACK' | 'AT_RISK' | 'OVERDUE'>('ALL');
  const [selectedCase, setSelectedCase] = useState<SLATracking | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshData = async () => {
    setIsRefreshing(true);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsRefreshing(false);
  };

  const getStatusColor = (tracking: SLATracking) => {
    if (tracking.isOverdue) return 'text-red-600';
    if (tracking.remainingDays <= 2) return 'text-yellow-600';
    return 'text-green-600';
  };

  const getStatusBg = (tracking: SLATracking) => {
    if (tracking.isOverdue) return 'bg-red-50 border-red-200';
    if (tracking.remainingDays <= 2) return 'bg-yellow-50 border-yellow-200';
    return 'bg-green-50 border-green-200';
  };

  const getProgressWidth = (tracking: SLATracking) => {
    const progress = (tracking.elapsedDays / tracking.targetDays) * 100;
    return Math.min(progress, 100);
  };

  const getProgressColor = (tracking: SLATracking) => {
    if (tracking.isOverdue) return 'bg-red-500';
    if (tracking.remainingDays <= 2) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'WARNING':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'BREACH':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'ESCALATION':
        return <Bell className="h-4 w-4 text-purple-500" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-gray-500" />;
    }
  };

  const filteredData = slaData.filter(item => {
    switch (filter) {
      case 'ON_TRACK':
        return !item.isOverdue && item.remainingDays > 2;
      case 'AT_RISK':
        return !item.isOverdue && item.remainingDays <= 2;
      case 'OVERDUE':
        return item.isOverdue;
      default:
        return true;
    }
  });

  const getStakeholderIcon = (type: string) => {
    switch (type) {
      case 'BANK':
        return <Building2 className="h-5 w-5 text-blue-500" />;
      case 'MOBILE_MONEY_OPERATOR':
        return <Building2 className="h-5 w-5 text-green-500" />;
      case 'FINTECH':
        return <Building2 className="h-5 w-5 text-purple-500" />;
      default:
        return <Building2 className="h-5 w-5 text-gray-500" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">SLA Tracking Dashboard</h2>
          <p className="text-sm text-gray-500 mt-1">
            Monitor onboarding case SLAs and compliance
          </p>
        </div>
        <button
          onClick={refreshData}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Active Cases</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{metrics.totalCases}</p>
            </div>
            <div className="h-12 w-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <Clock className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">On Track</p>
              <p className="text-3xl font-bold text-green-600 mt-1">{metrics.onTrack}</p>
            </div>
            <div className="h-12 w-12 bg-green-100 rounded-lg flex items-center justify-center">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">At Risk</p>
              <p className="text-3xl font-bold text-yellow-600 mt-1">{metrics.atRisk}</p>
            </div>
            <div className="h-12 w-12 bg-yellow-100 rounded-lg flex items-center justify-center">
              <AlertTriangle className="h-6 w-6 text-yellow-600" />
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Overdue</p>
              <p className="text-3xl font-bold text-red-600 mt-1">{metrics.overdue}</p>
            </div>
            <div className="h-12 w-12 bg-red-100 rounded-lg flex items-center justify-center">
              <XCircle className="h-6 w-6 text-red-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Compliance Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-medium text-gray-500">SLA Compliance Rate</p>
            <span className={`flex items-center gap-1 text-sm ${
              metrics.slaComplianceRate >= 90 ? 'text-green-600' : 'text-red-600'
            }`}>
              {metrics.slaComplianceRate >= 90 ? (
                <TrendingUp className="h-4 w-4" />
              ) : (
                <TrendingDown className="h-4 w-4" />
              )}
              {metrics.slaComplianceRate >= 90 ? '+2.3%' : '-1.5%'}
            </span>
          </div>
          <p className="text-4xl font-bold text-gray-900">{metrics.slaComplianceRate}%</p>
          <div className="mt-4 w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full ${
                metrics.slaComplianceRate >= 90 ? 'bg-green-500' : 'bg-yellow-500'
              }`}
              style={{ width: `${metrics.slaComplianceRate}%` }}
            />
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-medium text-gray-500">Avg. Completion Time</p>
            <span className="text-sm text-gray-400">days</span>
          </div>
          <p className="text-4xl font-bold text-gray-900">{metrics.avgCompletionDays}</p>
          <p className="mt-2 text-sm text-gray-500">Target: 10 days</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-medium text-gray-500">Breaches This Month</p>
            <span className={`flex items-center gap-1 text-sm ${
              metrics.breachesThisMonth < metrics.breachesLastMonth ? 'text-green-600' : 'text-red-600'
            }`}>
              {metrics.breachesThisMonth < metrics.breachesLastMonth ? (
                <TrendingDown className="h-4 w-4" />
              ) : (
                <TrendingUp className="h-4 w-4" />
              )}
              vs {metrics.breachesLastMonth} last month
            </span>
          </div>
          <p className="text-4xl font-bold text-gray-900">{metrics.breachesThisMonth}</p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-gray-200">
        {[
          { key: 'ALL', label: 'All Cases', count: slaData.length },
          { key: 'ON_TRACK', label: 'On Track', count: slaData.filter(d => !d.isOverdue && d.remainingDays > 2).length },
          { key: 'AT_RISK', label: 'At Risk', count: slaData.filter(d => !d.isOverdue && d.remainingDays <= 2).length },
          { key: 'OVERDUE', label: 'Overdue', count: slaData.filter(d => d.isOverdue).length },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key as typeof filter)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              filter === tab.key
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
            <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
              filter === tab.key ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-600'
            }`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Cases List */}
      <div className="space-y-4">
        {filteredData.map((tracking) => (
          <div
            key={tracking.caseId}
            className={`bg-white border rounded-lg p-6 ${getStatusBg(tracking)}`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                {getStakeholderIcon(tracking.stakeholderType)}
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-gray-900">{tracking.organizationName}</h4>
                    <span className="text-sm text-gray-500">({tracking.caseId})</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    {tracking.stakeholderType.replace(/_/g, ' ')} • Phase: {tracking.currentPhase.replace(/_/g, ' ')}
                  </p>
                  {tracking.assignedReviewer && (
                    <p className="text-sm text-gray-500 mt-1 flex items-center gap-1">
                      <User className="h-3 w-3" />
                      Assigned to: {tracking.assignedReviewer}
                    </p>
                  )}
                </div>
              </div>

              <div className="text-right">
                <div className={`text-2xl font-bold ${getStatusColor(tracking)}`}>
                  {tracking.isOverdue ? (
                    <span>{tracking.overdueDays} days overdue</span>
                  ) : (
                    <span>{tracking.remainingDays} days left</span>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  Target: {tracking.targetDays} days • Elapsed: {tracking.elapsedDays} days
                </p>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mt-4">
              <div className="flex items-center justify-between text-sm text-gray-500 mb-1">
                <span>Progress</span>
                <span>{Math.round(getProgressWidth(tracking))}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${getProgressColor(tracking)}`}
                  style={{ width: `${getProgressWidth(tracking)}%` }}
                />
              </div>
            </div>

            {/* Phase Progress */}
            <div className="mt-4 p-3 bg-white rounded-lg border border-gray-200">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">
                  Current Phase: {tracking.currentPhase.replace(/_/g, ' ')}
                </span>
                <span className={`text-sm ${tracking.phaseIsOverdue ? 'text-red-600' : 'text-gray-500'}`}>
                  {tracking.phaseElapsedDays} / {tracking.phaseTargetDays} days
                </span>
              </div>
            </div>

            {/* Alerts */}
            {tracking.alerts.length > 0 && (
              <div className="mt-4 space-y-2">
                {tracking.alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`flex items-center gap-3 p-3 rounded-lg ${
                      alert.type === 'BREACH' ? 'bg-red-50' :
                      alert.type === 'ESCALATION' ? 'bg-purple-50' :
                      'bg-yellow-50'
                    }`}
                  >
                    {getAlertIcon(alert.type)}
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{alert.message}</p>
                      <p className="text-xs text-gray-500">
                        {new Date(alert.createdAt).toLocaleString()}
                        {alert.acknowledgedBy && ` • Acknowledged by ${alert.acknowledgedBy}`}
                      </p>
                    </div>
                    {!alert.acknowledgedBy && (
                      <button className="text-sm text-primary-600 hover:text-primary-700 font-medium">
                        Acknowledge
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
                View Details
              </button>
              {tracking.isOverdue && (
                <button className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">
                  Escalate
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {filteredData.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <Clock className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-500">No cases found matching the selected filter</p>
        </div>
      )}
    </div>
  );
}

export default SLADashboard;
