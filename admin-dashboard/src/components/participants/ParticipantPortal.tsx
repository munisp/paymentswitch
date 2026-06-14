import { toast } from '@/lib/toast';
import React, { useState, useEffect } from 'react';
import {
  Building2,
  Plus,
  Search,
  Filter,
  MoreVertical,
  Edit,
  Pause,
  Play,
  Trash2,
  FileText,
  Settings,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  Upload,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../common/Card';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { Modal, ConfirmModal } from '../common/Modal';
import { Input, Select, Textarea } from '../common/Input';
import { MetricCard, MetricGrid } from '../dashboard/MetricCard';
import { formatCurrency, formatDateTime, cn } from '@/lib/utils';
import type { Participant, ParticipantLimits } from '@/types';
import { createLogger } from '@/lib/logger';
const log = createLogger('ParticipantPortal');

const API_BASE = process.env.NEXT_PUBLIC_PARTICIPANTS_API || 'https://app-kjesixal.fly.dev';

const defaultParticipants: Participant[] = [
  {
    id: 'p-001',
    fspId: 'firstbank',
    name: 'First Bank of Nigeria',
    type: 'BANK',
    status: 'ACTIVE',
    currency: 'NGN',
    tigerBeetleAccountId: 'tb-001',
    netDebitCap: 50000000000,
    currentPosition: 12345678900,
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-12-20T14:30:00Z',
    kycStatus: 'APPROVED',
    limits: {
      dailyTransactionLimit: 100000000000,
      singleTransactionLimit: 5000000000,
      monthlyVolumeLimit: 2000000000000,
      maxPendingTransfers: 10000,
    },
    contacts: [
      { name: 'John Adeyemi', email: 'john.adeyemi@firstbank.com', phone: '+234 801 234 5678', role: 'Technical Lead' },
      { name: 'Sarah Okonkwo', email: 'sarah.okonkwo@firstbank.com', phone: '+234 802 345 6789', role: 'Operations Manager' },
    ],
  },
  {
    id: 'p-002',
    fspId: 'gtbank',
    name: 'Guaranty Trust Bank',
    type: 'BANK',
    status: 'ACTIVE',
    currency: 'NGN',
    tigerBeetleAccountId: 'tb-002',
    netDebitCap: 45000000000,
    currentPosition: 9876543200,
    createdAt: '2024-01-20T09:00:00Z',
    updatedAt: '2024-12-19T16:45:00Z',
    kycStatus: 'APPROVED',
    limits: {
      dailyTransactionLimit: 80000000000,
      singleTransactionLimit: 4000000000,
      monthlyVolumeLimit: 1500000000000,
      maxPendingTransfers: 8000,
    },
    contacts: [
      { name: 'Michael Eze', email: 'michael.eze@gtbank.com', phone: '+234 803 456 7890', role: 'Integration Lead' },
    ],
  },
  {
    id: 'p-003',
    fspId: 'mtn-momo',
    name: 'MTN Mobile Money',
    type: 'MOBILE_MONEY',
    status: 'ACTIVE',
    currency: 'NGN',
    tigerBeetleAccountId: 'tb-003',
    netDebitCap: 20000000000,
    currentPosition: 5432109800,
    createdAt: '2024-03-01T11:00:00Z',
    updatedAt: '2024-12-21T10:15:00Z',
    kycStatus: 'APPROVED',
    limits: {
      dailyTransactionLimit: 30000000000,
      singleTransactionLimit: 1000000000,
      monthlyVolumeLimit: 500000000000,
      maxPendingTransfers: 5000,
    },
    contacts: [],
  },
  {
    id: 'p-004',
    fspId: 'newbank',
    name: 'New Digital Bank',
    type: 'BANK',
    status: 'PENDING',
    currency: 'NGN',
    tigerBeetleAccountId: 'tb-004',
    netDebitCap: 10000000000,
    currentPosition: 0,
    createdAt: '2024-12-15T08:00:00Z',
    updatedAt: '2024-12-15T08:00:00Z',
    kycStatus: 'PENDING',
    limits: {
      dailyTransactionLimit: 20000000000,
      singleTransactionLimit: 500000000,
      monthlyVolumeLimit: 200000000000,
      maxPendingTransfers: 2000,
    },
    contacts: [],
  },
];

export function ParticipantPortal() {
  const [participants, setParticipants] = useState<Participant[]>(defaultParticipants);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedParticipant, setSelectedParticipant] = useState<Participant | null>(null);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [showSuspendModal, setShowSuspendModal] = useState(false);
  const [showLimitsModal, setShowLimitsModal] = useState(false);

  // Fetch participants from API
  const fetchParticipants = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/participants`);
      if (response.ok) {
        const data = await response.json();
        setParticipants(data.participants || data || defaultParticipants);
      }
    } catch (error) {
      log.error('Error fetching participants:', error);
    }
  };

  useEffect(() => {
    fetchParticipants();
  }, []);

  // Refetch participants from API
  const refetchParticipants = async () => {
    await fetchParticipants();
  };

  const filteredParticipants = participants.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.fspId.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    const matchesType = typeFilter === 'all' || p.type === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  });

  const activeCount = participants.filter(p => p.status === 'ACTIVE').length;
  const pendingCount = participants.filter(p => p.status === 'PENDING').length;
  const suspendedCount = participants.filter(p => p.status === 'SUSPENDED').length;

  return (
    <div className="space-y-6">
      {/* Summary Metrics */}
      <MetricGrid columns={4}>
        <MetricCard
          title="Total Participants"
          value={participants.length}
          icon={<Building2 className="h-5 w-5" />}
        />
        <MetricCard
          title="Active"
          value={activeCount}
          icon={<CheckCircle className="h-5 w-5" />}
        />
        <MetricCard
          title="Pending Onboarding"
          value={pendingCount}
          icon={<Clock className="h-5 w-5" />}
        />
        <MetricCard
          title="Suspended"
          value={suspendedCount}
          icon={<AlertTriangle className="h-5 w-5" />}
        />
      </MetricGrid>

      {/* Actions Bar */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search participants..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={[
                { value: 'all', label: 'All Status' },
                { value: 'ACTIVE', label: 'Active' },
                { value: 'PENDING', label: 'Pending' },
                { value: 'SUSPENDED', label: 'Suspended' },
                { value: 'INACTIVE', label: 'Inactive' },
              ]}
              className="w-36"
            />
            <Select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              options={[
                { value: 'all', label: 'All Types' },
                { value: 'BANK', label: 'Bank' },
                { value: 'MOBILE_MONEY', label: 'Mobile Money' },
                { value: 'MFI', label: 'MFI' },
                { value: 'DFSP', label: 'DFSP' },
              ]}
              className="w-36"
            />
            <div className="flex-1" />
            <Button variant="primary" onClick={() => setShowOnboardingModal(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Onboard Participant
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Participants Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredParticipants.map((participant) => (
          <ParticipantCard
            key={participant.id}
            participant={participant}
            onEdit={() => {
              setSelectedParticipant(participant);
              setShowLimitsModal(true);
            }}
            onSuspend={() => {
              setSelectedParticipant(participant);
              setShowSuspendModal(true);
            }}
            onViewDetails={() => setSelectedParticipant(participant)}
          />
        ))}
      </div>

      {/* Onboarding Modal */}
      <OnboardingModal
        isOpen={showOnboardingModal}
        onClose={() => setShowOnboardingModal(false)}
        onSubmit={async (data) => {
          try {
            const response = await fetch(`${API_BASE}/api/v1/participants`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            });
            if (response.ok) {
              setShowOnboardingModal(false);
              await refetchParticipants();
              toast.success('Participant onboarded successfully!');
            } else {
              toast.error('Failed to onboard participant. Please try again.');
            }
          } catch (error) {
            log.error('Error onboarding participant:', error);
            toast.error('Error onboarding participant. Please try again.');
          }
        }}
      />

      {/* Suspend Modal */}
      <ConfirmModal
        isOpen={showSuspendModal}
        onClose={() => setShowSuspendModal(false)}
        onConfirm={async () => {
          if (selectedParticipant) {
            const newStatus = selectedParticipant.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
            try {
              const response = await fetch(`${API_BASE}/api/v1/participants/${selectedParticipant.id}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
              });
              if (response.ok) {
                await refetchParticipants();
                toast.success(`Participant ${newStatus === 'ACTIVE' ? 'activated' : 'suspended'} successfully!`);
              } else {
                toast.error('Failed to update participant status. Please try again.');
              }
            } catch (error) {
              log.error('Error updating participant status:', error);
              toast.error('Error updating participant status. Please try again.');
            }
          }
          setShowSuspendModal(false);
        }}
        title={selectedParticipant?.status === 'SUSPENDED' ? 'Activate Participant' : 'Suspend Participant'}
        message={
          selectedParticipant?.status === 'SUSPENDED'
            ? `Are you sure you want to activate ${selectedParticipant?.name}? They will be able to process transactions again.`
            : `Are you sure you want to suspend ${selectedParticipant?.name}? All their transactions will be blocked.`
        }
        confirmText={selectedParticipant?.status === 'SUSPENDED' ? 'Activate' : 'Suspend'}
        variant={selectedParticipant?.status === 'SUSPENDED' ? 'primary' : 'danger'}
      />

      {/* Limits Modal */}
      <LimitsModal
        isOpen={showLimitsModal}
        onClose={() => setShowLimitsModal(false)}
        participant={selectedParticipant}
        onSave={async (limits) => {
          if (selectedParticipant) {
            try {
              const response = await fetch(`${API_BASE}/api/v1/participants/${selectedParticipant.id}/limits`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ limits }),
              });
              if (response.ok) {
                await refetchParticipants();
                toast.success('Participant limits updated successfully!');
              } else {
                toast.error('Failed to update participant limits. Please try again.');
              }
            } catch (error) {
              log.error('Error updating participant limits:', error);
              toast.error('Error updating participant limits. Please try again.');
            }
          }
          setShowLimitsModal(false);
        }}
      />
    </div>
  );
}

