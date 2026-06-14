import React, { useState, useEffect, useCallback } from 'react';
import { lakehouseAPI, useLakehouseData } from '@/lib/api';
import {
  FileText,
  Download,
  Calendar,
  Clock,
  CheckCircle,
  XCircle,
  RefreshCw,
  Plus,
  Send,
  Eye,
  Trash2,
  Filter,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../common/Card';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { Modal } from '../common/Modal';
import { Input, Select } from '../common/Input';
import { MetricCard, MetricGrid } from '../dashboard/MetricCard';
import { formatDateTime, cn } from '@/lib/utils';
import type { Report, ReportType, ReportStatus } from '@/types';
import { createLogger } from '@/lib/logger';
const log = createLogger('ReportsInterface');

const defaultReports: Report[] = [
  {
    id: 'rpt-001',
    name: 'Daily Transaction Summary',
    type: 'DAILY_TRANSACTION',
    format: 'PDF',
    status: 'READY',
    generatedAt: new Date(Date.now() - 3600000).toISOString(),
    parameters: { date: '2024-12-22' },
    downloadUrl: '/reports/daily-txn-20241222.pdf',
    fileSize: 2456789,
  },
  {
    id: 'rpt-002',
    name: 'CBN Monthly Report - November 2024',
    type: 'REGULATORY_CBN',
    format: 'EXCEL',
    status: 'SUBMITTED',
    generatedAt: new Date(Date.now() - 86400000).toISOString(),
    submittedAt: new Date(Date.now() - 43200000).toISOString(),
    parameters: { month: '2024-11' },
    downloadUrl: '/reports/cbn-nov-2024.xlsx',
    fileSize: 5678901,
  },
  {
    id: 'rpt-003',
    name: 'Settlement Report - Week 51',
    type: 'SETTLEMENT',
    format: 'PDF',
    status: 'GENERATING',
    scheduledAt: new Date(Date.now() - 1800000).toISOString(),
    parameters: { week: '2024-W51' },
  },
  {
    id: 'rpt-004',
    name: 'Fraud Summary - December 2024',
    type: 'FRAUD_SUMMARY',
    format: 'PDF',
    status: 'SCHEDULED',
    scheduledAt: new Date(Date.now() + 3600000).toISOString(),
    parameters: { month: '2024-12' },
  },
  {
    id: 'rpt-005',
    name: 'Participant Activity Report',
    type: 'PARTICIPANT_ACTIVITY',
    format: 'CSV',
    status: 'FAILED',
    generatedAt: new Date(Date.now() - 7200000).toISOString(),
    parameters: { participant: 'all', period: 'last_7_days' },
  },
];

const reportTypeLabels: Record<ReportType, string> = {
  DAILY_TRANSACTION: 'Daily Transaction',
  SETTLEMENT: 'Settlement',
  REGULATORY_CBN: 'CBN Regulatory',
  FRAUD_SUMMARY: 'Fraud Summary',
  PARTICIPANT_ACTIVITY: 'Participant Activity',
  RECONCILIATION: 'Reconciliation',
  AUDIT_LOG: 'Audit Log',
};

export function ReportsInterface() {
  const reportsFetcher = useCallback(() =>
    lakehouseAPI.fetch<{ reports: Report[] }>('/api/v1/reports')
      .then(d => d.reports)
      .catch((err: unknown) => { log.error("API fallback:", err); return []; }), []);
  const { data: apiReports } = useLakehouseData(reportsFetcher, 30000);
  const [reports, setReports] = useState<Report[]>(defaultReports);
  useEffect(() => { if (apiReports) setReports(apiReports); }, [apiReports]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const readyReports = reports.filter(r => r.status === 'READY').length;
  const pendingReports = reports.filter(r => r.status === 'GENERATING' || r.status === 'SCHEDULED').length;
  const submittedReports = reports.filter(r => r.status === 'SUBMITTED').length;

  const filteredReports = reports.filter(r => {
    const matchesType = typeFilter === 'all' || r.type === typeFilter;
    const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
    return matchesType && matchesStatus;
  });

  const handleRetry = (reportId: string) => {
    setReports(prev =>
      prev.map(r =>
        r.id === reportId ? { ...r, status: 'GENERATING' } : r
      )
    );
  };

  const handleDelete = (reportId: string) => {
    setReports(prev => prev.filter(r => r.id !== reportId));
  };

  return (
    <div className="space-y-6">
      {/* Summary Metrics */}
      <MetricGrid columns={4}>
        <MetricCard
          title="Ready for Download"
          value={readyReports}
          icon={<CheckCircle className="h-5 w-5" />}
        />
        <MetricCard
          title="Pending/Scheduled"
          value={pendingReports}
          icon={<Clock className="h-5 w-5" />}
        />
        <MetricCard
          title="Submitted to CBN"
          value={submittedReports}
          icon={<Send className="h-5 w-5" />}
        />
        <MetricCard
          title="Total Reports"
          value={reports.length}
          icon={<FileText className="h-5 w-5" />}
        />
      </MetricGrid>

      {/* Actions Bar */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-4">
            <Select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              options={[
                { value: 'all', label: 'All Types' },
                { value: 'DAILY_TRANSACTION', label: 'Daily Transaction' },
                { value: 'SETTLEMENT', label: 'Settlement' },
                { value: 'REGULATORY_CBN', label: 'CBN Regulatory' },
                { value: 'FRAUD_SUMMARY', label: 'Fraud Summary' },
                { value: 'PARTICIPANT_ACTIVITY', label: 'Participant Activity' },
                { value: 'RECONCILIATION', label: 'Reconciliation' },
                { value: 'AUDIT_LOG', label: 'Audit Log' },
              ]}
              className="w-44"
            />
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={[
                { value: 'all', label: 'All Status' },
                { value: 'READY', label: 'Ready' },
                { value: 'GENERATING', label: 'Generating' },
                { value: 'SCHEDULED', label: 'Scheduled' },
                { value: 'SUBMITTED', label: 'Submitted' },
                { value: 'FAILED', label: 'Failed' },
              ]}
              className="w-36"
            />
            <div className="flex-1" />
            <Button variant="secondary" onClick={() => setShowScheduleModal(true)}>
              <Calendar className="h-4 w-4 mr-2" />
              Schedule Report
            </Button>
            <Button variant="primary" onClick={() => setShowCreateModal(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Generate Report
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Reports List */}
      <div className="space-y-3">
        {filteredReports.map((report) => (
          <ReportCard
            key={report.id}
            report={report}
            onDownload={() => log.info('Download:', report.id)}
            onSubmit={() => log.info('Submit:', report.id)}
            onRetry={() => handleRetry(report.id)}
            onDelete={() => handleDelete(report.id)}
            onView={() => setSelectedReport(report)}
          />
        ))}
      </div>

      {/* Create Report Modal */}
      <CreateReportModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={(data) => {
          const newReport: Report = {
            id: `rpt-${Date.now()}`,
            name: data.name,
            type: data.type as ReportType,
            format: data.format as 'PDF' | 'EXCEL' | 'CSV',
            status: 'GENERATING',
            parameters: data.parameters,
          };
          setReports(prev => [newReport, ...prev]);
          setShowCreateModal(false);
        }}
      />

      {/* Schedule Report Modal */}
      <ScheduleReportModal
        isOpen={showScheduleModal}
        onClose={() => setShowScheduleModal(false)}
        onSchedule={(data) => {
          log.info('Schedule:', data);
          setShowScheduleModal(false);
        }}
      />
    </div>
  );
}

interface ReportCardProps {
  report: Report;
  onDownload: () => void;
  onSubmit: () => void;
  onRetry: () => void;
  onDelete: () => void;
  onView: () => void;
}

function ReportCard({
  report,
  onDownload,
  onSubmit,
  onRetry,
  onDelete,
  onView,
}: ReportCardProps) {
  const statusColors: Record<ReportStatus, string> = {
    SCHEDULED: 'bg-blue-100 text-blue-800',
    GENERATING: 'bg-yellow-100 text-yellow-800',
    READY: 'bg-green-100 text-green-800',
    SUBMITTED: 'bg-purple-100 text-purple-800',
    FAILED: 'bg-red-100 text-red-800',
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className="h-10 w-10 rounded-lg bg-gray-100 flex items-center justify-center mr-4">
              <FileText className="h-5 w-5 text-gray-600" />
            </div>
            <div>
              <h4 className="font-medium text-gray-900">{report.name}</h4>
              <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                <span>{reportTypeLabels[report.type]}</span>
                <span>{report.format}</span>
                <span>{formatFileSize(report.fileSize)}</span>
                {report.generatedAt && (
                  <span>Generated: {formatDateTime(report.generatedAt)}</span>
                )}
                {report.scheduledAt && report.status === 'SCHEDULED' && (
                  <span>Scheduled: {formatDateTime(report.scheduledAt)}</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={statusColors[report.status]}>{report.status}</Badge>
            
            {report.status === 'READY' && (
              <>
                <Button variant="ghost" size="sm" onClick={onView}>
                  <Eye className="h-4 w-4" />
                </Button>
                <Button variant="secondary" size="sm" onClick={onDownload}>
                  <Download className="h-4 w-4 mr-1" />
                  Download
                </Button>
                {report.type === 'REGULATORY_CBN' && (
                  <Button variant="primary" size="sm" onClick={onSubmit}>
                    <Send className="h-4 w-4 mr-1" />
                    Submit to CBN
                  </Button>
                )}
              </>
            )}
            
            {report.status === 'GENERATING' && (
              <div className="flex items-center text-sm text-gray-500">
                <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                Generating...
              </div>
            )}
            
            {report.status === 'FAILED' && (
              <>
                <Button variant="secondary" size="sm" onClick={onRetry}>
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Retry
                </Button>
                <Button variant="ghost" size="sm" onClick={onDelete}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface CreateReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: { name: string; type: string; format: string; parameters: Record<string, unknown> }) => void;
}

function CreateReportModal({ isOpen, onClose, onCreate }: CreateReportModalProps) {
  const [reportType, setReportType] = useState('DAILY_TRANSACTION');
  const [format, setFormat] = useState('PDF');
  const [dateRange, setDateRange] = useState('today');

  const handleCreate = () => {
    onCreate({
      name: `${reportTypeLabels[reportType as ReportType]} - ${new Date().toLocaleDateString()}`,
      type: reportType,
      format,
      parameters: { dateRange },
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Generate Report"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleCreate}>Generate</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select
          label="Report Type"
          value={reportType}
          onChange={(e) => setReportType(e.target.value)}
          options={[
            { value: 'DAILY_TRANSACTION', label: 'Daily Transaction Summary' },
            { value: 'SETTLEMENT', label: 'Settlement Report' },
            { value: 'REGULATORY_CBN', label: 'CBN Regulatory Report' },
            { value: 'FRAUD_SUMMARY', label: 'Fraud Summary' },
            { value: 'PARTICIPANT_ACTIVITY', label: 'Participant Activity' },
            { value: 'RECONCILIATION', label: 'Reconciliation Report' },
            { value: 'AUDIT_LOG', label: 'Audit Log Export' },
          ]}
        />
        <Select
          label="Format"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          options={[
            { value: 'PDF', label: 'PDF' },
            { value: 'EXCEL', label: 'Excel (.xlsx)' },
            { value: 'CSV', label: 'CSV' },
            { value: 'JSON', label: 'JSON' },
          ]}
        />
        <Select
          label="Date Range"
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value)}
          options={[
            { value: 'today', label: 'Today' },
            { value: 'yesterday', label: 'Yesterday' },
            { value: 'last_7_days', label: 'Last 7 Days' },
            { value: 'last_30_days', label: 'Last 30 Days' },
            { value: 'this_month', label: 'This Month' },
            { value: 'last_month', label: 'Last Month' },
            { value: 'custom', label: 'Custom Range' },
          ]}
        />
        {dateRange === 'custom' && (
          <div className="grid grid-cols-2 gap-4">
            <Input label="Start Date" type="date" />
            <Input label="End Date" type="date" />
          </div>
        )}
      </div>
    </Modal>
  );
}

interface ScheduleReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSchedule: (data: unknown) => void;
}

function ScheduleReportModal({ isOpen, onClose, onSchedule }: ScheduleReportModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Schedule Report"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSchedule({})}>Schedule</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select
          label="Report Type"
          options={[
            { value: 'DAILY_TRANSACTION', label: 'Daily Transaction Summary' },
            { value: 'SETTLEMENT', label: 'Settlement Report' },
            { value: 'REGULATORY_CBN', label: 'CBN Regulatory Report' },
            { value: 'FRAUD_SUMMARY', label: 'Fraud Summary' },
          ]}
        />
        <Select
          label="Frequency"
          options={[
            { value: 'daily', label: 'Daily' },
            { value: 'weekly', label: 'Weekly' },
            { value: 'monthly', label: 'Monthly' },
            { value: 'quarterly', label: 'Quarterly' },
          ]}
        />
        <Input label="Time" type="time" defaultValue="06:00" />
        <Select
          label="Format"
          options={[
            { value: 'PDF', label: 'PDF' },
            { value: 'EXCEL', label: 'Excel' },
            { value: 'CSV', label: 'CSV' },
          ]}
        />
        <Input
          label="Email Recipients"
          placeholder="email1@example.com, email2@example.com"
          helperText="Comma-separated list of email addresses"
        />
      </div>
    </Modal>
  );
}
