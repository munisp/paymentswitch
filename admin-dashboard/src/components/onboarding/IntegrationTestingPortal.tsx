'use client';

import { logger } from "@/lib/logger";
import React, { useState, useEffect, useCallback } from 'react';
import { lakehouseAPI, useLakehouseData } from '@/lib/api';
import {
  Play,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Code,
  Terminal,
  Award,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Download,
  Filter,
} from 'lucide-react';

interface TestScenario {
  id: string;
  name: string;
  description: string;
  category: string;
  difficulty: string;
  isRequired: boolean;
  timeout: number;
  tags: string[];
  steps: TestStep[];
}

interface TestStep {
  order: number;
  name: string;
  description: string;
  method: string;
  endpoint: string;
}

interface TestRun {
  id: string;
  scenarioId: string;
  scenarioName: string;
  status: 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'TIMEOUT';
  startedAt: string;
  completedAt?: string;
  duration: number;
  stepResults: TestStepResult[];
  errorMessage?: string;
}

interface TestStepResult {
  stepOrder: number;
  stepName: string;
  status: 'PASSED' | 'FAILED' | 'SKIPPED';
  duration: number;
  errorMessage?: string;
}

interface CertificationProgress {
  participantId: string;
  totalScenarios: number;
  passedScenarios: number;
  failedScenarios: number;
  pendingScenarios: number;
  progressPercent: number;
  isCertified: boolean;
  certifiedAt?: string;
  certificateId?: string;
  requiredRemaining: number;
}

interface SandboxCredentials {
  clientId: string;
  clientSecret: string;
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  webhookSecret: string;
  isActive: boolean;
  rateLimitTps: number;
}

const API_BASE = process.env.NEXT_PUBLIC_ONBOARDING_API || 'http://localhost:8082';

const defaultScenarios: TestScenario[] = [
  {
    id: 'party-lookup-msisdn',
    name: 'Party Lookup by MSISDN',
    description: 'Look up a party by mobile phone number',
    category: 'PARTY_LOOKUP',
    difficulty: 'BASIC',
    isRequired: true,
    timeout: 30,
    tags: ['party', 'lookup', 'msisdn'],
    steps: [
      { order: 1, name: 'Lookup Party', description: 'Send GET request to lookup party by MSISDN', method: 'GET', endpoint: '/parties/MSISDN/{msisdn}' },
    ],
  },
  {
    id: 'p2p-transfer-happy-path',
    name: 'P2P Transfer - Happy Path',
    description: 'Complete a person-to-person transfer successfully',
    category: 'TRANSFER',
    difficulty: 'BASIC',
    isRequired: true,
    timeout: 60,
    tags: ['transfer', 'p2p', 'happy-path'],
    steps: [
      { order: 1, name: 'Lookup Payee', description: 'Look up the payee party', method: 'GET', endpoint: '/parties/MSISDN/{payee_msisdn}' },
      { order: 2, name: 'Request Quote', description: 'Request a quote for the transfer', method: 'POST', endpoint: '/quotes' },
      { order: 3, name: 'Execute Transfer', description: 'Execute the transfer', method: 'POST', endpoint: '/transfers' },
      { order: 4, name: 'Verify Transfer Status', description: 'Verify the transfer completed successfully', method: 'GET', endpoint: '/transfers/{transfer_id}' },
    ],
  },
  {
    id: 'transfer-timeout',
    name: 'Transfer Timeout Handling',
    description: 'Verify proper handling of transfer timeout',
    category: 'TRANSFER',
    difficulty: 'INTERMEDIATE',
    isRequired: true,
    timeout: 120,
    tags: ['transfer', 'timeout', 'error-handling'],
    steps: [
      { order: 1, name: 'Initiate Transfer with Short Expiry', description: 'Start a transfer that will timeout', method: 'POST', endpoint: '/transfers' },
      { order: 2, name: 'Verify Transfer Aborted', description: 'Verify the transfer was aborted due to timeout', method: 'GET', endpoint: '/transfers/{transfer_id}' },
    ],
  },
  {
    id: 'bulk-transfer',
    name: 'Bulk Transfer Processing',
    description: 'Process a bulk transfer with multiple transactions',
    category: 'BULK',
    difficulty: 'ADVANCED',
    isRequired: false,
    timeout: 180,
    tags: ['bulk', 'transfer', 'batch'],
    steps: [
      { order: 1, name: 'Submit Bulk Transfer', description: 'Submit a bulk transfer request', method: 'POST', endpoint: '/bulkTransfers' },
      { order: 2, name: 'Verify Bulk Transfer Status', description: 'Verify all individual transfers completed', method: 'GET', endpoint: '/bulkTransfers/{bulk_transfer_id}' },
    ],
  },
  {
    id: 'fx-quote',
    name: 'FX Quote Request',
    description: 'Request a foreign exchange quote',
    category: 'FX',
    difficulty: 'INTERMEDIATE',
    isRequired: false,
    timeout: 60,
    tags: ['fx', 'quote', 'currency'],
    steps: [
      { order: 1, name: 'Request FX Quote', description: 'Request a quote for currency conversion', method: 'POST', endpoint: '/fxQuotes' },
      { order: 2, name: 'Verify FX Quote Response', description: 'Verify the FX quote response', method: 'GET', endpoint: '/fxQuotes/{conversion_request_id}' },
    ],
  },
  {
    id: 'error-handling-invalid-party',
    name: 'Error Handling - Invalid Party',
    description: 'Verify error handling for invalid party lookup',
    category: 'ERROR_HANDLING',
    difficulty: 'BASIC',
    isRequired: true,
    timeout: 30,
    tags: ['error', 'party', 'validation'],
    steps: [
      { order: 1, name: 'Lookup Invalid Party', description: 'Attempt to lookup a non-existent party', method: 'GET', endpoint: '/parties/MSISDN/invalid' },
    ],
  },
];

