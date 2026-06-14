'use client';

import { logger } from "@/lib/logger";
import React, { useState, useEffect, useCallback } from 'react';
import { lakehouseAPI, useLakehouseData } from '@/lib/api';
import {
  Copy,
  Search,
  Filter,
  CheckCircle,
  Building2,
  Calendar,
  User,
  ChevronRight,
  FileText,
  Users,
  Shield,
  Globe,
  AlertCircle,
  X,
} from 'lucide-react';

interface OrganizationTemplate {
  id: string;
  organizationName: string;
  stakeholderType: string;
  country: string;
  registrationNumber: string;
  approvedAt: string;
  approvedBy: string;
  riskScore: number;
  hasKeyPersonnel: boolean;
  hasDocuments: boolean;
  documentCount: number;
  personnelCount: number;
  tags: string[];
}

interface CloneRequest {
  templateId: string;
  newOrganizationName: string;
  newRegistrationNumber: string;
  newCountry: string;
  copyKeyPersonnel: boolean;
  copyDocumentRequirements: boolean;
  copyComplianceSettings: boolean;
}

const API_BASE = process.env.NEXT_PUBLIC_ONBOARDING_API || 'http://localhost:8082';

const defaultTemplates: OrganizationTemplate[] = [
  {
    id: 'tmpl-001',
    organizationName: 'First Bank Nigeria',
    stakeholderType: 'BANK',
    country: 'Nigeria',
    registrationNumber: 'RC12345',
    approvedAt: '2024-11-15T10:00:00Z',
    approvedBy: 'John Approver',
    riskScore: 25,
    hasKeyPersonnel: true,
    hasDocuments: true,
    documentCount: 12,
    personnelCount: 5,
    tags: ['tier-1', 'domestic', 'retail'],
  },
  {
    id: 'tmpl-002',
    organizationName: 'Mobile Money Ltd',
    stakeholderType: 'MOBILE_MONEY_OPERATOR',
    country: 'Kenya',
    registrationNumber: 'KE-MMO-2024',
    approvedAt: '2024-10-20T14:00:00Z',
    approvedBy: 'Jane Manager',
    riskScore: 35,
    hasKeyPersonnel: true,
    hasDocuments: true,
    documentCount: 8,
    personnelCount: 3,
    tags: ['mobile', 'east-africa'],
  },
  {
    id: 'tmpl-003',
    organizationName: 'FinTech Solutions',
    stakeholderType: 'FINTECH',
    country: 'Ghana',
    registrationNumber: 'GH-FT-001',
    approvedAt: '2024-09-10T09:00:00Z',
    approvedBy: 'Mike Compliance',
    riskScore: 45,
    hasKeyPersonnel: true,
    hasDocuments: true,
    documentCount: 10,
    personnelCount: 4,
    tags: ['fintech', 'west-africa', 'payments'],
  },
  {
    id: 'tmpl-004',
    organizationName: 'Microfinance Bank',
    stakeholderType: 'MICROFINANCE_INSTITUTION',
    country: 'Nigeria',
    registrationNumber: 'RC67890',
    approvedAt: '2024-08-05T11:00:00Z',
    approvedBy: 'Sarah Director',
    riskScore: 30,
    hasKeyPersonnel: true,
    hasDocuments: true,
    documentCount: 9,
    personnelCount: 4,
    tags: ['microfinance', 'domestic', 'rural'],
  },
  {
    id: 'tmpl-005',
    organizationName: 'Payment Gateway Inc',
    stakeholderType: 'PAYMENT_SERVICE_PROVIDER',
    country: 'South Africa',
    registrationNumber: 'ZA-PSP-2024',
    approvedAt: '2024-07-22T16:00:00Z',
    approvedBy: 'Peter Admin',
    riskScore: 40,
    hasKeyPersonnel: true,
    hasDocuments: true,
    documentCount: 11,
    personnelCount: 6,
    tags: ['psp', 'southern-africa', 'cross-border'],
  },
];

