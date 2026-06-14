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
  Shield,
  Upload,
  Eye,
  RefreshCw,
  Users,
  Globe,
  Calendar,
  MapPin,
  CreditCard,
  FileImage,
  AlertCircle,
  Check,
  X,
  Download,
  Maximize2,
  RotateCw,
  Link,
  ExternalLink,
  UserCheck,
  Briefcase,
} from 'lucide-react';
import { createLogger } from '@/lib/logger';
const log = createLogger('KYBVerificationPortal');

// Types
type KYBStatus = 'DRAFT' | 'SUBMITTED' | 'DOCUMENTS_PENDING' | 'IN_PROGRESS' | 'KYC_PENDING' | 'SCREENING' | 'MANUAL_REVIEW' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type DocumentType = 'CERTIFICATE_OF_INCORPORATION' | 'BANKING_LICENSE' | 'MEMORANDUM_OF_ASSOCIATION' | 'ARTICLES_OF_ASSOCIATION' | 'BOARD_RESOLUTION' | 'SHAREHOLDER_REGISTER' | 'FINANCIAL_STATEMENTS' | 'TAX_CERTIFICATE' | 'REGULATORY_LICENSE' | 'AML_POLICY';

interface KYBCase {
  id: string;
  organizationName: string;
  registrationNumber: string;
  country: string;
  stakeholderType: string;
  status: KYBStatus;
  riskScore: number;
  riskLevel: RiskLevel;
  submittedAt: string;
  assignedReviewer?: string;
  completedRequirements: number;
  totalRequirements: number;
  kycProgress: { completed: number; total: number };
  createdAt: string;
  updatedAt: string;
}

interface KYBDocument {
  id: string;
  caseId: string;
  documentType: DocumentType;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
  status: 'PENDING' | 'PROCESSING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED';
  extractedData?: Record<string, string>;
  confidenceScore?: number;
  verificationNotes?: string;
  expiryDate?: string;
}

interface KYBPerson {
  id: string;
  caseId: string;
  personType: 'UBO' | 'DIRECTOR' | 'SIGNATORY' | 'ADMIN';
  firstName: string;
  lastName: string;
  ownershipPercentage?: number;
  kycStatus: 'PENDING' | 'IN_PROGRESS' | 'APPROVED' | 'REJECTED';
  kycId?: string;
}

interface ScreeningResult {
  type: 'SANCTIONS' | 'PEP' | 'ADVERSE_MEDIA' | 'WATCHLIST' | 'BUSINESS_REGISTRY';
  status: 'CLEAR' | 'POTENTIAL_MATCH' | 'CONFIRMED_MATCH';
  matchDetails?: string;
  source?: string;
  checkedAt: string;
}

interface KYBDetail extends KYBCase {
  taxId: string;
  address: string;
  website?: string;
  description?: string;
  incorporationDate: string;
  businessType: string;
  documents: KYBDocument[];
  persons: KYBPerson[];
  screeningResults: ScreeningResult[];
  timeline: { event: string; timestamp: string; actor: string }[];
  notes: { author: string; content: string; timestamp: string }[];
}

const API_BASE = process.env.NEXT_PUBLIC_KYB_API || 'https://app-kjesixal.fly.dev';

const statusColors: Record<KYBStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  SUBMITTED: 'bg-blue-100 text-blue-800',
  DOCUMENTS_PENDING: 'bg-yellow-100 text-yellow-800',
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  KYC_PENDING: 'bg-purple-100 text-purple-800',
  SCREENING: 'bg-indigo-100 text-indigo-800',
  MANUAL_REVIEW: 'bg-orange-100 text-orange-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-gray-100 text-gray-800',
};

const riskColors: Record<RiskLevel, string> = {
  LOW: 'bg-green-100 text-green-800',
  MEDIUM: 'bg-yellow-100 text-yellow-800',
  HIGH: 'bg-orange-100 text-orange-800',
  CRITICAL: 'bg-red-100 text-red-800',
};

const documentTypeLabels: Record<DocumentType, string> = {
  CERTIFICATE_OF_INCORPORATION: 'Certificate of Incorporation',
  BANKING_LICENSE: 'Banking License',
  MEMORANDUM_OF_ASSOCIATION: 'Memorandum of Association',
  ARTICLES_OF_ASSOCIATION: 'Articles of Association',
  BOARD_RESOLUTION: 'Board Resolution',
  SHAREHOLDER_REGISTER: 'Shareholder Register',
  FINANCIAL_STATEMENTS: 'Financial Statements',
  TAX_CERTIFICATE: 'Tax Certificate',
  REGULATORY_LICENSE: 'Regulatory License',
  AML_POLICY: 'AML/CFT Policy',
};

