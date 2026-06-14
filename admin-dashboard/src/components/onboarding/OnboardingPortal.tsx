'use client';

import { toast } from '@/lib/toast';
import React, { useState, useEffect } from 'react';
import {
  Building2,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Search,
  Filter,
  ChevronRight,
  User,
  Shield,
  Server,
  Globe,
  CreditCard,
  Eye,
  MessageSquare,
  RefreshCw,
  Play,
  Pause,
  Check,
  X,
} from 'lucide-react';
import { createLogger } from '@/lib/logger';
const log = createLogger('OnboardingPortal');

// Types
interface OnboardingCase {
  id: string;
  organizationName: string;
  stakeholderType: string;
  status: string;
  submittedAt: string;
  assignedReviewer: string;
  completedRequirements: number;
  totalRequirements: number;
  riskScore: number;
  country: string;
  contactEmail: string;
}

interface Requirement {
  id: string;
  name: string;
  category: string;
  status: 'pending' | 'approved' | 'rejected' | 'waived';
  reviewedBy?: string;
  reviewedAt?: string;
  notes?: string;
}

interface CaseDetail {
  id: string;
  organizationName: string;
  stakeholderType: string;
  status: string;
  submittedAt: string;
  assignedReviewer: string;
  country: string;
  contactEmail: string;
  contactPhone: string;
  registrationNumber: string;
  taxId: string;
  address: string;
  website: string;
  description: string;
  requirements: Requirement[];
  documents: { name: string; type: string; uploadedAt: string; status: string }[];
  technicalProfile: {
    apiEndpoint: string;
    callbackUrl: string;
    ipWhitelist: string[];
    environment: string;
  };
  timeline: { event: string; timestamp: string; actor: string }[];
  notes: { author: string; content: string; timestamp: string }[];
}

const API_BASE = process.env.NEXT_PUBLIC_ONBOARDING_API || 'https://app-kjesixal.fly.dev';

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  SUBMITTED: 'bg-blue-100 text-blue-800',
  DUE_DILIGENCE: 'bg-yellow-100 text-yellow-800',
  TECHNICAL_SETUP: 'bg-purple-100 text-purple-800',
  SANDBOX_CERTIFIED: 'bg-indigo-100 text-indigo-800',
  OPERATIONAL_READINESS: 'bg-cyan-100 text-cyan-800',
  GOVERNANCE_APPROVAL: 'bg-orange-100 text-orange-800',
  PRODUCTION_PROVISIONED: 'bg-teal-100 text-teal-800',
  PRODUCTION_CERTIFIED: 'bg-emerald-100 text-emerald-800',
  ACTIVE: 'bg-green-100 text-green-800',
  SUSPENDED: 'bg-red-100 text-red-800',
  REJECTED: 'bg-red-100 text-red-800',
  OFFBOARDED: 'bg-gray-100 text-gray-800',
  REWORK_REQUESTED: 'bg-amber-100 text-amber-800',
};

const stakeholderIcons: Record<string, React.ReactNode> = {
  BANK: <Building2 className="h-5 w-5" />,
  MOBILE_MONEY_OPERATOR: <CreditCard className="h-5 w-5" />,
  FINTECH: <Globe className="h-5 w-5" />,
  MICROFINANCE_INSTITUTION: <Building2 className="h-5 w-5" />,
  GOVERNMENT_AGENCY: <Shield className="h-5 w-5" />,
  MERCHANT: <CreditCard className="h-5 w-5" />,
  REGULATOR: <Shield className="h-5 w-5" />,
  NOC_OPERATOR: <Server className="h-5 w-5" />,
  DEVELOPER: <Server className="h-5 w-5" />,
};