export function IntegrationTestingPortal() {
  const scenarioFetcher = useCallback(() =>
    lakehouseAPI.fetch<{ scenarios: TestScenario[] }>('/api/v1/onboarding/test-scenarios')
      .then(d => d.scenarios)
      .catch((err: unknown) => { logger.error("API fallback:", err); return defaultScenarios; }), []);
  const { data: apiScenarios } = useLakehouseData(scenarioFetcher, 60000);
  const [scenarios, setScenarios] = useState<TestScenario[]>(defaultScenarios);
  useEffect(() => { if (apiScenarios) setScenarios(apiScenarios); }, [apiScenarios]);
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [progress, setProgress] = useState<CertificationProgress | null>(null);
  const [credentials, setCredentials] = useState<SandboxCredentials | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<TestScenario | null>(null);
  const [runningScenario, setRunningScenario] = useState<string | null>(null);
  const [expandedScenarios, setExpandedScenarios] = useState<Set<string>>(new Set());
  const [showSecrets, setShowSecrets] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [difficultyFilter, setDifficultyFilter] = useState<string>('ALL');

  useEffect(() => {
    // Simulate loading progress
    setProgress({
      participantId: 'participant-001',
      totalScenarios: scenarios.length,
      passedScenarios: 2,
      failedScenarios: 0,
      pendingScenarios: scenarios.length - 2,
      progressPercent: (2 / scenarios.length) * 100,
      isCertified: false,
      requiredRemaining: scenarios.filter(s => s.isRequired).length - 2,
    });

    // Simulate credentials
    setCredentials({
      clientId: 'sandbox-client-abc123',
      clientSecret: 'sk_sandbox_xxxxxxxxxxxxxxxxxxxxx',
      apiKey: 'pk_sandbox_yyyyyyyyyyyyyyyyyyyy',
      apiSecret: 'as_sandbox_zzzzzzzzzzzzzzzzzzzz',
      baseUrl: 'https://sandbox.paymentswitch.io/api/v1',
      webhookSecret: 'whsec_aaaaaaaaaaaaaaaaaaaaaa',
      isActive: true,
      rateLimitTps: 100,
    });
  }, [scenarios.length]);

  const runScenario = async (scenario: TestScenario) => {
    setRunningScenario(scenario.id);
    
    const testRun: TestRun = {
      id: `run-${Date.now()}`,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
      duration: 0,
      stepResults: [],
    };

    setTestRuns(prev => [testRun, ...prev]);

    // Simulate running each step
    for (const step of scenario.steps) {
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
      
      const stepResult: TestStepResult = {
        stepOrder: step.order,
        stepName: step.name,
        status: Math.random() > 0.1 ? 'PASSED' : 'FAILED',
        duration: Math.floor(Math.random() * 500) + 100,
      };

      testRun.stepResults.push(stepResult);
      setTestRuns(prev => prev.map(r => r.id === testRun.id ? { ...testRun } : r));

      if (stepResult.status === 'FAILED') {
        testRun.status = 'FAILED';
        testRun.errorMessage = `Step ${step.order} failed: ${step.name}`;
        break;
      }
    }

    if (testRun.status === 'RUNNING') {
      testRun.status = 'PASSED';
    }

    testRun.completedAt = new Date().toISOString();
    testRun.duration = testRun.stepResults.reduce((sum, r) => sum + r.duration, 0);

    setTestRuns(prev => prev.map(r => r.id === testRun.id ? { ...testRun } : r));
    setRunningScenario(null);

    // Update progress
    if (testRun.status === 'PASSED' && progress) {
      setProgress({
        ...progress,
        passedScenarios: progress.passedScenarios + 1,
        pendingScenarios: progress.pendingScenarios - 1,
        progressPercent: ((progress.passedScenarios + 1) / progress.totalScenarios) * 100,
        requiredRemaining: scenario.isRequired ? progress.requiredRemaining - 1 : progress.requiredRemaining,
        isCertified: progress.requiredRemaining - (scenario.isRequired ? 1 : 0) === 0,
      });
    }
  };

  const toggleExpanded = (scenarioId: string) => {
    setExpandedScenarios(prev => {
      const newSet = new Set(prev);
      if (newSet.has(scenarioId)) {
        newSet.delete(scenarioId);
      } else {
        newSet.add(scenarioId);
      }
      return newSet;
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'PASSED':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'FAILED':
        return <XCircle className="h-5 w-5 text-red-500" />;
      case 'RUNNING':
        return <RefreshCw className="h-5 w-5 text-blue-500 animate-spin" />;
      case 'TIMEOUT':
        return <Clock className="h-5 w-5 text-yellow-500" />;
      default:
        return <AlertCircle className="h-5 w-5 text-gray-400" />;
    }
  };

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'BASIC':
        return 'bg-green-100 text-green-800';
      case 'INTERMEDIATE':
        return 'bg-yellow-100 text-yellow-800';
      case 'ADVANCED':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'TRANSFER':
        return 'bg-blue-100 text-blue-800';
      case 'PARTY_LOOKUP':
        return 'bg-purple-100 text-purple-800';
      case 'BULK':
        return 'bg-orange-100 text-orange-800';
      case 'FX':
        return 'bg-cyan-100 text-cyan-800';
      case 'ERROR_HANDLING':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const filteredScenarios = scenarios.filter(s => {
    if (categoryFilter !== 'ALL' && s.category !== categoryFilter) return false;
    if (difficultyFilter !== 'ALL' && s.difficulty !== difficultyFilter) return false;
    return true;
  });

  const categories = ['ALL', ...Array.from(new Set(scenarios.map(s => s.category)))];
  const difficulties = ['ALL', 'BASIC', 'INTERMEDIATE', 'ADVANCED'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Integration Testing Portal</h2>
          <p className="text-sm text-gray-500 mt-1">
            Test your integration with predefined scenarios and get certified
          </p>
        </div>
        {progress?.isCertified && (
          <div className="flex items-center gap-2 px-4 py-2 bg-green-100 text-green-800 rounded-lg">
            <Award className="h-5 w-5" />
            <span className="font-medium">Certified</span>
          </div>
        )}
      </div>

      {/* Progress Card */}
      {progress && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Certification Progress</h3>
            <span className="text-2xl font-bold text-primary-600">
              {progress.progressPercent.toFixed(0)}%
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 mb-4">
            <div
              className="bg-primary-600 h-3 rounded-full transition-all duration-500"
              style={{ width: `${progress.progressPercent}%` }}
            />
          </div>
          <div className="grid grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-gray-900">{progress.totalScenarios}</p>
              <p className="text-sm text-gray-500">Total</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-green-600">{progress.passedScenarios}</p>
              <p className="text-sm text-gray-500">Passed</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-red-600">{progress.failedScenarios}</p>
              <p className="text-sm text-gray-500">Failed</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-yellow-600">{progress.requiredRemaining}</p>
              <p className="text-sm text-gray-500">Required Remaining</p>
            </div>
          </div>
        </div>
      )}

      {/* Sandbox Credentials */}
      {credentials && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Sandbox Credentials</h3>
            <button
              onClick={() => setShowSecrets(!showSecrets)}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
            >
              {showSecrets ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {showSecrets ? 'Hide' : 'Show'} Secrets
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">Client ID</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-gray-50 rounded text-sm font-mono">
                  {credentials.clientId}
                </code>
                <button
                  onClick={() => copyToClipboard(credentials.clientId)}
                  className="p-2 text-gray-400 hover:text-gray-600"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">Client Secret</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-gray-50 rounded text-sm font-mono">
                  {showSecrets ? credentials.clientSecret : '••••••••••••••••••••'}
                </code>
                <button
                  onClick={() => copyToClipboard(credentials.clientSecret)}
                  className="p-2 text-gray-400 hover:text-gray-600"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">API Key</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-gray-50 rounded text-sm font-mono">
                  {credentials.apiKey}
                </code>
                <button
                  onClick={() => copyToClipboard(credentials.apiKey)}
                  className="p-2 text-gray-400 hover:text-gray-600"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">Base URL</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-gray-50 rounded text-sm font-mono">
                  {credentials.baseUrl}
                </code>
                <button
                  onClick={() => copyToClipboard(credentials.baseUrl)}
                  className="p-2 text-gray-400 hover:text-gray-600"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-4 text-sm text-gray-500">
            <span className="flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${credentials.isActive ? 'bg-green-500' : 'bg-red-500'}`} />
              {credentials.isActive ? 'Active' : 'Inactive'}
            </span>
            <span>Rate Limit: {credentials.rateLimitTps} TPS</span>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-400" />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat === 'ALL' ? 'All Categories' : cat}</option>
            ))}
          </select>
        </div>
        <select
          value={difficultyFilter}
          onChange={(e) => setDifficultyFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          {difficulties.map(diff => (
            <option key={diff} value={diff}>{diff === 'ALL' ? 'All Difficulties' : diff}</option>
          ))}
        </select>
      </div>

      {/* Test Scenarios */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Test Scenarios</h3>
        {filteredScenarios.map((scenario) => {
          const lastRun = testRuns.find(r => r.scenarioId === scenario.id);
          const isExpanded = expandedScenarios.has(scenario.id);
          const isRunning = runningScenario === scenario.id;

          return (
            <div
              key={scenario.id}
              className="bg-white border border-gray-200 rounded-lg overflow-hidden"
            >
              <div
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50"
                onClick={() => toggleExpanded(scenario.id)}
              >
                <div className="flex items-center gap-4">
                  {isExpanded ? (
                    <ChevronDown className="h-5 w-5 text-gray-400" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-gray-400" />
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-gray-900">{scenario.name}</h4>
                      {scenario.isRequired && (
                        <span className="px-2 py-0.5 bg-red-100 text-red-800 text-xs rounded-full">
                          Required
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">{scenario.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getCategoryColor(scenario.category)}`}>
                    {scenario.category}
                  </span>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getDifficultyColor(scenario.difficulty)}`}>
                    {scenario.difficulty}
                  </span>
                  {lastRun && getStatusIcon(lastRun.status)}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      runScenario(scenario);
                    }}
                    disabled={isRunning}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${
                      isRunning
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-primary-600 text-white hover:bg-primary-700'
                    }`}
                  >
                    {isRunning ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Running...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4" />
                        Run Test
                      </>
                    )}
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-gray-200 p-4 bg-gray-50">
                  <h5 className="font-medium text-gray-700 mb-3">Test Steps</h5>
                  <div className="space-y-2">
                    {scenario.steps.map((step) => {
                      const stepResult = lastRun?.stepResults.find(r => r.stepOrder === step.order);
                      return (
                        <div
                          key={step.order}
                          className="flex items-center gap-4 p-3 bg-white rounded-lg border border-gray-200"
                        >
                          <span className="flex items-center justify-center h-6 w-6 rounded-full bg-gray-100 text-sm font-medium text-gray-600">
                            {step.order}
                          </span>
                          <div className="flex-1">
                            <p className="font-medium text-gray-900">{step.name}</p>
                            <p className="text-sm text-gray-500">{step.description}</p>
                            <code className="text-xs text-gray-400">
                              {step.method} {step.endpoint}
                            </code>
                          </div>
                          {stepResult && (
                            <div className="flex items-center gap-2">
                              {getStatusIcon(stepResult.status)}
                              <span className="text-sm text-gray-500">{stepResult.duration}ms</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {lastRun && (
                    <div className="mt-4 p-3 bg-white rounded-lg border border-gray-200">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">Last Run</span>
                        <span className="text-sm text-gray-500">
                          {new Date(lastRun.startedAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 mt-2">
                        <span className={`flex items-center gap-1 text-sm ${
                          lastRun.status === 'PASSED' ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {getStatusIcon(lastRun.status)}
                          {lastRun.status}
                        </span>
                        <span className="text-sm text-gray-500">
                          Duration: {lastRun.duration}ms
                        </span>
                      </div>
                      {lastRun.errorMessage && (
                        <p className="mt-2 text-sm text-red-600">{lastRun.errorMessage}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Recent Test Runs */}
      {testRuns.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">Recent Test Runs</h3>
          </div>
          <div className="divide-y divide-gray-200">
            {testRuns.slice(0, 10).map((run) => (
              <div key={run.id} className="px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {getStatusIcon(run.status)}
                  <div>
                    <p className="font-medium text-gray-900">{run.scenarioName}</p>
                    <p className="text-sm text-gray-500">
                      {new Date(run.startedAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-500">{run.duration}ms</span>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    run.status === 'PASSED' ? 'bg-green-100 text-green-800' :
                    run.status === 'FAILED' ? 'bg-red-100 text-red-800' :
                    run.status === 'RUNNING' ? 'bg-blue-100 text-blue-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {run.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default IntegrationTestingPortal;