const stakeholderIcons: Record<string, React.ReactNode> = {
  BANK: <Building2 className="h-5 w-5" />,
  MOBILE_MONEY_OPERATOR: <CreditCard className="h-5 w-5" />,
  FINTECH: <Globe className="h-5 w-5" />,
  MICROFINANCE_INSTITUTION: <Building2 className="h-5 w-5" />,
  GOVERNMENT_AGENCY: <Shield className="h-5 w-5" />,
  MERCHANT: <CreditCard className="h-5 w-5" />,
  REGULATOR: <Shield className="h-5 w-5" />,
};

const defaultCases: KYBCase[] = [
  {
    id: 'KYB-001',
    organizationName: 'First National Bank',
    registrationNumber: 'RC-123456',
    country: 'Nigeria',
    stakeholderType: 'BANK',
    status: 'KYC_PENDING',
    riskScore: 25,
    riskLevel: 'LOW',
    submittedAt: '2024-12-20T10:30:00Z',
    assignedReviewer: 'John Smith',
    completedRequirements: 8,
    totalRequirements: 10,
    kycProgress: { completed: 1, total: 3 },
    createdAt: '2024-12-20T10:30:00Z',
    updatedAt: '2024-12-22T14:00:00Z',
  },
  {
    id: 'KYB-002',
    organizationName: 'MobilePay Ltd',
    registrationNumber: 'KE-789012',
    country: 'Kenya',
    stakeholderType: 'MOBILE_MONEY_OPERATOR',
    status: 'SCREENING',
    riskScore: 35,
    riskLevel: 'MEDIUM',
    submittedAt: '2024-12-18T14:20:00Z',
    assignedReviewer: 'Jane Doe',
    completedRequirements: 10,
    totalRequirements: 10,
    kycProgress: { completed: 2, total: 2 },
    createdAt: '2024-12-18T14:20:00Z',
    updatedAt: '2024-12-22T09:00:00Z',
  },
  {
    id: 'KYB-003',
    organizationName: 'PayTech Solutions',
    registrationNumber: 'GH-345678',
    country: 'Ghana',
    stakeholderType: 'FINTECH',
    status: 'APPROVED',
    riskScore: 15,
    riskLevel: 'LOW',
    submittedAt: '2024-12-15T09:00:00Z',
    assignedReviewer: 'Mike Johnson',
    completedRequirements: 12,
    totalRequirements: 12,
    kycProgress: { completed: 4, total: 4 },
    createdAt: '2024-12-15T09:00:00Z',
    updatedAt: '2024-12-20T11:00:00Z',
  },
  {
    id: 'KYB-004',
    organizationName: 'QuickMerchant POS',
    registrationNumber: 'ZA-901234',
    country: 'South Africa',
    stakeholderType: 'MERCHANT',
    status: 'DOCUMENTS_PENDING',
    riskScore: 45,
    riskLevel: 'MEDIUM',
    submittedAt: '2024-12-22T16:00:00Z',
    completedRequirements: 3,
    totalRequirements: 8,
    kycProgress: { completed: 0, total: 2 },
    createdAt: '2024-12-22T16:00:00Z',
    updatedAt: '2024-12-22T16:00:00Z',
  },
  {
    id: 'KYB-005',
    organizationName: 'ShadyFinance Inc',
    registrationNumber: 'XX-000001',
    country: 'Unknown',
    stakeholderType: 'FINTECH',
    status: 'REJECTED',
    riskScore: 95,
    riskLevel: 'CRITICAL',
    submittedAt: '2024-12-10T08:00:00Z',
    assignedReviewer: 'Sarah Wilson',
    completedRequirements: 2,
    totalRequirements: 10,
    kycProgress: { completed: 0, total: 2 },
    createdAt: '2024-12-10T08:00:00Z',
    updatedAt: '2024-12-12T15:00:00Z',
  },
];