interface ParticipantCardProps {
  participant: Participant;
  onEdit: () => void;
  onSuspend: () => void;
  onViewDetails: () => void;
}

function ParticipantCard({ participant, onEdit, onSuspend, onViewDetails }: ParticipantCardProps) {
  const [showMenu, setShowMenu] = useState(false);

  // Safely handle undefined/null values to prevent NaN
  const netDebitCap = participant.netDebitCap ?? 0;
  const currentPosition = participant.currentPosition ?? 0;
  const positionPercentage = netDebitCap > 0 ? (currentPosition / netDebitCap) * 100 : 0;
  const positionColor = positionPercentage > 80 ? 'bg-red-500' : positionPercentage > 60 ? 'bg-yellow-500' : 'bg-green-500';

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center">
            <div className="h-10 w-10 rounded-lg bg-primary-100 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-primary-600" />
            </div>
            <div className="ml-3">
              <h3 className="font-medium text-gray-900">{participant.name}</h3>
              <p className="text-sm text-gray-500">{participant.fspId}</p>
            </div>
          </div>
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-1 rounded hover:bg-gray-100"
            >
              <MoreVertical className="h-5 w-5 text-gray-400" />
            </button>
            {showMenu && (
              <div className="absolute right-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10">
                <button
                  onClick={() => { onViewDetails(); setShowMenu(false); }}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  View Details
                </button>
                <button
                  onClick={() => { onEdit(); setShowMenu(false); }}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center"
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Edit Limits
                </button>
                <button
                  onClick={() => { onSuspend(); setShowMenu(false); }}
                  className={cn(
                    'w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center',
                    participant.status === 'SUSPENDED' ? 'text-green-600' : 'text-red-600'
                  )}
                >
                  {participant.status === 'SUSPENDED' ? (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Activate
                    </>
                  ) : (
                    <>
                      <Pause className="h-4 w-4 mr-2" />
                      Suspend
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <Badge status={participant.status}>{participant.status}</Badge>
          <Badge variant="info">{participant.type}</Badge>
          <Badge status={participant.kycStatus}>{participant.kycStatus}</Badge>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Net Debit Cap</span>
            <span className="font-medium">{formatCurrency(netDebitCap, participant.currency)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Current Position</span>
            <span className="font-medium">{formatCurrency(currentPosition, participant.currency)}</span>
          </div>
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Position Usage</span>
              <span>{positionPercentage.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={cn('h-2 rounded-full', positionColor)}
                style={{ width: `${Math.min(positionPercentage, 100)}%` }}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: unknown) => void;
}

function OnboardingModal({ isOpen, onClose, onSubmit }: OnboardingModalProps) {
  const [step, setStep] = useState(1);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Onboard New Participant"
      description={`Step ${step} of 4`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={step === 1 ? onClose : () => setStep(step - 1)}>
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>
          <Button
            variant="primary"
            onClick={step === 4 ? () => onSubmit({}) : () => setStep(step + 1)}
          >
            {step === 4 ? 'Complete Onboarding' : 'Next'}
          </Button>
        </>
      }
    >
      {/* Step indicators */}
      <div className="flex items-center justify-center mb-6">
        {[1, 2, 3, 4].map((s) => (
          <React.Fragment key={s}>
            <div
              className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium',
                s <= step ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-500'
              )}
            >
              {s}
            </div>
            {s < 4 && (
              <div
                className={cn(
                  'w-16 h-1 mx-1',
                  s < step ? 'bg-primary-600' : 'bg-gray-200'
                )}
              />
            )}
          </React.Fragment>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <h3 className="font-medium text-gray-900">Basic Information</h3>
          <Input label="Participant Name" placeholder="e.g., First Bank of Nigeria" />
          <Input label="FSP ID" placeholder="e.g., firstbank" />
          <Select
            label="Participant Type"
            options={[
              { value: 'BANK', label: 'Bank' },
              { value: 'MOBILE_MONEY', label: 'Mobile Money Operator' },
              { value: 'MFI', label: 'Microfinance Institution' },
              { value: 'DFSP', label: 'Digital Financial Service Provider' },
            ]}
          />
          <Select
            label="Currency"
            options={[
              { value: 'NGN', label: 'Nigerian Naira (NGN)' },
              { value: 'USD', label: 'US Dollar (USD)' },
              { value: 'GBP', label: 'British Pound (GBP)' },
            ]}
          />
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <h3 className="font-medium text-gray-900">KYC Documents</h3>
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
            <Upload className="h-10 w-10 text-gray-400 mx-auto mb-3" />
            <p className="text-sm text-gray-600">
              Drag and drop files here, or click to browse
            </p>
            <p className="text-xs text-gray-400 mt-1">
              PDF, JPG, PNG up to 10MB each
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">Required Documents:</p>
            <ul className="text-sm text-gray-500 space-y-1">
              <li>- Certificate of Incorporation</li>
              <li>- CBN License</li>
              <li>- Board Resolution</li>
              <li>- Directors ID Documents</li>
            </ul>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <h3 className="font-medium text-gray-900">Transaction Limits</h3>
          <Input label="Net Debit Cap" type="number" placeholder="50000000000" />
          <Input label="Daily Transaction Limit" type="number" placeholder="100000000000" />
          <Input label="Single Transaction Limit" type="number" placeholder="5000000000" />
          <Input label="Monthly Volume Limit" type="number" placeholder="2000000000000" />
          <Input label="Max Pending Transfers" type="number" placeholder="10000" />
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <h3 className="font-medium text-gray-900">Contact Information</h3>
          <Input label="Primary Contact Name" placeholder="John Doe" />
          <Input label="Email" type="email" placeholder="john.doe@bank.com" />
          <Input label="Phone" type="tel" placeholder="+234 801 234 5678" />
          <Input label="Role" placeholder="Technical Lead" />
          <Textarea label="Notes" placeholder="Any additional notes..." rows={3} />
        </div>
      )}
    </Modal>
  );
}

interface LimitsModalProps {
  isOpen: boolean;
  onClose: () => void;
  participant: Participant | null;
  onSave: (limits: ParticipantLimits) => void;
}

function LimitsModal({ isOpen, onClose, participant, onSave }: LimitsModalProps) {
  if (!participant) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Edit Limits - ${participant.name}`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave(participant.limits)}>Save Changes</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Net Debit Cap"
          type="number"
          defaultValue={participant.netDebitCap}
          helperText="Maximum negative position allowed"
        />
        <Input
          label="Daily Transaction Limit"
          type="number"
          defaultValue={participant.limits.dailyTransactionLimit}
        />
        <Input
          label="Single Transaction Limit"
          type="number"
          defaultValue={participant.limits.singleTransactionLimit}
        />
        <Input
          label="Monthly Volume Limit"
          type="number"
          defaultValue={participant.limits.monthlyVolumeLimit}
        />
        <Input
          label="Max Pending Transfers"
          type="number"
          defaultValue={participant.limits.maxPendingTransfers}
        />
      </div>
    </Modal>
  );
}
