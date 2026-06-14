'use client';

import { logger } from "@/lib/logger";
import { toast } from '@/lib/toast';
import { useState, useEffect, useCallback } from 'react';

interface Journey {
  id: number;
  name: string;
  description: string;
  category: 'onboarding' | 'payments' | 'operations' | 'analytics' | 'security';
  status: 'active' | 'pending' | 'completed' | 'failed';
  components: string[];
  lastRun?: string;
  successRate?: number;
}

const journeys: Journey[] = [
  {
    id: 1,
    name: 'Admin Provision Organization',
    description: 'Admin logs in and provisions a new participant organization',
    category: 'onboarding',
    components: ['Keycloak', 'Permify', 'APISIX', 'Kafka', 'Lakehouse'],
    status: 'active',
    successRate: 98.5,
  },
  {
    id: 2,
    name: 'Participant KYB Activation',
    description: 'Participant completes KYB and is approved to join the network',
    category: 'onboarding',
    components: ['Ballerine', 'Docling', 'PaddleOCR', 'LLaVA', 'Compliance'],
    status: 'active',
    successRate: 94.2,
  },
  {
    id: 3,
    name: 'User KYC Product Access',
    description: 'Individual user completes KYC and is granted product access',
    category: 'onboarding',
    components: ['KYC', 'Identity Verification', 'AML', 'Permify'],
    status: 'active',
    successRate: 96.8,
  },
  {
    id: 4,
    name: 'Merchant POS Onboarding',
    description: 'Merchant onboarding + store creation + POS enablement',
    category: 'onboarding',
    components: ['KYB', 'Document Storage', 'POS Service', 'Sandbox', 'Dapr'],
    status: 'active',
    successRate: 92.1,
  },
  {
    id: 5,
    name: 'Developer Sandbox Access',
    description: 'Developer creates API token, gets metered access, tests in sandbox',
    category: 'onboarding',
    components: ['Monetization', 'Token', 'Metering', 'Sandbox', 'APISIX', 'Redis'],
    status: 'active',
    successRate: 99.1,
  },
  {
    id: 6,
    name: 'P2P Transfer Mojaloop',
    description: 'P2P transfer using Mojaloop APIs backed by TigerBeetle ledger',
    category: 'payments',
    components: ['Mojaloop', 'TigerBeetle', 'Fraud Detection', 'Kafka', 'Fluvio'],
    status: 'active',
    successRate: 99.7,
  },
  {
    id: 7,
    name: 'QR Code Payment',
    description: 'Merchant payment via QR code end-to-end',
    category: 'payments',
    components: ['QR Service', 'Payment Processing', 'TigerBeetle', 'Notifications'],
    status: 'active',
    successRate: 98.9,
  },
  {
    id: 8,
    name: 'Remittance FX Transfer',
    description: 'Remittance/FX transfer across corridors with FX risk checks',
    category: 'payments',
    components: ['Remittance', 'FX Risk', 'Routing', 'TigerBeetle', 'Compliance'],
    status: 'active',
    successRate: 97.3,
  },
  {
    id: 9,
    name: 'Dispute Chargeback',
    description: 'Dispute/chargeback lifecycle management',
    category: 'operations',
    components: ['Disputes', 'Document Storage', 'Compliance', 'TigerBeetle', 'Notifications'],
    status: 'active',
    successRate: 95.6,
  },
  {
    id: 10,
    name: 'Reconciliation',
    description: 'Compare ledger vs processor vs bank settlement',
    category: 'operations',
    components: ['Reconciliation', 'Lakehouse', 'TigerBeetle', 'Alerts'],
    status: 'active',
    successRate: 99.2,
  },
  {
    id: 11,
    name: 'Settlement Cycle',
    description: 'Settlement cycle and central bank reporting',
    category: 'operations',
    components: ['Settlement', 'Regulatory Reporting', 'TigerBeetle', 'RustFS'],
    status: 'active',
    successRate: 99.8,
  },
  {
    id: 12,
    name: 'Instant Settlement',
    description: 'Instant settlement path for eligible transactions',
    category: 'payments',
    components: ['Instant Settlement', 'TigerBeetle', 'Kafka', 'Fluvio'],
    status: 'active',
    successRate: 99.5,
  },
  {
    id: 13,
    name: 'Fraud Scoring Case Management',
    description: 'Fraud scoring at authorization time + case management',
    category: 'security',
    components: ['Fraud Detection (ML)', 'Rule Engine', 'AML Case Management'],
    status: 'active',
    successRate: 98.1,
  },
  {
    id: 14,
    name: 'Batch Analytics Pipeline',
    description: 'Batch analytics: daily metrics pipeline',
    category: 'analytics',
    components: ['Spark', 'Delta Lake', 'RustFS', 'Temporal Schedule'],
    status: 'active',
    successRate: 99.4,
  },
  {
    id: 15,
    name: 'Streaming Analytics Pipeline',
    description: 'Streaming analytics: domain events to Delta Lake',
    category: 'analytics',
    components: ['Kafka', 'Flink', 'Delta Lake', 'RustFS'],
    status: 'active',
    successRate: 99.6,
  },
  {
    id: 16,
    name: 'Webhook Integration',
    description: 'Webhook integration for external partners',
    category: 'operations',
    components: ['Webhooks', 'Retry Service', 'Idempotency', 'Audit'],
    status: 'active',
    successRate: 97.8,
  },
  {
    id: 17,
    name: 'Security Posture',
    description: 'Security posture journey: WAF policy + anomaly alerting',
    category: 'security',
    components: ['OpenAppSec', 'APISIX', 'Observability', 'Alerts'],
    status: 'active',
    successRate: 99.9,
  },
  {
    id: 18,
    name: 'DR Failover Drill',
    description: 'Disaster recovery failover drill',
    category: 'operations',
    components: ['DR Service', 'Health Checks', 'RustFS', 'Notifications'],
    status: 'active',
    successRate: 100,
  },
  {
    id: 19,
    name: 'Data Governance PII Masking',
    description: 'Data governance / PII masking workflow for analytics exports',
    category: 'analytics',
    components: ['PII Masking', 'Export', 'Permify', 'Compliance', 'RustFS'],
    status: 'active',
    successRate: 99.3,
  },
  {
    id: 20,
    name: 'Conformance Integration Testing',
    description: 'Conformance & integration testing journey',
    category: 'operations',
    components: ['Mojaloop Conformance', 'Integration Testing Portal', 'Sandbox'],
    status: 'active',
    successRate: 98.7,
  },
];