const defaultDetail: KYBDetail = {
  id: 'KYB-001',
  organizationName: 'First National Bank',
  registrationNumber: 'RC-123456',
  country: 'Nigeria',
  stakeholderType: 'BANK',
  status: 'KYC_PENDING',
  riskScore: 25,
  riskLevel: 'LOW',
  submittedAt: '2024-12-20T10:30:00Z',
  assignedReviewer: 'John Smith',
  completedRequirements: 8,
  totalRequirements: 10,
  kycProgress: { completed: 1, total: 3 },
  createdAt: '2024-12-20T10:30:00Z',
  updatedAt: '2024-12-22T14:00:00Z',
  taxId: 'TIN-987654321',
  address: '123 Marina Street, Lagos, Nigeria',
  website: 'https://www.fnb.ng',
  description: 'First National Bank is a tier-1 commercial bank with over 500 branches nationwide.',
  incorporationDate: '1985-03-15',
  businessType: 'Commercial Banking',
  documents: [
    {
      id: 'DOC-001',
      caseId: 'KYB-001',
      documentType: 'CERTIFICATE_OF_INCORPORATION',
      fileName: 'certificate_of_incorporation.pdf',
      fileSize: 2456789,
      uploadedAt: '2024-12-20T11:00:00Z',
      status: 'VERIFIED',
      extractedData: {
        company_name: 'FIRST NATIONAL BANK PLC',
        registration_number: 'RC-123456',
        incorporation_date: '1985-03-15',
        registered_address: '123 MARINA STREET, LAGOS',
      },
      confidenceScore: 0.96,
    },
    {
      id: 'DOC-002',
      caseId: 'KYB-001',
      documentType: 'BANKING_LICENSE',
      fileName: 'banking_license_2024.pdf',
      fileSize: 1234567,
      uploadedAt: '2024-12-20T11:05:00Z',
      status: 'VERIFIED',
      extractedData: {
        license_number: 'CBN/BL/2024/001',
        licensee: 'FIRST NATIONAL BANK PLC',
        license_type: 'COMMERCIAL BANKING',
        issue_date: '2024-01-01',
        expiry_date: '2026-12-31',
        issuing_authority: 'CENTRAL BANK OF NIGERIA',
      },
      confidenceScore: 0.94,
      expiryDate: '2026-12-31',
    },
    {
      id: 'DOC-003',
      caseId: 'KYB-001',
      documentType: 'BOARD_RESOLUTION',
      fileName: 'board_resolution_dec2024.pdf',
      fileSize: 987654,
      uploadedAt: '2024-12-20T11:10:00Z',
      status: 'VERIFIED',
      extractedData: {
        resolution_date: '2024-12-15',
        resolution_type: 'AUTHORIZATION TO JOIN PAYMENT SWITCH',
        authorized_signatories: 'JOHN ADEYEMI, AMINA OKONKWO',
      },
      confidenceScore: 0.91,
    },
    {
      id: 'DOC-004',
      caseId: 'KYB-001',
      documentType: 'SHAREHOLDER_REGISTER',
      fileName: 'shareholder_register.xlsx',
      fileSize: 456789,
      uploadedAt: '2024-12-20T11:15:00Z',
      status: 'PROCESSING',
    },
    {
      id: 'DOC-005',
      caseId: 'KYB-001',
      documentType: 'AML_POLICY',
      fileName: 'aml_cft_policy_v3.pdf',
      fileSize: 3456789,
      uploadedAt: '2024-12-20T11:20:00Z',
      status: 'PENDING',
    },
  ],
  persons: [
    {
      id: 'PERSON-001',
      caseId: 'KYB-001',
      personType: 'DIRECTOR',
      firstName: 'John',
      lastName: 'Adeyemi',
      kycStatus: 'IN_PROGRESS',
      kycId: 'KYC-001',
    },
    {
      id: 'PERSON-002',
      caseId: 'KYB-001',
      personType: 'UBO',
      firstName: 'Amina',
      lastName: 'Okonkwo',
      ownershipPercentage: 35,
      kycStatus: 'APPROVED',
      kycId: 'KYC-002',
    },
    {
      id: 'PERSON-003',
      caseId: 'KYB-001',
      personType: 'SIGNATORY',
      firstName: 'Chidi',
      lastName: 'Eze',
      kycStatus: 'PENDING',
    },
  ],
  screeningResults: [
    {
      type: 'SANCTIONS',
      status: 'CLEAR',
      source: 'OFAC, UN, EU, CBN',
      checkedAt: '2024-12-21T09:00:00Z',
    },
    {
      type: 'BUSINESS_REGISTRY',
      status: 'CLEAR',
      source: 'CAC Nigeria',
      checkedAt: '2024-12-21T09:00:00Z',
    },
    {
      type: 'ADVERSE_MEDIA',
      status: 'CLEAR',
      source: 'LexisNexis',
      checkedAt: '2024-12-21T09:00:00Z',
    },
  ],
  timeline: [
    { event: 'KYB Case Created', timestamp: '2024-12-20T10:30:00Z', actor: 'System' },
    { event: 'Documents Uploaded', timestamp: '2024-12-20T11:00:00Z', actor: 'First National Bank' },
    { event: 'Assigned to Reviewer', timestamp: '2024-12-20T11:30:00Z', actor: 'System' },
    { event: 'Document OCR Started', timestamp: '2024-12-20T11:35:00Z', actor: 'Docling/PaddleOCR/LLaVA' },
    { event: 'Certificate of Incorporation Verified', timestamp: '2024-12-20T12:00:00Z', actor: 'John Smith' },
    { event: 'Banking License Verified', timestamp: '2024-12-20T12:15:00Z', actor: 'John Smith' },
    { event: 'KYC Initiated for Directors/UBOs', timestamp: '2024-12-21T08:00:00Z', actor: 'System' },
    { event: 'Screening Completed', timestamp: '2024-12-21T09:00:00Z', actor: 'System' },
    { event: 'UBO KYC Approved', timestamp: '2024-12-21T16:00:00Z', actor: 'Jane Doe' },
  ],
  notes: [
    {
      author: 'John Smith',
      content: 'All corporate documents verified. Waiting for KYC completion of all directors and UBOs.',
      timestamp: '2024-12-21T12:00:00Z',
    },
    {
      author: 'System',
      content: 'KYC for Amina Okonkwo (UBO, 35%) approved. 2 KYC cases remaining.',
      timestamp: '2024-12-21T16:00:00Z',
    },
  ],
};