export function TemplateCloning() {
  const tmplFetcher = useCallback(() =>
    lakehouseAPI.fetch<{ templates: OrganizationTemplate[] }>('/api/v1/onboarding/templates')
      .then(d => d.templates)
      .catch((err: unknown) => { logger.error("API fallback:", err); return []; }), []);
  const { data: apiTemplates } = useLakehouseData(tmplFetcher, 30000);
  const [templates, setTemplates] = useState<OrganizationTemplate[]>(defaultTemplates);
  useEffect(() => { if (apiTemplates) setTemplates(apiTemplates); }, [apiTemplates]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [selectedTemplate, setSelectedTemplate] = useState<OrganizationTemplate | null>(null);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [cloneRequest, setCloneRequest] = useState<CloneRequest>({
    templateId: '',
    newOrganizationName: '',
    newRegistrationNumber: '',
    newCountry: '',
    copyKeyPersonnel: true,
    copyDocumentRequirements: true,
    copyComplianceSettings: true,
  });
  const [isCloning, setIsCloning] = useState(false);
  const [cloneSuccess, setCloneSuccess] = useState(false);

  const stakeholderTypes = [
    'ALL',
    'BANK',
    'MOBILE_MONEY_OPERATOR',
    'FINTECH',
    'MICROFINANCE_INSTITUTION',
    'PAYMENT_SERVICE_PROVIDER',
  ];

  const filteredTemplates = templates.filter(template => {
    const matchesSearch = template.organizationName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.registrationNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.country.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = selectedType === 'ALL' || template.stakeholderType === selectedType;
    return matchesSearch && matchesType;
  });

  const handleClone = (template: OrganizationTemplate) => {
    setSelectedTemplate(template);
    setCloneRequest({
      templateId: template.id,
      newOrganizationName: '',
      newRegistrationNumber: '',
      newCountry: template.country,
      copyKeyPersonnel: true,
      copyDocumentRequirements: true,
      copyComplianceSettings: true,
    });
    setShowCloneModal(true);
  };

  const submitClone = async () => {
    if (!cloneRequest.newOrganizationName || !cloneRequest.newRegistrationNumber) {
      return;
    }

    setIsCloning(true);
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    setIsCloning(false);
    setCloneSuccess(true);
    
    setTimeout(() => {
      setShowCloneModal(false);
      setCloneSuccess(false);
      setSelectedTemplate(null);
    }, 2000);
  };

  const getRiskColor = (score: number) => {
    if (score <= 30) return 'text-green-600 bg-green-100';
    if (score <= 50) return 'text-yellow-600 bg-yellow-100';
    return 'text-red-600 bg-red-100';
  };

  const getStakeholderIcon = (type: string) => {
    switch (type) {
      case 'BANK':
        return <Building2 className="h-5 w-5 text-blue-500" />;
      case 'MOBILE_MONEY_OPERATOR':
        return <Globe className="h-5 w-5 text-green-500" />;
      case 'FINTECH':
        return <Shield className="h-5 w-5 text-purple-500" />;
      case 'MICROFINANCE_INSTITUTION':
        return <Users className="h-5 w-5 text-orange-500" />;
      case 'PAYMENT_SERVICE_PROVIDER':
        return <FileText className="h-5 w-5 text-indigo-500" />;
      default:
        return <Building2 className="h-5 w-5 text-gray-500" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Template Cloning</h2>
        <p className="text-sm text-gray-500 mt-1">
          Clone approved organization profiles to quickly onboard similar entities
        </p>
      </div>

      {/* Search and Filter */}
      <div className="flex items-center gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by organization name, registration number, or country..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-5 w-5 text-gray-400" />
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {stakeholderTypes.map(type => (
              <option key={type} value={type}>
                {type === 'ALL' ? 'All Types' : type.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Templates Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredTemplates.map((template) => (
          <div
            key={template.id}
            className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                {getStakeholderIcon(template.stakeholderType)}
                <div>
                  <h3 className="font-semibold text-gray-900">{template.organizationName}</h3>
                  <p className="text-sm text-gray-500">{template.stakeholderType.replace(/_/g, ' ')}</p>
                </div>
              </div>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${getRiskColor(template.riskScore)}`}>
                Risk: {template.riskScore}
              </span>
            </div>

            <div className="space-y-2 mb-4">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Globe className="h-4 w-4" />
                <span>{template.country}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <FileText className="h-4 w-4" />
                <span>{template.registrationNumber}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Calendar className="h-4 w-4" />
                <span>Approved: {new Date(template.approvedAt).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <User className="h-4 w-4" />
                <span>By: {template.approvedBy}</span>
              </div>
            </div>

            <div className="flex items-center gap-4 mb-4 text-sm">
              <div className="flex items-center gap-1">
                <Users className="h-4 w-4 text-gray-400" />
                <span>{template.personnelCount} personnel</span>
              </div>
              <div className="flex items-center gap-1">
                <FileText className="h-4 w-4 text-gray-400" />
                <span>{template.documentCount} docs</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-1 mb-4">
              {template.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs"
                >
                  {tag}
                </span>
              ))}
            </div>

            <button
              onClick={() => handleClone(template)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
            >
              <Copy className="h-4 w-4" />
              Clone Template
            </button>
          </div>
        ))}
      </div>

      {filteredTemplates.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <Copy className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-500">No templates found matching your criteria</p>
        </div>
      )}

      {/* Clone Modal */}
      {showCloneModal && selectedTemplate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Clone Organization Template</h3>
              <button
                onClick={() => setShowCloneModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {cloneSuccess ? (
                <div className="text-center py-8">
                  <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
                  <h4 className="text-lg font-semibold text-gray-900 mb-2">Clone Successful!</h4>
                  <p className="text-gray-500">
                    New application created from {selectedTemplate.organizationName} template
                  </p>
                </div>
              ) : (
                <>
                  <div className="bg-gray-50 rounded-lg p-4 mb-4">
                    <p className="text-sm text-gray-600">
                      Cloning from: <span className="font-semibold">{selectedTemplate.organizationName}</span>
                    </p>
                    <p className="text-sm text-gray-500">
                      {selectedTemplate.stakeholderType.replace(/_/g, ' ')} • {selectedTemplate.country}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      New Organization Name *
                    </label>
                    <input
                      type="text"
                      value={cloneRequest.newOrganizationName}
                      onChange={(e) => setCloneRequest({ ...cloneRequest, newOrganizationName: e.target.value })}
                      placeholder="Enter organization name"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      New Registration Number *
                    </label>
                    <input
                      type="text"
                      value={cloneRequest.newRegistrationNumber}
                      onChange={(e) => setCloneRequest({ ...cloneRequest, newRegistrationNumber: e.target.value })}
                      placeholder="Enter registration number"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Country
                    </label>
                    <select
                      value={cloneRequest.newCountry}
                      onChange={(e) => setCloneRequest({ ...cloneRequest, newCountry: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="Nigeria">Nigeria</option>
                      <option value="Kenya">Kenya</option>
                      <option value="Ghana">Ghana</option>
                      <option value="South Africa">South Africa</option>
                      <option value="Tanzania">Tanzania</option>
                      <option value="Uganda">Uganda</option>
                      <option value="Rwanda">Rwanda</option>
                      <option value="Ethiopia">Ethiopia</option>
                    </select>
                  </div>

                  <div className="space-y-3 pt-4 border-t border-gray-200">
                    <p className="text-sm font-medium text-gray-700">Clone Options</p>
                    
                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={cloneRequest.copyKeyPersonnel}
                        onChange={(e) => setCloneRequest({ ...cloneRequest, copyKeyPersonnel: e.target.checked })}
                        className="h-4 w-4 text-primary-600 rounded focus:ring-primary-500"
                      />
                      <span className="text-sm text-gray-600">
                        Copy key personnel structure ({selectedTemplate.personnelCount} roles)
                      </span>
                    </label>

                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={cloneRequest.copyDocumentRequirements}
                        onChange={(e) => setCloneRequest({ ...cloneRequest, copyDocumentRequirements: e.target.checked })}
                        className="h-4 w-4 text-primary-600 rounded focus:ring-primary-500"
                      />
                      <span className="text-sm text-gray-600">
                        Copy document requirements ({selectedTemplate.documentCount} documents)
                      </span>
                    </label>

                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={cloneRequest.copyComplianceSettings}
                        onChange={(e) => setCloneRequest({ ...cloneRequest, copyComplianceSettings: e.target.checked })}
                        className="h-4 w-4 text-primary-600 rounded focus:ring-primary-500"
                      />
                      <span className="text-sm text-gray-600">
                        Copy compliance settings and risk parameters
                      </span>
                    </label>
                  </div>

                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-2">
                    <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-yellow-700">
                      The cloned application will be created as a new draft. You will need to fill in 
                      organization-specific details and submit for review.
                    </p>
                  </div>
                </>
              )}
            </div>

            {!cloneSuccess && (
              <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200">
                <button
                  onClick={() => setShowCloneModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={submitClone}
                  disabled={isCloning || !cloneRequest.newOrganizationName || !cloneRequest.newRegistrationNumber}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isCloning ? (
                    <>
                      <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Cloning...
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      Create Clone
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default TemplateCloning;