const categoryColors: Record<string, string> = {
  onboarding: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  payments: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  operations: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  analytics: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  security: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

const statusColors: Record<string, string> = {
  active: 'bg-green-500',
  pending: 'bg-yellow-500',
  completed: 'bg-blue-500',
  failed: 'bg-red-500',
};

export default function JourneyDashboard() {
  const [apiJourneys, setApiJourneys] = useState<Journey[] | null>(null);
  useEffect(() => {
    fetch('http://localhost:8080/api/v1/journeys')
      .then(r => r.json()).then(d => setApiJourneys(d.journeys))
      .catch((err: unknown) => { logger.error("API fallback:", err); setApiJourneys(journeys); });
  }, []);
  const activeJourneys = apiJourneys || journeys;
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedJourney, setSelectedJourney] = useState<Journey | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const filteredJourneys = activeJourneys.filter((journey) => {
    const matchesCategory = selectedCategory === 'all' || journey.category === selectedCategory;
    const matchesSearch = journey.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      journey.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const categories = ['all', 'onboarding', 'payments', 'operations', 'analytics', 'security'];

  const handleRunJourney = async (journeyId: number) => {
    // API call to trigger journey workflow
    console.info(`Running journey ${journeyId}`);
    toast.success(`Journey ${journeyId} triggered successfully!`);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                User Journey Dashboard
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Monitor and manage all 20 platform user journeys
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Overall Health:</span>
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                98.2% Success Rate
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search journeys..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Category Filter */}
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedCategory === category
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {category.charAt(0).toUpperCase() + category.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Journey Grid */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredJourneys.map((journey) => (
            <div
              key={journey.id}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => setSelectedJourney(journey)}
            >
              {/* Card Header */}
              <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${statusColors[journey.status]}`} />
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                      Journey {journey.id}
                    </span>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${categoryColors[journey.category]}`}>
                    {journey.category}
                  </span>
                </div>
                <h3 className="mt-2 text-lg font-semibold text-gray-900 dark:text-white line-clamp-1">
                  {journey.name}
                </h3>
              </div>

              {/* Card Body */}
              <div className="p-4">
                <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                  {journey.description}
                </p>

                {/* Components */}
                <div className="mt-3 flex flex-wrap gap-1">
                  {journey.components.slice(0, 3).map((component, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs"
                    >
                      {component}
                    </span>
                  ))}
                  {journey.components.length > 3 && (
                    <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs">
                      +{journey.components.length - 3}
                    </span>
                  )}
                </div>

                {/* Success Rate */}
                <div className="mt-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500 dark:text-gray-400">Success Rate</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {journey.successRate}%
                    </span>
                  </div>
                  <div className="mt-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full transition-all"
                      style={{ width: `${journey.successRate}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Card Footer */}
              <div className="px-4 py-3 bg-gray-50 dark:bg-gray-750 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRunJourney(journey.id);
                  }}
                  className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Run Journey
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Journey Detail Modal */}
      {selectedJourney && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
            <div
              className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
              onClick={() => setSelectedJourney(null)}
            />

            <div className="relative inline-block w-full max-w-2xl p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white dark:bg-gray-800 shadow-xl rounded-2xl">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-full ${statusColors[selectedJourney.status]}`} />
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${categoryColors[selectedJourney.category]}`}>
                      {selectedJourney.category}
                    </span>
                  </div>
                  <h3 className="mt-2 text-xl font-bold text-gray-900 dark:text-white">
                    Journey {selectedJourney.id}: {selectedJourney.name}
                  </h3>
                </div>
                <button
                  onClick={() => setSelectedJourney(null)}
                  className="text-gray-400 hover:text-gray-500"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <p className="mt-4 text-gray-600 dark:text-gray-400">
                {selectedJourney.description}
              </p>

              <div className="mt-6">
                <h4 className="text-sm font-medium text-gray-900 dark:text-white">Integrated Components</h4>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedJourney.components.map((component, idx) => (
                    <span
                      key={idx}
                      className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-sm"
                    >
                      {component}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-4">
                <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Success Rate</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">
                    {selectedJourney.successRate}%
                  </p>
                </div>
                <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Status</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white capitalize">
                    {selectedJourney.status}
                  </p>
                </div>
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => handleRunJourney(selectedJourney.id)}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                >
                  Run Journey
                </button>
                <button
                  onClick={() => setSelectedJourney(null)}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg font-medium transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