// Document Viewer Modal
function DocumentViewer({ document, onClose }: { document: KYBDocument; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h3 className="font-semibold text-gray-900">{documentTypeLabels[document.documentType]}</h3>
            <p className="text-sm text-gray-500">{document.fileName}</p>
          </div>
          <div className="flex items-center space-x-2">
            <button className="p-2 hover:bg-gray-100 rounded">
              <Download className="h-5 w-5 text-gray-600" />
            </button>
            <button className="p-2 hover:bg-gray-100 rounded">
              <Maximize2 className="h-5 w-5 text-gray-600" />
            </button>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded">
              <X className="h-5 w-5 text-gray-600" />
            </button>
          </div>
        </div>
        <div className="p-4 bg-gray-100 min-h-[400px] flex items-center justify-center">
          <div className="bg-white p-8 rounded shadow-lg text-center">
            <FileImage className="h-24 w-24 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">Document Preview</p>
            <p className="text-sm text-gray-400 mt-2">{document.fileName}</p>
          </div>
        </div>
        {document.extractedData && (
          <div className="p-4 border-t">
            <h4 className="font-medium text-gray-900 mb-3">
              Extracted Data (Confidence: {((document.confidenceScore || 0) * 100).toFixed(0)}%)
            </h4>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(document.extractedData).map(([key, value]) => (
                <div key={key} className="flex justify-between text-sm">
                  <span className="text-gray-500">{key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
                  <span className="font-medium text-gray-900">{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function KYBVerificationPortal() {
  const [cases, setCases] = useState<KYBCase[]>([]);
  const [selectedCase, setSelectedCase] = useState<KYBDetail | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'documents' | 'persons' | 'screening' | 'timeline' | 'notes'>('overview');
  const [viewingDocument, setViewingDocument] = useState<KYBDocument | null>(null);
    const [loading, setLoading] = useState(true);
    const [showNewCaseModal, setShowNewCaseModal] = useState(false);
    const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    inProgress: 0,
    approved: 0,
    rejected: 0,
    avgProcessingDays: 0,
  });

  // Fetch KYB cases from API on mount
  useEffect(() => {
    const fetchCases = async () => {
      try {
        setLoading(true);
        const response = await fetch(`${API_BASE}/api/v1/kyb/cases`);
        if (response.ok) {
          const data = await response.json();
          // Map API response to KYBCase format
          const mappedCases = (data.cases || []).map((c: any) => ({
            id: c.id,
            organizationName: c.businessName || '',
            stakeholderType: c.businessType || 'LIMITED_COMPANY',
            registrationNumber: c.registrationNumber || '',
            incorporationDate: c.incorporationDate || '',
            country: c.country || '',
            status: c.status === 'PENDING_REVIEW' ? 'MANUAL_REVIEW' : c.status,
            riskScore: c.riskScore || 0,
            riskLevel: c.riskScore > 70 ? 'HIGH' : c.riskScore > 40 ? 'MEDIUM' : 'LOW',
            createdAt: c.submittedAt,
            updatedAt: c.submittedAt,
          }));
          setCases(mappedCases.length > 0 ? mappedCases : defaultCases);
        } else {
          setCases([]);
        }
      } catch (error) {
        log.error('Error fetching KYB cases:', error);
        setCases([]);
      } finally {
        setLoading(false);
      }
    };
    fetchCases();
  }, []);

  const filteredCases = cases.filter((c) => {
    if (filterStatus !== 'all' && c.status !== filterStatus) return false;
    if (filterType !== 'all' && c.stakeholderType !== filterType) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        c.organizationName.toLowerCase().includes(query) ||
        c.registrationNumber.toLowerCase().includes(query) ||
        c.id.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const handleViewCase = async (caseId: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/kyb/cases/${caseId}`);
      if (response.ok) {
        const data = await response.json();
        setSelectedCase(data);
      } else {
        setSelectedCase(null);
      }
    } catch (error) {
      log.error('Error fetching KYB case:', error);
      setSelectedCase(null);
    }
  };

  // Refetch cases from API
  const refetchCases = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/kyb/cases`);
      if (response.ok) {
        const data = await response.json();
        const mappedCases = (data.cases || []).map((c: any) => ({
          id: c.id,
          organizationName: c.organizationName,
          registrationNumber: c.registrationNumber,
          country: c.country,
          stakeholderType: c.stakeholderType,
          status: c.status,
          riskScore: c.riskScore || 0,
          riskLevel: c.riskScore > 70 ? 'HIGH' : c.riskScore > 40 ? 'MEDIUM' : 'LOW',
          submittedAt: c.submittedAt,
          assignedReviewer: c.assignedReviewer,
          completedRequirements: c.completedRequirements || 0,
          totalRequirements: c.totalRequirements || 5,
          kycProgress: c.kycProgress || { completed: 0, total: 0 },
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        }));
        setCases(mappedCases.length > 0 ? mappedCases : defaultCases);
      }
    } catch (error) {
      log.error('Error refetching KYB cases:', error);
    }
  };

  const handleApprove = async () => {
    if (!selectedCase) return;
    try {
      const response = await fetch(`${API_BASE}/api/v1/kyb/cases/${selectedCase.id}/approve`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        setSelectedCase({ ...selectedCase, status: 'APPROVED' });
        await refetchCases();
        toast.success('KYB case approved successfully!');
      } else {
        toast.error('Failed to approve KYB case. Please try again.');
      }
    } catch (error) {
      log.error('Error approving KYB case:', error);
      toast.error('Error approving KYB case. Please try again.');
    }
  };

  const handleReject = async () => {
    if (!selectedCase) return;
    try {
      const response = await fetch(`${API_BASE}/api/v1/kyb/cases/${selectedCase.id}/reject`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        setSelectedCase({ ...selectedCase, status: 'REJECTED' });
        await refetchCases();
        toast.warning('KYB case rejected.');
      } else {
        toast.error('Failed to reject KYB case. Please try again.');
      }
    } catch (error) {
      log.error('Error rejecting KYB case:', error);
      toast.error('Error rejecting KYB case. Please try again.');
    }
  };

  const handleRequestDocuments = async () => {
    if (!selectedCase) return;
    toast.info('Document request sent to ' + selectedCase.organizationName);
  };

  const handleRerunScreening = async () => {
    if (!selectedCase) return;
    toast.info('Re-running screening checks...');
  };

  const handleInitiateKYC = async (personId: string) => {
    toast.info('Initiating KYC for person ' + personId);
  };

  // Detail View
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
            <div className="flex items-center space-x-3">
              <div className="h-12 w-12 bg-primary-100 rounded-full flex items-center justify-center">
                {stakeholderIcons[selectedCase.stakeholderType] || <Building2 className="h-6 w-6 text-primary-600" />}
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{selectedCase.organizationName}</h1>
                <div className="flex items-center space-x-3 mt-1">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[selectedCase.status]}`}>
                    {selectedCase.status.replace(/_/g, ' ')}
                  </span>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${riskColors[selectedCase.riskLevel]}`}>
                    Risk: {selectedCase.riskLevel}
                  </span>
                  <span className="text-sm text-gray-500">{selectedCase.id}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            {selectedCase.status === 'MANUAL_REVIEW' && (
              <>
                <button
                  onClick={handleReject}
                  className="px-4 py-2 border border-red-300 text-red-700 rounded-lg hover:bg-red-50"
                >
                  Reject
                </button>
                <button
                  onClick={handleApprove}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                  Approve KYB
                </button>
              </>
            )}
            {selectedCase.status === 'DOCUMENTS_PENDING' && (
              <button
                onClick={handleRequestDocuments}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
              >
                Send Document Request
              </button>
            )}
            {selectedCase.status === 'SCREENING' && (
              <button
                onClick={handleRerunScreening}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
              >
                <RefreshCw className="h-4 w-4 inline mr-2" />
                Re-run Screening
              </button>
            )}
          </div>
        </div>

        {/* KYC Progress Banner */}
        {selectedCase.status === 'KYC_PENDING' && (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Users className="h-5 w-5 text-purple-600" />
                <div>
                  <p className="text-sm font-medium text-purple-900">KYC Verification Required</p>
                  <p className="text-sm text-purple-700">
                    {selectedCase.kycProgress?.completed ?? 0}/{selectedCase.kycProgress?.total ?? 0} persons verified
                  </p>
                </div>
              </div>
              <div className="w-32 bg-purple-200 rounded-full h-2">
                <div
                  className="bg-purple-600 h-2 rounded-full"
                  style={{ width: `${((selectedCase.kycProgress?.completed ?? 0) / (selectedCase.kycProgress?.total || 1)) * 100}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8">
            {(['overview', 'documents', 'persons', 'screening', 'timeline', 'notes'] as const).map((tab) => (
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
                {tab === 'persons' && (
                  <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-purple-100 text-purple-800">
                    {selectedCase.kycProgress?.completed ?? 0}/{selectedCase.kycProgress?.total ?? 0}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Organization Information */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Organization Details</h3>
              <dl className="space-y-3">
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500 flex items-center">
                    <Building2 className="h-4 w-4 mr-2" /> Organization Name
                  </dt>
                  <dd className="text-sm font-medium text-gray-900">{selectedCase.organizationName}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500 flex items-center">
                    <FileText className="h-4 w-4 mr-2" /> Registration Number
                  </dt>
                  <dd className="text-sm font-medium text-gray-900">{selectedCase.registrationNumber}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500 flex items-center">
                    <CreditCard className="h-4 w-4 mr-2" /> Tax ID
                  </dt>
                  <dd className="text-sm font-medium text-gray-900">{selectedCase.taxId}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500 flex items-center">
                    <Globe className="h-4 w-4 mr-2" /> Country
                  </dt>
                  <dd className="text-sm font-medium text-gray-900">{selectedCase.country}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500 flex items-center">
                    <MapPin className="h-4 w-4 mr-2" /> Address
                  </dt>
                  <dd className="text-sm font-medium text-gray-900">{selectedCase.address}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500 flex items-center">
                    <Calendar className="h-4 w-4 mr-2" /> Incorporated
                  </dt>
                  <dd className="text-sm font-medium text-gray-900">{selectedCase.incorporationDate}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500 flex items-center">
                    <Briefcase className="h-4 w-4 mr-2" /> Business Type
                  </dt>
                  <dd className="text-sm font-medium text-gray-900">{selectedCase.businessType}</dd>
                </div>
                {selectedCase.website && (
                  <div className="flex justify-between">
                    <dt className="text-sm text-gray-500">Website</dt>
                    <dd className="text-sm font-medium text-primary-600">
                      <a href={selectedCase.website} target="_blank" rel="noopener noreferrer" className="flex items-center">
                        {selectedCase.website} <ExternalLink className="h-3 w-3 ml-1" />
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Verification Summary */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Verification Summary</h3>
              <div className="space-y-4">
                {/* Documents */}
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <FileText className="h-5 w-5 text-gray-600" />
                    <span className="text-sm font-medium text-gray-900">Documents</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-600">
                      {selectedCase.documents.filter(d => d.status === 'VERIFIED').length}/{selectedCase.documents.length} verified
                    </span>
                    {selectedCase.documents.every(d => d.status === 'VERIFIED') ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : (
                      <Clock className="h-5 w-5 text-yellow-500" />
                    )}
                  </div>
                </div>

                {/* KYC */}
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <Users className="h-5 w-5 text-gray-600" />
                    <span className="text-sm font-medium text-gray-900">KYC (Directors/UBOs)</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-600">
                      {selectedCase.kycProgress?.completed ?? 0}/{selectedCase.kycProgress?.total ?? 0} approved
                    </span>
                    {(selectedCase.kycProgress?.completed ?? 0) === (selectedCase.kycProgress?.total ?? 0) && (selectedCase.kycProgress?.total ?? 0) > 0 ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : (
                      <Clock className="h-5 w-5 text-purple-500" />
                    )}
                  </div>
                </div>

                {/* Screening */}
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <Shield className="h-5 w-5 text-gray-600" />
                    <span className="text-sm font-medium text-gray-900">Screening</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    {selectedCase.screeningResults.length > 0 ? (
                      <>
                        <span className="text-sm text-gray-600">
                          {selectedCase.screeningResults.filter(s => s.status === 'CLEAR').length}/{selectedCase.screeningResults.length} clear
                        </span>
                        {selectedCase.screeningResults.every(s => s.status === 'CLEAR') ? (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        ) : (
                          <AlertTriangle className="h-5 w-5 text-orange-500" />
                        )}
                      </>
                    ) : (
                      <>
                        <span className="text-sm text-gray-600">Pending</span>
                        <Clock className="h-5 w-5 text-gray-400" />
                      </>
                    )}
                  </div>
                </div>

                {/* Risk Score */}
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <AlertCircle className="h-5 w-5 text-gray-600" />
                    <span className="text-sm font-medium text-gray-900">Risk Score</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium text-gray-900">{selectedCase.riskScore}/100</span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${riskColors[selectedCase.riskLevel]}`}>
                      {selectedCase.riskLevel}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'documents' && (
          <div className="space-y-4">
            {selectedCase.documents.map((doc) => (
              <div key={doc.id} className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="h-12 w-12 bg-gray-100 rounded-lg flex items-center justify-center">
                      <FileImage className="h-6 w-6 text-gray-600" />
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-900">{documentTypeLabels[doc.documentType]}</h4>
                      <p className="text-sm text-gray-500">{doc.fileName}</p>
                      <p className="text-xs text-gray-400">
                        Uploaded {new Date(doc.uploadedAt).toLocaleDateString()}
                        {doc.confidenceScore && ` • ${(doc.confidenceScore * 100).toFixed(0)}% confidence`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      doc.status === 'VERIFIED' ? 'bg-green-100 text-green-800' :
                      doc.status === 'REJECTED' ? 'bg-red-100 text-red-800' :
                      doc.status === 'PROCESSING' ? 'bg-blue-100 text-blue-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {doc.status}
                    </span>
                    <button
                      onClick={() => setViewingDocument(doc)}
                      className="p-2 hover:bg-gray-100 rounded"
                    >
                      <Eye className="h-5 w-5 text-gray-600" />
                    </button>
                  </div>
                </div>
                {doc.extractedData && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <h5 className="text-sm font-medium text-gray-700 mb-2">Extracted Data (Docling + PaddleOCR + LLaVA)</h5>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {Object.entries(doc.extractedData).slice(0, 6).map(([key, value]) => (
                        <div key={key} className="text-sm">
                          <span className="text-gray-500">{key.replace(/_/g, ' ')}: </span>
                          <span className="font-medium text-gray-900">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'persons' && (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-blue-800">
                <strong>KYC Requirement:</strong> All directors, UBOs (25%+ ownership), and authorized signatories must complete KYC verification before KYB can be approved.
              </p>
            </div>
            {selectedCase.persons.map((person) => (
              <div key={person.id} className={`bg-white rounded-lg border p-4 ${
                person.kycStatus === 'APPROVED' ? 'border-green-200' :
                person.kycStatus === 'REJECTED' ? 'border-red-200' :
                person.kycStatus === 'IN_PROGRESS' ? 'border-blue-200' :
                'border-gray-200'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className={`h-12 w-12 rounded-full flex items-center justify-center ${
                      person.kycStatus === 'APPROVED' ? 'bg-green-100' :
                      person.kycStatus === 'REJECTED' ? 'bg-red-100' :
                      person.kycStatus === 'IN_PROGRESS' ? 'bg-blue-100' :
                      'bg-gray-100'
                    }`}>
                      <UserCheck className={`h-6 w-6 ${
                        person.kycStatus === 'APPROVED' ? 'text-green-600' :
                        person.kycStatus === 'REJECTED' ? 'text-red-600' :
                        person.kycStatus === 'IN_PROGRESS' ? 'text-blue-600' :
                        'text-gray-600'
                      }`} />
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-900">
                        {person.firstName} {person.lastName}
                      </h4>
                      <p className="text-sm text-gray-500">
                        {person.personType}
                        {person.ownershipPercentage && ` • ${person.ownershipPercentage}% ownership`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                      person.kycStatus === 'APPROVED' ? 'bg-green-100 text-green-800' :
                      person.kycStatus === 'REJECTED' ? 'bg-red-100 text-red-800' :
                      person.kycStatus === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      KYC: {person.kycStatus.replace(/_/g, ' ')}
                    </span>
                    {person.kycId ? (
                      <button className="text-primary-600 hover:text-primary-800 text-sm font-medium flex items-center">
                        View KYC <ExternalLink className="h-3 w-3 ml-1" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleInitiateKYC(person.id)}
                        className="px-3 py-1 bg-primary-600 text-white rounded text-sm hover:bg-primary-700"
                      >
                        Initiate KYC
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'screening' && (
          <div className="space-y-4">
            {selectedCase.screeningResults.map((result, idx) => (
              <div key={idx} className={`bg-white rounded-lg border p-4 ${
                result.status === 'CLEAR' ? 'border-green-200' :
                result.status === 'POTENTIAL_MATCH' ? 'border-orange-200' :
                'border-red-200'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    {result.status === 'CLEAR' ? (
                      <CheckCircle className="h-6 w-6 text-green-500" />
                    ) : result.status === 'POTENTIAL_MATCH' ? (
                      <AlertTriangle className="h-6 w-6 text-orange-500" />
                    ) : (
                      <XCircle className="h-6 w-6 text-red-500" />
                    )}
                    <div>
                      <h4 className="font-medium text-gray-900">{result.type.replace(/_/g, ' ')}</h4>
                      <p className="text-sm text-gray-500">Source: {result.source}</p>
                    </div>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                    result.status === 'CLEAR' ? 'bg-green-100 text-green-800' :
                    result.status === 'POTENTIAL_MATCH' ? 'bg-orange-100 text-orange-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {result.status.replace(/_/g, ' ')}
                  </span>
                </div>
                {result.matchDetails && (
                  <div className="mt-3 p-3 bg-orange-50 rounded-lg">
                    <p className="text-sm text-orange-800">{result.matchDetails}</p>
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-2">
                  Checked: {new Date(result.checkedAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'timeline' && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
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
                          <span className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center">
                            <Clock className="h-4 w-4 text-primary-600" />
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">{event.event}</p>
                          <p className="text-sm text-gray-500">
                            {event.actor} • {new Date(event.timestamp).toLocaleString()}
                          </p>
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
          <div className="space-y-4">
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <textarea
                placeholder="Add a note..."
                className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                rows={3}
              />
              <div className="flex justify-end mt-2">
                <button className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700">
                  Add Note
                </button>
              </div>
            </div>
            {selectedCase.notes.map((note, idx) => (
              <div key={idx} className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-900">{note.author}</span>
                  <span className="text-sm text-gray-500">{new Date(note.timestamp).toLocaleString()}</span>
                </div>
                <p className="text-sm text-gray-700">{note.content}</p>
              </div>
            ))}
          </div>
        )}

        {/* Document Viewer Modal */}
        {viewingDocument && (
          <DocumentViewer document={viewingDocument} onClose={() => setViewingDocument(null)} />
        )}
      </div>
    );
  }

  // List View
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">KYB Verification</h1>
          <p className="text-gray-500 mt-1">Manage business entity verification</p>
        </div>
                <button 
                  onClick={() => setShowNewCaseModal(true)}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                >
                  + New KYB Case
                </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Total</p>
          <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Pending</p>
          <p className="text-2xl font-bold text-yellow-600">{stats.pending}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">In Progress</p>
          <p className="text-2xl font-bold text-blue-600">{stats.inProgress}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Approved</p>
          <p className="text-2xl font-bold text-green-600">{stats.approved}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Rejected</p>
          <p className="text-2xl font-bold text-red-600">{stats.rejected}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Avg. Days</p>
          <p className="text-2xl font-bold text-gray-900">{stats.avgProcessingDays}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, registration number, or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        >
          <option value="all">All Statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="SUBMITTED">Submitted</option>
          <option value="DOCUMENTS_PENDING">Documents Pending</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="KYC_PENDING">KYC Pending</option>
          <option value="SCREENING">Screening</option>
          <option value="MANUAL_REVIEW">Manual Review</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        >
          <option value="all">All Types</option>
          <option value="BANK">Bank</option>
          <option value="MOBILE_MONEY_OPERATOR">Mobile Money Operator</option>
          <option value="FINTECH">Fintech</option>
          <option value="MICROFINANCE_INSTITUTION">Microfinance</option>
          <option value="MERCHANT">Merchant</option>
          <option value="GOVERNMENT_AGENCY">Government Agency</option>
          <option value="REGULATOR">Regulator</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Organization</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Country</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">KYC</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Risk</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredCases.map((kybCase) => (
              <tr key={kybCase.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="h-10 w-10 bg-primary-100 rounded-full flex items-center justify-center">
                      {stakeholderIcons[kybCase.stakeholderType] || <Building2 className="h-5 w-5 text-primary-600" />}
                    </div>
                    <div className="ml-4">
                      <div className="text-sm font-medium text-gray-900">{kybCase.organizationName}</div>
                      <div className="text-sm text-gray-500">{kybCase.id}</div>
                    </div>
                  </div>
                </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm text-gray-900">{(kybCase.stakeholderType || 'LIMITED_COMPANY').replace(/_/g, ' ')}</span>
                  </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm text-gray-900">{kybCase.country}</span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[kybCase.status]}`}>
                    {kybCase.status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-600">
                      {kybCase.kycProgress?.completed ?? 0}/{kybCase.kycProgress?.total ?? 0}
                    </span>
                    {(kybCase.kycProgress?.completed ?? 0) === (kybCase.kycProgress?.total ?? 0) && (kybCase.kycProgress?.total ?? 0) > 0 ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <Clock className="h-4 w-4 text-purple-500" />
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${riskColors[kybCase.riskLevel]}`}>
                    {kybCase.riskLevel}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                  <button
                    onClick={() => handleViewCase(kybCase.id)}
                    className="text-primary-600 hover:text-primary-900 text-sm font-medium"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* New KYB Case Modal */}
      {showNewCaseModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-lg w-full mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900">New KYB Case</h2>
              <button onClick={() => setShowNewCaseModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-6 w-6" />
              </button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              const newCase = {
                organizationName: formData.get('organizationName') as string,
                registrationNumber: formData.get('registrationNumber') as string,
                country: formData.get('country') as string,
                stakeholderType: formData.get('stakeholderType') as string,
                status: 'DRAFT',
                riskScore: 0,
                submittedAt: new Date().toISOString(),
              };
              try {
                const response = await fetch(`${API_BASE}/api/v1/kyb/cases`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(newCase),
                });
                if (response.ok) {
                  setShowNewCaseModal(false);
                  await refetchCases();
                  toast.success('KYB case created successfully!');
                } else {
                  toast.error('Failed to create KYB case. Please try again.');
                }
              } catch (error) {
                log.error('Error creating KYB case:', error);
                toast.error('Error creating KYB case. Please try again.');
              }
            }}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Organization Name *</label>
                  <input name="organizationName" required className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Registration Number *</label>
                  <input name="registrationNumber" required className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Country *</label>
                  <input name="country" required className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Business Type *</label>
                  <select name="stakeholderType" required className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500">
                    <option value="LIMITED_COMPANY">Limited Company</option>
                    <option value="BANK">Bank</option>
                    <option value="MOBILE_MONEY_OPERATOR">Mobile Money Operator</option>
                    <option value="FINTECH">Fintech</option>
                    <option value="MICROFINANCE_INSTITUTION">Microfinance Institution</option>
                    <option value="MERCHANT">Merchant</option>
                    <option value="GOVERNMENT_AGENCY">Government Agency</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end space-x-3 mt-6">
                <button type="button" onClick={() => setShowNewCaseModal(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
                  Create Case
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default KYBVerificationPortal;
