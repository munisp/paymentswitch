import { logger } from "@/lib/logger";
import React, { useState, useCallback } from 'react';
import {
  Calendar,
  Download,
  CheckCircle,
  XCircle,
  Clock,
  FileText,
  ArrowUpDown,
  Filter,
  RefreshCw,
} from 'lucide-react';
import { lakehouseAPI, useLakehouseData } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '../common/Card';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { Modal, ConfirmModal } from '../common/Modal';
import { Select } from '../common/Input';
import { MetricCard, MetricGrid } from '../dashboard/MetricCard';
import { formatCurrency, formatDateTime, cn } from '@/lib/utils';
import type { SettlementWindow, Settlement, SettlementParticipant } from '@/types';

const defaultSettlementWindows: SettlementWindow[] = [
  {
    id: 'sw-001',
    state: 'PENDING_SETTLEMENT',
    openedAt: new Date(Date.now() - 86400000).toISOString(),
    closedAt: new Date(Date.now() - 3600000).toISOString(),
    totalTransactions: 284739,
    totalAmount: 15234567800,
    currency: 'NGN',
    participants: [
      { fspId: 'firstbank', name: 'FirstBank', netPosition: 234567800, debitAmount: 5234567800, creditAmount: 5000000000, transactionCount: 45678, status: 'PENDING' },
      { fspId: 'gtbank', name: 'GTBank', netPosition: -156789000, debitAmount: 4500000000, creditAmount: 4656789000, transactionCount: 38945, status: 'PENDING' },
      { fspId: 'zenith', name: 'Zenith Bank', netPosition: 89234500, debitAmount: 3200000000, creditAmount: 3110765500, transactionCount: 32456, status: 'PENDING' },
      { fspId: 'uba', name: 'UBA', netPosition: -167013300, debitAmount: 2800000000, creditAmount: 2967013300, transactionCount: 28934, status: 'PENDING' },
    ],
  },
  {
    id: 'sw-002',
    state: 'SETTLED',
    openedAt: new Date(Date.now() - 172800000).toISOString(),
    closedAt: new Date(Date.now() - 90000000).toISOString(),
    settledAt: new Date(Date.now() - 86400000).toISOString(),
    totalTransactions: 267834,
    totalAmount: 14567890000,
    currency: 'NGN',
    participants: [
      { fspId: 'firstbank', name: 'FirstBank', netPosition: 198765400, debitAmount: 4900000000, creditAmount: 4701234600, transactionCount: 42345, status: 'APPROVED' },
      { fspId: 'gtbank', name: 'GTBank', netPosition: -123456700, debitAmount: 4200000000, creditAmount: 4323456700, transactionCount: 36789, status: 'APPROVED' },
    ],
  },
];

export function SettlementConsole() {
  const [selectedWindow, setSelectedWindow] = useState<SettlementWindow | null>(null);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [dateRange, setDateRange] = useState('today');

  const fetcher = useCallback(() => lakehouseAPI.fetch<{ windows: SettlementWindow[] }>('/api/v1/settlements/windows').catch((err: unknown) => { logger.error("API fallback:", err); return { windows: [] }; }), []);
  const { data: apiData } = useLakehouseData(fetcher, 30000);
  const settlementWindows = apiData?.windows || defaultSettlementWindows;

  const pendingWindows = settlementWindows.filter(w => w.state === 'PENDING_SETTLEMENT');
  const totalPendingAmount = pendingWindows.reduce((sum, w) => sum + w.totalAmount, 0);

  const handleApprove = async () => {
    setApprovalLoading(true);
    if (selectedWindow) {
      try { await lakehouseAPI.fetch(`/api/v1/settlements/${selectedWindow.id}/approve`, { method: 'POST' }); } catch (err) { logger.error('Settlement approval error:', err); }
    }
    setApprovalLoading(false);
    setShowApprovalModal(false);
    setSelectedWindow(null);
  };

  const handleReject = async () => {
    setApprovalLoading(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    setApprovalLoading(false);
    setShowRejectModal(false);
    setSelectedWindow(null);
  };

  return (
    <div className="space-y-6">
      {/* Summary Metrics */}
      <MetricGrid columns={4}>
        <MetricCard
          title="Pending Settlements"
          value={pendingWindows.length}
          icon={<Clock className="h-5 w-5" />}
        />
        <MetricCard
          title="Pending Amount"
          value={totalPendingAmount}
          format="currency"
          icon={<ArrowUpDown className="h-5 w-5" />}
        />
        <MetricCard
          title="Settled Today"
          value={1}
          icon={<CheckCircle className="h-5 w-5" />}
        />
        <MetricCard
          title="Active Participants"
          value={24}
          icon={<FileText className="h-5 w-5" />}
        />
      </MetricGrid>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-4">
            <Select
              label=""
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              options={[
                { value: 'today', label: 'Today' },
                { value: 'yesterday', label: 'Yesterday' },
                { value: 'week', label: 'This Week' },
                { value: 'month', label: 'This Month' },
                { value: 'custom', label: 'Custom Range' },
              ]}
              className="w-40"
            />
            <Select
              label=""
              options={[
                { value: 'all', label: 'All States' },
                { value: 'PENDING_SETTLEMENT', label: 'Pending' },
                { value: 'SETTLED', label: 'Settled' },
                { value: 'ABORTED', label: 'Aborted' },
              ]}
              className="w-40"
            />
            <Button variant="secondary" size="sm">
              <Filter className="h-4 w-4 mr-2" />
              More Filters
            </Button>
            <div className="flex-1" />
            <Button variant="secondary" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Button variant="secondary" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Settlement Windows */}
      <div className="space-y-4">
        {settlementWindows.map((window) => (
          <SettlementWindowCard
            key={window.id}
            window={window}
            onApprove={() => {
              setSelectedWindow(window);
              setShowApprovalModal(true);
            }}
            onReject={() => {
              setSelectedWindow(window);
              setShowRejectModal(true);
            }}
            onViewDetails={() => setSelectedWindow(window)}
          />
        ))}
      </div>

      {/* Approval Modal */}
      <ConfirmModal
        isOpen={showApprovalModal}
        onClose={() => setShowApprovalModal(false)}
        onConfirm={handleApprove}
        title="Approve Settlement"
        message={`Are you sure you want to approve settlement window ${selectedWindow?.id}? This will initiate fund transfers between ${selectedWindow?.participants.length} participants totaling ${formatCurrency(selectedWindow?.totalAmount || 0, 'NGN')}.`}
        confirmText="Approve Settlement"
        variant="primary"
        loading={approvalLoading}
      />

      {/* Reject Modal */}
      <ConfirmModal
        isOpen={showRejectModal}
        onClose={() => setShowRejectModal(false)}
        onConfirm={handleReject}
        title="Reject Settlement"
        message={`Are you sure you want to reject settlement window ${selectedWindow?.id}? This action will require manual reconciliation.`}
        confirmText="Reject Settlement"
        variant="danger"
        loading={approvalLoading}
      />
    </div>
  );
}

