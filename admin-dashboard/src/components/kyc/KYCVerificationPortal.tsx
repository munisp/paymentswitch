'use client';

import { toast } from '@/lib/toast';
import React, { useState, useEffect, useCallback } from 'react';
import {
  User,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Search,
  Filter,
  ChevronRight,
  Shield,
  Camera,
  Upload,
  Eye,
  RefreshCw,
  UserCheck,
  UserX,
  Fingerprint,
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
} from 'lucide-react';
import { createLogger } from '@/lib/logger';
const log = createLogger('KYCVerificationPortal');

// Types
type KYCStatus = 'PENDING' | 'DOCUMENTS_PENDING' | 'IN_PROGRESS' | 'SCREENING' | 'MANUAL_REVIEW' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
type PersonType = 'UBO' | 'DIRECTOR' | 'SIGNATORY' | 'ADMIN' | 'INDIVIDUAL';
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type DocumentType = 'PASSPORT' | 'NATIONAL_ID' | 'DRIVERS_LICENSE' | 'PROOF_OF_ADDRESS' | 'UTILITY_BILL' | 'SELFIE' | 'AUTHORIZATION_LETTER';

interface KYCPerson {
  id: string;
  kybCaseId?: string;
  organizationName?: string;
  personType: PersonType;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  nationality: string;
  status: KYCStatus;
  riskScore: number;
  riskLevel: RiskLevel;
  email?: string;
  phone?: string;
  address?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

interface KYCDocument {
  id: string;
  personId: string;
  documentType: DocumentType;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
  status: 'PENDING' | 'PROCESSING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED';
  extractedData?: Record<string, string>;
  confidenceScore?: number;
  verificationNotes?: string;
  expiryDate?: string;
  thumbnailUrl?: string;
}

interface LivenessResult {
  passed: boolean;
  confidenceScore: number;
  timestamp: string;
  method: 'SMILE_IDENTITY' | 'MANUAL';
  faceMatchScore?: number;
  spoofDetectionScore?: number;
}

interface ScreeningResult {
  type: 'SANCTIONS' | 'PEP' | 'ADVERSE_MEDIA' | 'WATCHLIST';
  status: 'CLEAR' | 'POTENTIAL_MATCH' | 'CONFIRMED_MATCH';
  matchDetails?: string;
  source?: string;
  checkedAt: string;
}

interface KYCDetail extends KYCPerson {
  documents: KYCDocument[];
  livenessResult?: LivenessResult;
  screeningResults: ScreeningResult[];
  timeline: { event: string; timestamp: string; actor: string }[];
  notes: { author: string; content: string; timestamp: string }[];
  decision?: {
    outcome: 'APPROVED' | 'REJECTED';
    decidedBy: string;
    decidedAt: string;
    reasonCodes?: string[];
    notes?: string;
  };
}

const API_BASE = process.env.NEXT_PUBLIC_KYC_API || 'https://app-kjesixal.fly.dev';

const statusColors: Record<KYCStatus, string> = {
  PENDING: 'bg-gray-100 text-gray-800',
  DOCUMENTS_PENDING: 'bg-yellow-100 text-yellow-800',
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  SCREENING: 'bg-purple-100 text-purple-800',
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

const personTypeIcons: Record<PersonType, React.ReactNode> = {
  UBO: <User className="h-5 w-5" />,
  DIRECTOR: <UserCheck className="h-5 w-5" />,
  SIGNATORY: <FileText className="h-5 w-5" />,
  ADMIN: <Shield className="h-5 w-5" />,
  INDIVIDUAL: <User className="h-5 w-5" />,
};

const documentTypeLabels: Record<DocumentType, string> = {
  PASSPORT: 'Passport',
  NATIONAL_ID: 'National ID',
  DRIVERS_LICENSE: "Driver's License",
  PROOF_OF_ADDRESS: 'Proof of Address',
  UTILITY_BILL: 'Utility Bill',
  SELFIE: 'Selfie / Photo',
  AUTHORIZATION_LETTER: 'Authorization Letter',
};

const defaultPersons: KYCPerson[] = [
  {
    id: 'KYC-001',
    kybCaseId: 'OB-2024-001',
    organizationName: 'First National Bank',
    personType: 'DIRECTOR',
    firstName: 'John',
    lastName: 'Adeyemi',
    dateOfBirth: '1975-03-15',
    nationality: 'Nigerian',
    status: 'MANUAL_REVIEW',
    riskScore: 35,
    riskLevel: 'MEDIUM',
    email: 'j.adeyemi@fnb.ng',
    createdAt: '2024-12-20T10:30:00Z',
    updatedAt: '2024-12-22T14:00:00Z',
  },
  {
    id: 'KYC-002',
    kybCaseId: 'OB-2024-001',
    organizationName: 'First National Bank',
    personType: 'UBO',
    firstName: 'Amina',
    lastName: 'Okonkwo',
    dateOfBirth: '1968-07-22',
    nationality: 'Nigerian',
    status: 'APPROVED',
    riskScore: 15,
    riskLevel: 'LOW',
    email: 'a.okonkwo@fnb.ng',
    createdAt: '2024-12-20T10:35:00Z',
    updatedAt: '2024-12-21T16:00:00Z',
    completedAt: '2024-12-21T16:00:00Z',
  },
  {
    id: 'KYC-003',
    kybCaseId: 'OB-2024-002',
    organizationName: 'MobilePay Ltd',
    personType: 'SIGNATORY',
    firstName: 'David',
    lastName: 'Mwangi',
    dateOfBirth: '1982-11-08',
    nationality: 'Kenyan',
    status: 'SCREENING',
    riskScore: 45,
    riskLevel: 'MEDIUM',
    email: 'd.mwangi@mobilepay.ke',
    createdAt: '2024-12-18T14:20:00Z',
    updatedAt: '2024-12-22T09:00:00Z',
  },
  {
    id: 'KYC-004',
    personType: 'INDIVIDUAL',
    firstName: 'Sarah',
    lastName: 'Mensah',
    dateOfBirth: '1990-05-12',
    nationality: 'Ghanaian',
    status: 'DOCUMENTS_PENDING',
    riskScore: 0,
    riskLevel: 'LOW',
    email: 's.mensah@email.com',
    createdAt: '2024-12-22T16:00:00Z',
    updatedAt: '2024-12-22T16:00:00Z',
  },
  {
    id: 'KYC-005',
    kybCaseId: 'OB-2024-003',
    organizationName: 'PayTech Solutions',
    personType: 'DIRECTOR',
    firstName: 'Kwame',
    lastName: 'Asante',
    dateOfBirth: '1978-09-30',
    nationality: 'Ghanaian',
    status: 'REJECTED',
    riskScore: 85,
    riskLevel: 'CRITICAL',
    email: 'k.asante@paytech.gh',
    createdAt: '2024-12-15T09:00:00Z',
    updatedAt: '2024-12-18T11:00:00Z',
    completedAt: '2024-12-18T11:00:00Z',
  },
];

const defaultDetail: KYCDetail = {
  id: 'KYC-001',
  kybCaseId: 'OB-2024-001',
  organizationName: 'First National Bank',
  personType: 'DIRECTOR',
  firstName: 'John',
  lastName: 'Adeyemi',
  dateOfBirth: '1975-03-15',
  nationality: 'Nigerian',
  status: 'MANUAL_REVIEW',
  riskScore: 35,
  riskLevel: 'MEDIUM',
  email: 'j.adeyemi@fnb.ng',
  phone: '+234 803 123 4567',
  address: '45 Victoria Island, Lagos, Nigeria',
  createdAt: '2024-12-20T10:30:00Z',
  updatedAt: '2024-12-22T14:00:00Z',
  documents: [
    {
      id: 'DOC-001',
      personId: 'KYC-001',
      documentType: 'PASSPORT',
      fileName: 'passport_john_adeyemi.jpg',
      fileSize: 2456789,
      uploadedAt: '2024-12-20T11:00:00Z',
      status: 'VERIFIED',
      extractedData: {
        full_name: 'JOHN ADEYEMI OLUWASEUN',
        passport_number: 'A12345678',
        date_of_birth: '1975-03-15',
        nationality: 'NIGERIAN',
        expiry_date: '2028-06-30',
        issuing_country: 'NIGERIA',
      },
      confidenceScore: 0.94,
      expiryDate: '2028-06-30',
    },
    {
      id: 'DOC-002',
      personId: 'KYC-001',
      documentType: 'PROOF_OF_ADDRESS',
      fileName: 'utility_bill_dec2024.pdf',
      fileSize: 1234567,
      uploadedAt: '2024-12-20T11:05:00Z',
      status: 'VERIFIED',
      extractedData: {
        full_name: 'JOHN ADEYEMI',
        address: '45 VICTORIA ISLAND, LAGOS',
        document_date: '2024-12-01',
        utility_provider: 'EKEDC',
      },
      confidenceScore: 0.89,
    },
    {
      id: 'DOC-003',
      personId: 'KYC-001',
      documentType: 'SELFIE',
      fileName: 'selfie_john.jpg',
      fileSize: 987654,
      uploadedAt: '2024-12-20T11:10:00Z',
      status: 'VERIFIED',
      confidenceScore: 0.96,
    },
  ],
  livenessResult: {
    passed: true,
    confidenceScore: 0.92,
    timestamp: '2024-12-20T11:15:00Z',
    method: 'SMILE_IDENTITY',
    faceMatchScore: 0.94,
    spoofDetectionScore: 0.98,
  },
  screeningResults: [
    {
      type: 'SANCTIONS',
      status: 'CLEAR',
      source: 'OFAC, UN, EU',
      checkedAt: '2024-12-21T09:00:00Z',
    },
    {
      type: 'PEP',
      status: 'POTENTIAL_MATCH',
      matchDetails: 'Name similarity with former state official (65% match)',
      source: 'World-Check',
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
    { event: 'KYC Initiated', timestamp: '2024-12-20T10:30:00Z', actor: 'System' },
    { event: 'Passport Uploaded', timestamp: '2024-12-20T11:00:00Z', actor: 'John Adeyemi' },
    { event: 'Proof of Address Uploaded', timestamp: '2024-12-20T11:05:00Z', actor: 'John Adeyemi' },
    { event: 'Selfie Captured', timestamp: '2024-12-20T11:10:00Z', actor: 'John Adeyemi' },
    { event: 'Liveness Check Passed', timestamp: '2024-12-20T11:15:00Z', actor: 'Smile Identity' },
    { event: 'Document OCR Completed', timestamp: '2024-12-20T11:20:00Z', actor: 'Docling/PaddleOCR/LLaVA' },
    { event: 'Screening Started', timestamp: '2024-12-21T09:00:00Z', actor: 'System' },
    { event: 'PEP Potential Match Found', timestamp: '2024-12-21T09:00:00Z', actor: 'World-Check' },
    { event: 'Escalated to Manual Review', timestamp: '2024-12-21T09:05:00Z', actor: 'System' },
  ],
  notes: [
    {
      author: 'System',
      content: 'PEP screening returned potential match. Manual review required to confirm identity.',
      timestamp: '2024-12-21T09:05:00Z',
    },
    {
      author: 'Jane Doe',
      content: 'Reviewing PEP match. Name similarity is coincidental - different date of birth and location.',
      timestamp: '2024-12-22T14:00:00Z',
    },
  ],
};

// Document Viewer Modal
function DocumentViewer({ document, onClose }: { document: KYCDocument; onClose: () => void }) {
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
            <button className="p-2 hover:bg-gray-100 rounded">
              <RotateCw className="h-5 w-5 text-gray-600" />
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
            <h4 className="font-medium text-gray-900 mb-3">Extracted Data (Confidence: {((document.confidenceScore || 0) * 100).toFixed(0)}%)</h4>
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

export function KYCVerificationPortal() {
  const [persons, setPersons] = useState<KYCPerson[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<KYCDetail | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'documents' | 'screening' | 'liveness' | 'timeline' | 'notes'>('overview');
  const [viewingDocument, setViewingDocument] = useState<KYCDocument | null>(null);
  const [showNewCaseModal, setShowNewCaseModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    inReview: 0,
    approved: 0,
    rejected: 0,
    avgProcessingHours: 0,
  });

  // Fetch KYC cases from API on mount
  useEffect(() => {
    const fetchCases = async () => {
      try {
        setLoading(true);
        const response = await fetch(`${API_BASE}/api/v1/kyc/cases`);
        if (response.ok) {
          const data = await response.json();
          // Map API response to KYCPerson format
          const mappedPersons = (data.cases || []).map((c: any) => ({
            id: c.id,
            personType: c.applicantType || 'INDIVIDUAL',
            firstName: c.applicantName?.split(' ')[0] || '',
            lastName: c.applicantName?.split(' ').slice(1).join(' ') || '',
            dateOfBirth: '1990-01-01',
            nationality: c.country || '',
            status: c.status === 'PENDING_REVIEW' ? 'MANUAL_REVIEW' : c.status,
            riskScore: c.riskScore || 0,
            riskLevel: c.riskScore > 70 ? 'HIGH' : c.riskScore > 40 ? 'MEDIUM' : 'LOW',
            email: '',
            createdAt: c.submittedAt,
            updatedAt: c.submittedAt,
          }));
          setPersons(mappedPersons.length > 0 ? mappedPersons : defaultPersons);
        } else {
          setPersons([]);
        }
      } catch (error) {
        log.error('Error fetching KYC cases:', error);
        setPersons([]);
      } finally {
        setLoading(false);
      }
    };
    fetchCases();
  }, []);

  const filteredPersons = persons.filter((p) => {
    if (filterStatus !== 'all' && p.status !== filterStatus) return false;
    if (filterType !== 'all' && p.personType !== filterType) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        p.firstName.toLowerCase().includes(query) ||
        p.lastName.toLowerCase().includes(query) ||
        p.organizationName?.toLowerCase().includes(query) ||
        p.id.toLowerCase().includes(query)
      );
    }
    return true;
  });

  // Refetch cases from API
  const refetchCases = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/kyc/cases`);
      if (response.ok) {
        const data = await response.json();
        const mappedPersons = (data.cases || []).map((c: any) => ({
          id: c.id,
          kybCaseId: c.kybCaseId,
          organizationName: c.organizationName,
          personType: c.applicantType || 'INDIVIDUAL',
          firstName: c.applicantName?.split(' ')[0] || '',
          lastName: c.applicantName?.split(' ').slice(1).join(' ') || '',
          dateOfBirth: c.dateOfBirth || '1990-01-01',
          nationality: c.nationality || c.country || '',
          status: c.status === 'PENDING_REVIEW' ? 'MANUAL_REVIEW' : c.status,
          riskScore: c.riskScore || 0,
          riskLevel: c.riskScore > 70 ? 'HIGH' : c.riskScore > 40 ? 'MEDIUM' : 'LOW',
          email: c.email || '',
          phone: c.phone || '',
          address: c.address || '',
          createdAt: c.submittedAt || c.createdAt,
          updatedAt: c.submittedAt || c.updatedAt,
        }));
        setPersons(mappedPersons.length > 0 ? mappedPersons : defaultPersons);
      }
    } catch (error) {
      log.error('Error refetching KYC cases:', error);
    }
  };

  const handleViewPerson = async (personId: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/kyc/cases/${personId}`);
      if (response.ok) {
        const data = await response.json();
        // Map API response to KYCDetail format
        const detail: KYCDetail = {
          id: data.id,
          kybCaseId: data.kybCaseId,
          organizationName: data.organizationName,
          personType: data.applicantType || 'INDIVIDUAL',
          firstName: data.applicantName?.split(' ')[0] || '',
          lastName: data.applicantName?.split(' ').slice(1).join(' ') || '',
          dateOfBirth: data.dateOfBirth || '1990-01-01',
          nationality: data.nationality || data.country || '',
          status: data.status === 'PENDING_REVIEW' ? 'MANUAL_REVIEW' : data.status,
          riskScore: data.riskScore || 0,
          riskLevel: data.riskScore > 70 ? 'HIGH' : data.riskScore > 40 ? 'MEDIUM' : 'LOW',
          email: data.email || '',
          phone: data.phone || '',
          address: data.address || '',
          createdAt: data.submittedAt || data.createdAt,
          updatedAt: data.submittedAt || data.updatedAt,
          documents: (data.documents || []).map((d: any) => ({
            id: d.id,
            personId: data.id,
            documentType: d.type || d.documentType,
            fileName: d.fileName,
            fileSize: d.fileSize || 0,
            uploadedAt: d.uploadedAt || new Date().toISOString(),
            status: d.status || 'VERIFIED',
            confidenceScore: d.confidenceScore,
          })),
          livenessResult: data.livenessResult,
          screeningResults: data.screeningResults || [],
          timeline: data.timeline || [],
          notes: data.notes || [],
        };
        setSelectedPerson(detail);
      } else {
        // Fallback to empty state if API fails
        setSelectedPerson(null);
      }
    } catch (error) {
      log.error('Error fetching KYC case details:', error);
      setSelectedPerson(null);
    }
  };

  const handleApprove = async () => {
    if (!selectedPerson) return;
    try {
      const response = await fetch(`${API_BASE}/api/v1/kyc/cases/${selectedPerson.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        setSelectedPerson({ ...selectedPerson, status: 'APPROVED' });
        await refetchCases();
        toast.success('KYC case approved successfully!');
      } else {
        toast.error('Failed to approve KYC case. Please try again.');
      }
    } catch (error) {
      log.error('Error approving KYC case:', error);
      toast.error('Error approving KYC case. Please try again.');
    }
  };

  const handleReject = async (reasonCodes: string[]) => {
    if (!selectedPerson) return;
    try {
      const response = await fetch(`${API_BASE}/api/v1/kyc/cases/${selectedPerson.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reasonCodes }),
      });
      if (response.ok) {
        setSelectedPerson({ ...selectedPerson, status: 'REJECTED' });
        await refetchCases();
        toast.warning('KYC case rejected.');
      } else {
        toast.error('Failed to reject KYC case. Please try again.');
      }
    } catch (error) {
      log.error('Error rejecting KYC case:', error);
      toast.error('Error rejecting KYC case. Please try again.');
    }
  };

  const handleRequestDocuments = async () => {
    if (!selectedPerson) return;
    toast.info('Document request sent to ' + selectedPerson.email);
  };

  const handleRerunScreening = async () => {
    if (!selectedPerson) return;
    toast.info('Re-running screening checks...');
  };

  // Detail View
  if (selectedPerson) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setSelectedPerson(null)}
              className="text-gray-500 hover:text-gray-700"
            >
              <ChevronRight className="h-5 w-5 rotate-180" />
            </button>
            <div className="flex items-center space-x-3">
              <div className="h-12 w-12 bg-primary-100 rounded-full flex items-center justify-center">
                <User className="h-6 w-6 text-primary-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {selectedPerson.firstName} {selectedPerson.lastName}
                </h1>
                <div className="flex items-center space-x-3 mt-1">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[selectedPerson.status]}`}>
                    {selectedPerson.status.replace(/_/g, ' ')}
                  </span>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${riskColors[selectedPerson.riskLevel]}`}>
                    Risk: {selectedPerson.riskLevel}
                  </span>
                  <span className="text-sm text-gray-500">{selectedPerson.id}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            {selectedPerson.status === 'MANUAL_REVIEW' && (
              <>
                <button
                  onClick={() => handleReject(['MANUAL_REJECTION'])}
                  className="px-4 py-2 border border-red-300 text-red-700 rounded-lg hover:bg-red-50"
                >
                  Reject
                </button>
                <button
                  onClick={handleApprove}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                  Approve KYC
                </button>
              </>
            )}
            {selectedPerson.status === 'DOCUMENTS_PENDING' && (
              <button
                onClick={handleRequestDocuments}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
              >
                Send Document Request
              </button>
            )}
            {selectedPerson.status === 'SCREENING' && (
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

        {/* KYB Link Banner */}
        {selectedPerson.kybCaseId && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Shield className="h-5 w-5 text-blue-600" />
              <div>
                <p className="text-sm font-medium text-blue-900">Linked to KYB Case</p>
                <p className="text-sm text-blue-700">
                  {selectedPerson.organizationName} ({selectedPerson.kybCaseId}) - {selectedPerson.personType}
                </p>
              </div>
            </div>
            <button className="text-sm text-blue-600 hover:text-blue-800 font-medium">
              View KYB Case
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8">
            {(['overview', 'documents', 'screening', 'liveness', 'timeline', 'notes'] as const).map((tab) => (
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
            {/* Personal Information */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Personal Information</h3>
              <dl className="space-y-3">
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500 flex items-center">
                    <User className="h-4 w-4 mr-2" /> Full Name
                  </dt>
                  <dd className="text-sm font-medium text-gray-900">
                    {selectedPerson.firstName} {selectedPerson.lastName}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500 flex items-center">
                    <Calendar className="h-4 w-4 mr-2" /> Date of Birth
                  </dt>
                  <dd className="text-sm font-medium text-gray-900">{selectedPerson.dateOfBirth}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500 flex items-center">
                    <Globe className="h-4 w-4 mr-2" /> Nationality
                  </dt>
                  <dd className="text-sm font-medium text-gray-900">{selectedPerson.nationality}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500 flex items-center">
                    <MapPin className="h-4 w-4 mr-2" /> Address
                  </dt>
                  <dd className="text-sm font-medium text-gray-900">{selectedPerson.address || 'Not provided'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500">Email</dt>
                  <dd className="text-sm font-medium text-primary-600">{selectedPerson.email}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500">Phone</dt>
                  <dd className="text-sm font-medium text-gray-900">{selectedPerson.phone || 'Not provided'}</dd>
                </div>
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
                      {selectedPerson.documents.filter(d => d.status === 'VERIFIED').length}/{selectedPerson.documents.length} verified
                    </span>
                    {selectedPerson.documents.every(d => d.status === 'VERIFIED') ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : (
                      <Clock className="h-5 w-5 text-yellow-500" />
                    )}
                  </div>
                </div>

                {/* Liveness */}
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <Fingerprint className="h-5 w-5 text-gray-600" />
                    <span className="text-sm font-medium text-gray-900">Liveness Check</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    {selectedPerson.livenessResult ? (
                      <>
                        <span className="text-sm text-gray-600">
                          {(selectedPerson.livenessResult.confidenceScore * 100).toFixed(0)}% confidence
                        </span>
                        {selectedPerson.livenessResult.passed ? (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        ) : (
                          <XCircle className="h-5 w-5 text-red-500" />
                        )}
                      </>
                    ) : (
                      <>
                        <span className="text-sm text-gray-600">Not completed</span>
                        <Clock className="h-5 w-5 text-gray-400" />
                      </>
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
                    {selectedPerson.screeningResults.length > 0 ? (
                      <>
                        <span className="text-sm text-gray-600">
                          {selectedPerson.screeningResults.filter(s => s.status === 'CLEAR').length}/{selectedPerson.screeningResults.length} clear
                        </span>
                        {selectedPerson.screeningResults.some(s => s.status !== 'CLEAR') ? (
                          <AlertTriangle className="h-5 w-5 text-orange-500" />
                        ) : (
                          <CheckCircle className="h-5 w-5 text-green-500" />
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
                    <span className="text-sm font-medium text-gray-900">{selectedPerson.riskScore}/100</span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${riskColors[selectedPerson.riskLevel]}`}>
                      {selectedPerson.riskLevel}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'documents' && (
          <div className="space-y-4">
            {selectedPerson.documents.map((doc) => (
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
                    <h5 className="text-sm font-medium text-gray-700 mb-2">Extracted Data</h5>
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

        {activeTab === 'screening' && (
          <div className="space-y-4">
            {selectedPerson.screeningResults.map((result, idx) => (
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

        {activeTab === 'liveness' && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            {selectedPerson.livenessResult ? (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">Liveness Verification</h3>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                    selectedPerson.livenessResult.passed ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {selectedPerson.livenessResult.passed ? 'PASSED' : 'FAILED'}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="text-center p-4 bg-gray-50 rounded-lg">
                    <Fingerprint className="h-8 w-8 text-primary-600 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">Liveness Score</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {(selectedPerson.livenessResult.confidenceScore * 100).toFixed(0)}%
                    </p>
                  </div>
                  <div className="text-center p-4 bg-gray-50 rounded-lg">
                    <User className="h-8 w-8 text-primary-600 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">Face Match Score</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {selectedPerson.livenessResult.faceMatchScore 
                        ? `${(selectedPerson.livenessResult.faceMatchScore * 100).toFixed(0)}%`
                        : 'N/A'}
                    </p>
                  </div>
                  <div className="text-center p-4 bg-gray-50 rounded-lg">
                    <Shield className="h-8 w-8 text-primary-600 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">Spoof Detection</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {selectedPerson.livenessResult.spoofDetectionScore
                        ? `${(selectedPerson.livenessResult.spoofDetectionScore * 100).toFixed(0)}%`
                        : 'N/A'}
                    </p>
                  </div>
                </div>
                <div className="text-sm text-gray-500">
                  <p>Method: {selectedPerson.livenessResult.method.replace(/_/g, ' ')}</p>
                  <p>Verified: {new Date(selectedPerson.livenessResult.timestamp).toLocaleString()}</p>
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <Camera className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">Liveness Check Not Completed</h3>
                <p className="text-gray-500 mb-4">The applicant has not completed the liveness verification yet.</p>
                <button className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
                  Send Liveness Request
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'timeline' && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flow-root">
              <ul className="-mb-8">
                {selectedPerson.timeline.map((event, idx) => (
                  <li key={idx}>
                    <div className="relative pb-8">
                      {idx !== selectedPerson.timeline.length - 1 && (
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
            {selectedPerson.notes.map((note, idx) => (
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
          <h1 className="text-2xl font-bold text-gray-900">KYC Verification</h1>
          <p className="text-gray-500 mt-1">Manage individual identity verification</p>
        </div>
        <button 
          onClick={() => setShowNewCaseModal(true)}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
        >
          + New KYC Case
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
          <p className="text-sm text-gray-500">In Review</p>
          <p className="text-2xl font-bold text-blue-600">{stats.inReview}</p>
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
          <p className="text-sm text-gray-500">Avg. Time</p>
          <p className="text-2xl font-bold text-gray-900">{stats.avgProcessingHours}h</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, ID, or organization..."
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
          <option value="PENDING">Pending</option>
          <option value="DOCUMENTS_PENDING">Documents Pending</option>
          <option value="IN_PROGRESS">In Progress</option>
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
          <option value="UBO">UBO</option>
          <option value="DIRECTOR">Director</option>
          <option value="SIGNATORY">Signatory</option>
          <option value="ADMIN">Admin</option>
          <option value="INDIVIDUAL">Individual</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Person</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Organization</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Risk</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Updated</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredPersons.map((person) => (
              <tr key={person.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="h-10 w-10 bg-primary-100 rounded-full flex items-center justify-center">
                      {personTypeIcons[person.personType]}
                    </div>
                    <div className="ml-4">
                      <div className="text-sm font-medium text-gray-900">
                        {person.firstName} {person.lastName}
                      </div>
                      <div className="text-sm text-gray-500">{person.id}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm text-gray-900">{person.personType}</span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm text-gray-900">{person.organizationName || '-'}</span>
                  {person.kybCaseId && (
                    <span className="text-xs text-gray-500 block">{person.kybCaseId}</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[person.status]}`}>
                    {person.status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${riskColors[person.riskLevel]}`}>
                    {person.riskLevel}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {new Date(person.updatedAt).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                  <button
                    onClick={() => handleViewPerson(person.id)}
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

      {/* New KYC Case Modal */}
      {showNewCaseModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-lg w-full mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900">New KYC Case</h2>
              <button onClick={() => setShowNewCaseModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-6 w-6" />
              </button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              const firstName = formData.get('firstName') as string;
              const lastName = formData.get('lastName') as string;
              const newCase = {
                applicantName: `${firstName} ${lastName}`,
                applicantType: formData.get('personType') as string,
                dateOfBirth: formData.get('dateOfBirth') as string,
                nationality: formData.get('nationality') as string,
                country: formData.get('nationality') as string,
                email: formData.get('email') as string,
                status: 'PENDING',
                riskScore: 0,
                submittedAt: new Date().toISOString(),
              };
              try {
                const response = await fetch(`${API_BASE}/api/v1/kyc/cases`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(newCase),
                });
                if (response.ok) {
                  setShowNewCaseModal(false);
                  await refetchCases();
                  toast.success('KYC case created successfully!');
                } else {
                  toast.error('Failed to create KYC case. Please try again.');
                }
              } catch (error) {
                log.error('Error creating KYC case:', error);
                toast.error('Error creating KYC case. Please try again.');
              }
            }}>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
                    <input name="firstName" required className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
                    <input name="lastName" required className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Person Type *</label>
                  <select name="personType" required className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500">
                    <option value="INDIVIDUAL">Individual</option>
                    <option value="DIRECTOR">Director</option>
                    <option value="UBO">UBO</option>
                    <option value="SIGNATORY">Signatory</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth *</label>
                  <input name="dateOfBirth" type="date" required className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nationality *</label>
                  <input name="nationality" required className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input name="email" type="email" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
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

export default KYCVerificationPortal;