// Default data for demonstration
const defaultCases: OnboardingCase[] = [
  {
    id: 'OB-2024-001',
    organizationName: 'First National Bank',
    stakeholderType: 'BANK',
    status: 'DUE_DILIGENCE',
    submittedAt: '2024-12-20T10:30:00Z',
    assignedReviewer: 'John Smith',
    completedRequirements: 8,
    totalRequirements: 15,
    riskScore: 25,
    country: 'Nigeria',
    contactEmail: 'onboarding@fnb.ng',
  },
  {
    id: 'OB-2024-002',
    organizationName: 'MobilePay Ltd',
    stakeholderType: 'MOBILE_MONEY_OPERATOR',
    status: 'TECHNICAL_SETUP',
    submittedAt: '2024-12-18T14:20:00Z',
    assignedReviewer: 'Jane Doe',
    completedRequirements: 12,
    totalRequirements: 18,
    riskScore: 35,
    country: 'Kenya',
    contactEmail: 'tech@mobilepay.ke',
  },
  {
    id: 'OB-2024-003',
    organizationName: 'PayTech Solutions',
    stakeholderType: 'FINTECH',
    status: 'GOVERNANCE_APPROVAL',
    submittedAt: '2024-12-15T09:00:00Z',
    assignedReviewer: 'Mike Johnson',
    completedRequirements: 20,
    totalRequirements: 22,
    riskScore: 15,
    country: 'Ghana',
    contactEmail: 'compliance@paytech.gh',
  },
  {
    id: 'OB-2024-004',
    organizationName: 'Central Bank of Nigeria',
    stakeholderType: 'REGULATOR',
    status: 'SANDBOX_CERTIFIED',
    submittedAt: '2024-12-10T11:45:00Z',
    assignedReviewer: 'Sarah Wilson',
    completedRequirements: 10,
    totalRequirements: 10,
    riskScore: 5,
    country: 'Nigeria',
    contactEmail: 'integration@cbn.gov.ng',
  },
  {
    id: 'OB-2024-005',
    organizationName: 'QuickMerchant POS',
    stakeholderType: 'MERCHANT',
    status: 'SUBMITTED',
    submittedAt: '2024-12-22T16:00:00Z',
    assignedReviewer: 'Unassigned',
    completedRequirements: 0,
    totalRequirements: 12,
    riskScore: 45,
    country: 'South Africa',
    contactEmail: 'admin@quickmerchant.za',
  },
];

const defaultCaseDetail: CaseDetail = {
  id: 'OB-2024-001',
  organizationName: 'First National Bank',
  stakeholderType: 'BANK',
  status: 'DUE_DILIGENCE',
  submittedAt: '2024-12-20T10:30:00Z',
  assignedReviewer: 'John Smith',
  country: 'Nigeria',
  contactEmail: 'onboarding@fnb.ng',
  contactPhone: '+234 1 234 5678',
  registrationNumber: 'RC-123456',
  taxId: 'TIN-987654321',
  address: '123 Marina Street, Lagos, Nigeria',
  website: 'https://www.fnb.ng',
  description: 'First National Bank is a tier-1 commercial bank with over 500 branches nationwide.',
  requirements: [
    { id: 'REQ-001', name: 'Certificate of Incorporation', category: 'Legal', status: 'approved', reviewedBy: 'John Smith', reviewedAt: '2024-12-21T09:00:00Z' },
    { id: 'REQ-002', name: 'Banking License', category: 'Regulatory', status: 'approved', reviewedBy: 'John Smith', reviewedAt: '2024-12-21T09:15:00Z' },
    { id: 'REQ-003', name: 'AML/CFT Policy', category: 'Compliance', status: 'pending' },
    { id: 'REQ-004', name: 'Board Resolution', category: 'Legal', status: 'approved', reviewedBy: 'John Smith', reviewedAt: '2024-12-21T10:00:00Z' },
    { id: 'REQ-005', name: 'Financial Statements (3 years)', category: 'Financial', status: 'pending' },
    { id: 'REQ-006', name: 'IT Security Assessment', category: 'Technical', status: 'pending' },
    { id: 'REQ-007', name: 'Data Protection Policy', category: 'Compliance', status: 'approved', reviewedBy: 'Jane Doe', reviewedAt: '2024-12-21T11:00:00Z' },
    { id: 'REQ-008', name: 'Business Continuity Plan', category: 'Operational', status: 'pending' },
  ],
  documents: [
    { name: 'Certificate_of_Incorporation.pdf', type: 'PDF', uploadedAt: '2024-12-20T10:35:00Z', status: 'verified' },
    { name: 'Banking_License_2024.pdf', type: 'PDF', uploadedAt: '2024-12-20T10:36:00Z', status: 'verified' },
    { name: 'Board_Resolution_Dec2024.pdf', type: 'PDF', uploadedAt: '2024-12-20T10:40:00Z', status: 'verified' },
    { name: 'AML_Policy_v3.pdf', type: 'PDF', uploadedAt: '2024-12-20T10:45:00Z', status: 'pending_review' },
    { name: 'Financial_Statements_2021-2023.xlsx', type: 'Excel', uploadedAt: '2024-12-20T11:00:00Z', status: 'pending_review' },
  ],
  technicalProfile: {
    apiEndpoint: 'https://api.fnb.ng/payment-switch',
    callbackUrl: 'https://api.fnb.ng/callbacks/payment-switch',
    ipWhitelist: ['41.58.100.0/24', '41.58.101.0/24'],
    environment: 'sandbox',
  },
  timeline: [
    { event: 'Application Submitted', timestamp: '2024-12-20T10:30:00Z', actor: 'First National Bank' },
    { event: 'Assigned to Reviewer', timestamp: '2024-12-20T11:00:00Z', actor: 'System' },
    { event: 'Due Diligence Started', timestamp: '2024-12-20T11:05:00Z', actor: 'John Smith' },
    { event: 'Documents Uploaded', timestamp: '2024-12-20T11:30:00Z', actor: 'First National Bank' },
    { event: 'Requirement Approved: Certificate of Incorporation', timestamp: '2024-12-21T09:00:00Z', actor: 'John Smith' },
    { event: 'Requirement Approved: Banking License', timestamp: '2024-12-21T09:15:00Z', actor: 'John Smith' },
  ],
  notes: [
    { author: 'John Smith', content: 'Initial review completed. Waiting for AML policy review.', timestamp: '2024-12-21T12:00:00Z' },
    { author: 'Jane Doe', content: 'Data protection policy looks comprehensive. Approved.', timestamp: '2024-12-21T11:00:00Z' },
  ],
};