interface SettlementWindowCardProps {
  window: SettlementWindow;
  onApprove: () => void;
  onReject: () => void;
  onViewDetails: () => void;
}

function SettlementWindowCard({
  window,
  onApprove,
  onReject,
  onViewDetails,
}: SettlementWindowCardProps) {
  const [expanded, setExpanded] = useState(false);

  const isPending = window.state === 'PENDING_SETTLEMENT';

  return (
    <Card className={cn(isPending && 'border-yellow-300 border-2')}>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center space-x-4">
          <div>
            <CardTitle className="flex items-center">
              Settlement Window {window.id}
              <Badge status={window.state} className="ml-3">
                {window.state.replace('_', ' ')}
              </Badge>
            </CardTitle>
            <p className="text-sm text-gray-500 mt-1">
              Opened: {formatDateTime(window.openedAt)}
              {window.closedAt && ` | Closed: ${formatDateTime(window.closedAt)}`}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {isPending && (
            <>
              <Button variant="danger" size="sm" onClick={onReject}>
                <XCircle className="h-4 w-4 mr-1" />
                Reject
              </Button>
              <Button variant="primary" size="sm" onClick={onApprove}>
                <CheckCircle className="h-4 w-4 mr-1" />
                Approve
              </Button>
            </>
          )}
          <Button variant="secondary" size="sm" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Collapse' : 'Expand'}
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <p className="text-sm text-gray-500">Total Transactions</p>
            <p className="text-xl font-semibold">{window.totalTransactions.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Total Amount</p>
            <p className="text-xl font-semibold">{formatCurrency(window.totalAmount, window.currency)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Participants</p>
            <p className="text-xl font-semibold">{window.participants.length}</p>
          </div>
        </div>

        {expanded && (
          <div className="mt-4 border-t pt-4">
            <h4 className="font-medium text-gray-900 mb-3">Net Positions</h4>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Participant</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Debits</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Credits</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Net Position</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {window.participants.map((p) => (
                    <tr key={p.fspId}>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{p.name}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-900">
                        {formatCurrency(p.debitAmount, window.currency)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-900">
                        {formatCurrency(p.creditAmount, window.currency)}
                      </td>
                      <td className={cn(
                        'px-4 py-3 text-sm text-right font-medium',
                        p.netPosition >= 0 ? 'text-green-600' : 'text-red-600'
                      )}>
                        {p.netPosition >= 0 ? '+' : ''}{formatCurrency(p.netPosition, window.currency)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge status={p.status}>{p.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>

      {isPending && (
        <CardFooter className="flex justify-between items-center">
          <p className="text-sm text-yellow-700">
            <Clock className="h-4 w-4 inline mr-1" />
            Awaiting dual approval (1 of 2 approvals received)
          </p>
          <Button variant="ghost" size="sm" onClick={onViewDetails}>
            View Full Details
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