export function OnboardingPortal() {
  const [cases, setCases] = useState<OnboardingCase[]>([]);
  const [selectedCase, setSelectedCase] = useState<CaseDetail | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'requirements' | 'documents' | 'technical' | 'timeline' | 'notes'>('overview');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    inProgress: 0,
    completed: 0,
    avgProcessingDays: 0,
  });

  // Fetch cases from API on mount
  useEffect(() => {
    const fetchCases = async () => {
      try {
        setLoading(true);
        const response = await fetch(`${API_BASE}/api/v1/onboarding/cases`);
        if (response.ok) {
          const data = await response.json();
          setCases(data.cases || []);
        } else {
          log.error('Failed to fetch cases');
          setCases([]); // Fallback to default data
        }
      } catch (error) {
        log.error('Error fetching cases:', error);
        setCases([]); // Fallback to default data
      } finally {
        setLoading(false);
      }
    };

    const fetchStats = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/v1/onboarding/stats`);
        if (response.ok) {
          const data = await response.json();
          setStats(data);
        }
      } catch (error) {
        log.error('Error fetching stats:', error);
      }
    };

    fetchCases();
    fetchStats();
  }, []);

  const filteredCases = cases.filter((c) => {
    if (filterStatus !== 'all' && c.status !== filterStatus) return false;
    if (filterType !== 'all' && c.stakeholderType !== filterType) return false;
    if (searchQuery && !c.organizationName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  // Refetch cases from API
  const refetchCases = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/onboarding/cases`);
      if (response.ok) {
        const data = await response.json();
        setCases(data.cases || data || []);
      }
    } catch (error) {
      log.error('Error refetching onboarding cases:', error);
    }
  };

  const handleViewCase = async (caseId: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/onboarding/cases/${caseId}`);
      if (response.ok) {
        const data = await response.json();
        setSelectedCase(data);
      } else {
        log.error('Failed to fetch case details');
        setSelectedCase(null);
      }
    } catch (error) {
      log.error('Error fetching case:', error);
      setSelectedCase(null);
    }
  };

  const handleApproveRequirement = async (reqId: string) => {
    if (!selectedCase) return;
    try {
      const response = await fetch(`${API_BASE}/api/v1/onboarding/cases/${selectedCase.id}/requirements/${reqId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        setSelectedCase({
          ...selectedCase,
          requirements: selectedCase.requirements.map((r) =>
            r.id === reqId ? { ...r, status: 'approved', reviewedBy: 'Current User', reviewedAt: new Date().toISOString() } : r
          ),
        });
        await refetchCases();
        toast.success('Requirement approved successfully!');
      } else {
        toast.error('Failed to approve requirement. Please try again.');
      }
    } catch (error) {
      log.error('Error approving requirement:', error);
      toast.error('Error approving requirement. Please try again.');
    }
  };

  const handleRejectRequirement = async (reqId: string) => {
    if (!selectedCase) return;
    try {
      const response = await fetch(`${API_BASE}/api/v1/onboarding/cases/${selectedCase.id}/requirements/${reqId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        setSelectedCase({
          ...selectedCase,
          requirements: selectedCase.requirements.map((r) =>
            r.id === reqId ? { ...r, status: 'rejected', reviewedBy: 'Current User', reviewedAt: new Date().toISOString() } : r
          ),
        });
        await refetchCases();
        toast.warning('Requirement rejected.');
      } else {
        toast.error('Failed to reject requirement. Please try again.');
      }
    } catch (error) {
      log.error('Error rejecting requirement:', error);
      toast.error('Error rejecting requirement. Please try again.');
    }
  };

  const handleTransition = async (newStatus: string) => {
    if (!selectedCase) return;
    try {
      const response = await fetch(`${API_BASE}/api/v1/onboarding/cases/${selectedCase.id}/transition?new_status=${newStatus}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        setSelectedCase({ ...selectedCase, status: newStatus });
        await refetchCases();
        toast.success(`Case transitioned to ${newStatus.replace(/_/g, ' ')} successfully!`);
      } else {
        toast.error('Failed to transition case. Please try again.');
      }
    } catch (error) {
      log.error('Error transitioning case:', error);
      toast.error('Error transitioning case. Please try again.');
    }
  };

  const [provisioning, setProvisioning] = useState(false);
  const [provisioningResult, setProvisioningResult] = useState<{
    success: boolean;
    saga_id?: string;
    provisioned_resources?: Record<string, string>;
    message?: string;
  } | null>(null);

  const handleProvision = async (environment: 'sandbox' | 'production') => {
    if (!selectedCase) return;
    
    setProvisioning(true);
    setProvisioningResult(null);
    
    try {
      const response = await fetch(
        `${API_BASE}/api/v1/onboarding/cases/${selectedCase.id}/provision?environment=${environment}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }
      );
      
      if (response.ok) {
        const result = await response.json();
        setProvisioningResult(result);
        
        // Update local state with new status
        setSelectedCase({
          ...selectedCase,
          status: result.new_status,
        });
        
        // Refetch cases to update the list
        await refetchCases();
        
        toast.success(`Successfully provisioned ${environment.toUpperCase()} environment! Resources: Keycloak=${result.provisioned_resources.keycloak_client_id}, APISIX=${result.provisioned_resources.apisix_route_id}, TigerBeetle=${result.provisioned_resources.tigerbeetle_account_id}`);
      } else {
        const error = await response.json();
        toast.error(`Failed to provision: ${error.detail || 'Unknown error'}`);
      }
    } catch (error) {
      log.error('Error provisioning:', error);
      toast.error('Error provisioning resources. Please try again.');
    } finally {
      setProvisioning(false);
    }
  };

  if (selectedCase) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setSelectedCase(null)}
              className="text-gray-500 hover:text-gray-700"
            >
              <ChevronRight className="h-5 w-5 rotate-180" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{selectedCase.organizationName}</h1>
              <div className="flex items-center space-x-3 mt-1">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[selectedCase.status]}`}>
                  {selectedCase.status.replace(/_/g, ' ')}
                </span>
                <span className="text-sm text-gray-500">{selectedCase.id}</span>
                <span className="text-sm text-gray-500">{selectedCase.stakeholderType.replace(/_/g, ' ')}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            {selectedCase.status === 'DUE_DILIGENCE' && (
              <button
                onClick={() => handleTransition('TECHNICAL_SETUP')}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
              >
                Advance to Technical Setup
              </button>
            )}
            {selectedCase.status === 'TECHNICAL_SETUP' && (
              <button
                onClick={() => handleProvision('sandbox')}
                disabled={provisioning}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                {provisioning ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Provisioning...</span>
                  </>
                ) : (
                  <span>Provision Sandbox</span>
                )}
              </button>
            )}
            {selectedCase.status === 'SANDBOX_CERTIFIED' && (
              <button
                onClick={() => handleTransition('OPERATIONAL_READINESS')}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
              >
                Advance to Operational Readiness
              </button>
            )}
            {selectedCase.status === 'GOVERNANCE_APPROVAL' && (
              <button
                onClick={() => handleProvision('production')}
                disabled={provisioning}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                {provisioning ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Provisioning...</span>
                  </>
                ) : (
                  <span>Provision Production</span>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8">
            {(['overview', 'requirements', 'documents', 'technical', 'timeline', 'notes'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Organization Details</h3>
              <dl className="space-y-3">
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500">Registration Number</dt>
                  <dd className="text-sm font-medium text-gray-900">{selectedCase.registrationNumber}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500">Tax ID</dt>
                  <dd className="text-sm font-medium text-gray-900">{selectedCase.taxId}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500">Country</dt>
                  <dd className="text-sm font-medium text-gray-900">{selectedCase.country}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500">Website</dt>
                  <dd className="text-sm font-medium text-primary-600">{selectedCase.website}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500">Contact Email</dt>
                  <dd className="text-sm font-medium text-gray-900">{selectedCase.contactEmail}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500">Contact Phone</dt>
                  <dd className="text-sm font-medium text-gray-900">{selectedCase.contactPhone}</dd>
                </div>
              </dl>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Progress Summary</h3>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-500">Requirements Completed</span>
                    <span className="font-medium">
                      {selectedCase.requirements.filter((r) => r.status === 'approved').length} / {selectedCase.requirements.length}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-primary-600 h-2 rounded-full"
                      style={{
                        width: `${(selectedCase.requirements.filter((r) => r.status === 'approved').length / selectedCase.requirements.length) * 100}%`,
                      }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-500">Documents Verified</span>
                    <span className="font-medium">
                      {selectedCase.documents.filter((d) => d.status === 'verified').length} / {selectedCase.documents.length}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-green-600 h-2 rounded-full"
                      style={{
                        width: `${(selectedCase.documents.filter((d) => d.status === 'verified').length / selectedCase.documents.length) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-6 pt-4 border-t border-gray-100">
                <p className="text-sm text-gray-600">{selectedCase.description}</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'requirements' && (
          <div className="bg-white rounded-lg border border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Requirements Checklist</h3>
            </div>
            <div className="divide-y divide-gray-200">
              {selectedCase.requirements.map((req) => (
                <div key={req.id} className="p-4 flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    {req.status === 'approved' && <CheckCircle className="h-5 w-5 text-green-500" />}
                    {req.status === 'rejected' && <XCircle className="h-5 w-5 text-red-500" />}
                    {req.status === 'pending' && <Clock className="h-5 w-5 text-yellow-500" />}
                    {req.status === 'waived' && <AlertTriangle className="h-5 w-5 text-gray-400" />}
                    <div>
                      <p className="font-medium text-gray-900">{req.name}</p>
                      <p className="text-sm text-gray-500">{req.category}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    {req.reviewedBy && (
                      <span className="text-sm text-gray-500">
                        Reviewed by {req.reviewedBy}
                      </span>
                    )}
                    {req.status === 'pending' && (
                      <>
                        <button
                          onClick={() => handleApproveRequirement(req.id)}
                          className="p-2 text-green-600 hover:bg-green-50 rounded-lg"
                        >
                          <Check className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => handleRejectRequirement(req.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'documents' && (
          <div className="bg-white rounded-lg border border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Uploaded Documents</h3>
            </div>
            <div className="divide-y divide-gray-200">
              {selectedCase.documents.map((doc, idx) => (
                <div key={idx} className="p-4 flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <FileText className="h-8 w-8 text-gray-400" />
                    <div>
                      <p className="font-medium text-gray-900">{doc.name}</p>
                      <p className="text-sm text-gray-500">
                        {doc.type} - Uploaded {new Date(doc.uploadedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        doc.status === 'verified' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {doc.status === 'verified' ? 'Verified' : 'Pending Review'}
                    </span>
                    <button className="p-2 text-gray-400 hover:text-gray-600">
                      <Eye className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'technical' && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Technical Profile</h3>
            <dl className="space-y-4">
              <div>
                <dt className="text-sm font-medium text-gray-500">API Endpoint</dt>
                <dd className="mt-1 text-sm text-gray-900 font-mono bg-gray-50 p-2 rounded">
                  {selectedCase.technicalProfile.apiEndpoint}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Callback URL</dt>
                <dd className="mt-1 text-sm text-gray-900 font-mono bg-gray-50 p-2 rounded">
                  {selectedCase.technicalProfile.callbackUrl}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">IP Whitelist</dt>
                <dd className="mt-1 space-y-1">
                  {selectedCase.technicalProfile.ipWhitelist.map((ip, idx) => (
                    <span key={idx} className="inline-block mr-2 text-sm text-gray-900 font-mono bg-gray-50 px-2 py-1 rounded">
                      {ip}
                    </span>
                  ))}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Environment</dt>
                <dd className="mt-1">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    selectedCase.technicalProfile.environment === 'production'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {selectedCase.technicalProfile.environment.toUpperCase()}
                  </span>
                </dd>
              </div>
            </dl>
          </div>
        )}

        {activeTab === 'timeline' && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Activity Timeline</h3>
            <div className="flow-root">
              <ul className="-mb-8">
                {selectedCase.timeline.map((event, idx) => (
                  <li key={idx}>
                    <div className="relative pb-8">
                      {idx !== selectedCase.timeline.length - 1 && (
                        <span className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-gray-200" />
                      )}
                      <div className="relative flex space-x-3">
                        <div>
                          <span className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center ring-8 ring-white">
                            <Clock className="h-4 w-4 text-primary-600" />
                          </span>
                        </div>
                        <div className="flex min-w-0 flex-1 justify-between space-x-4 pt-1.5">
                          <div>
                            <p className="text-sm text-gray-900">{event.event}</p>
                            <p className="text-xs text-gray-500">by {event.actor}</p>
                          </div>
                          <div className="whitespace-nowrap text-right text-sm text-gray-500">
                            {new Date(event.timestamp).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {activeTab === 'notes' && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Review Notes</h3>
            <div className="space-y-4">
              {selectedCase.notes.map((note, idx) => (
                <div key={idx} className="bg-gray-50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-gray-900">{note.author}</span>
                    <span className="text-sm text-gray-500">{new Date(note.timestamp).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-gray-700">{note.content}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-gray-200">
              <textarea
                placeholder="Add a note..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
                rows={3}
              />
              <div className="mt-2 flex justify-end">
                <button className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">
                  Add Note
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Applications</p>
              <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
            </div>
            <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
              <FileText className="h-5 w-5 text-blue-600" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Pending Review</p>
              <p className="text-2xl font-bold text-yellow-600">{stats.pending}</p>
            </div>
            <div className="h-10 w-10 rounded-full bg-yellow-100 flex items-center justify-center">
              <Clock className="h-5 w-5 text-yellow-600" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">In Progress</p>
              <p className="text-2xl font-bold text-blue-600">{stats.inProgress}</p>
            </div>
            <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
              <RefreshCw className="h-5 w-5 text-blue-600" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Completed</p>
              <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
            </div>
            <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle className="h-5 w-5 text-green-600" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Avg. Processing</p>
              <p className="text-2xl font-bold text-gray-900">{stats.avgProcessingDays} days</p>
            </div>
            <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center">
              <Clock className="h-5 w-5 text-gray-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search organizations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="all">All Statuses</option>
            <option value="SUBMITTED">Submitted</option>
            <option value="DUE_DILIGENCE">Due Diligence</option>
            <option value="TECHNICAL_SETUP">Technical Setup</option>
            <option value="SANDBOX_CERTIFIED">Sandbox Certified</option>
            <option value="GOVERNANCE_APPROVAL">Governance Approval</option>
            <option value="ACTIVE">Active</option>
          </select>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="all">All Types</option>
            <option value="BANK">Bank</option>
            <option value="MOBILE_MONEY_OPERATOR">Mobile Money Operator</option>
            <option value="FINTECH">Fintech</option>
            <option value="MERCHANT">Merchant</option>
            <option value="REGULATOR">Regulator</option>
          </select>
        </div>
      </div>

      {/* Cases Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Organization
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Type
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Progress
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Risk Score
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Reviewer
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredCases.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center">
                      {stakeholderIcons[c.stakeholderType] || <Building2 className="h-5 w-5 text-gray-500" />}
                    </div>
                    <div className="ml-4">
                      <div className="text-sm font-medium text-gray-900">{c.organizationName}</div>
                      <div className="text-sm text-gray-500">{c.id}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm text-gray-900">{c.stakeholderType.replace(/_/g, ' ')}</span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[c.status]}`}>
                    {c.status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="w-24 bg-gray-200 rounded-full h-2 mr-2">
                      <div
                        className="bg-primary-600 h-2 rounded-full"
                        style={{ width: `${(c.completedRequirements / c.totalRequirements) * 100}%` }}
                      />
                    </div>
                    <span className="text-sm text-gray-500">
                      {c.completedRequirements}/{c.totalRequirements}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`text-sm font-medium ${
                      c.riskScore < 20 ? 'text-green-600' : c.riskScore < 40 ? 'text-yellow-600' : 'text-red-600'
                    }`}
                  >
                    {c.riskScore}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm text-gray-900">{c.assignedReviewer}</span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                  <button
                    onClick={() => handleViewCase(c.id)}
                    className="text-primary-600 hover:text-primary-900 text-sm font-medium"
                  >
                    View Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
