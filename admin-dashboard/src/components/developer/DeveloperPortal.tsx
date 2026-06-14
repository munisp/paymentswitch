import { logger } from "@/lib/logger";
import React, { useState, useEffect, useCallback } from 'react';
import { lakehouseAPI, useLakehouseData } from '@/lib/api';
import {
  Code,
  Key,
  Webhook,
  Book,
  Terminal,
  Copy,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  RefreshCw,
  ExternalLink,
  CheckCircle,
  XCircle,
  Activity,
  Clock,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '../common/Card';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { Modal, ConfirmModal } from '../common/Modal';
import { Input, Select, Textarea } from '../common/Input';
import { MetricCard, MetricGrid } from '../dashboard/MetricCard';
import { TransactionChart } from '../dashboard/TransactionChart';
import { formatDateTime, cn } from '@/lib/utils';
import type { APIKey } from '@/types';

const defaultAPIKeys: APIKey[] = [
  {
    id: 'key-001',
    name: 'Production API Key',
    keyPrefix: 'pk_live_',
    participantId: 'firstbank',
    permissions: ['transfers:read', 'transfers:write', 'participants:read'],
    rateLimit: 1000,
    status: 'ACTIVE',
    createdAt: '2024-01-15T10:00:00Z',
    lastUsedAt: new Date(Date.now() - 300000).toISOString(),
    usageCount: 1234567,
  },
  {
    id: 'key-002',
    name: 'Sandbox API Key',
    keyPrefix: 'pk_test_',
    participantId: 'firstbank',
    permissions: ['transfers:read', 'transfers:write', 'participants:read', 'sandbox:all'],
    rateLimit: 100,
    status: 'ACTIVE',
    createdAt: '2024-01-15T10:00:00Z',
    lastUsedAt: new Date(Date.now() - 600000).toISOString(),
    usageCount: 45678,
  },
  {
    id: 'key-003',
    name: 'Legacy API Key',
    keyPrefix: 'pk_live_',
    participantId: 'firstbank',
    permissions: ['transfers:read'],
    rateLimit: 500,
    status: 'REVOKED',
    createdAt: '2023-06-01T10:00:00Z',
    expiresAt: '2024-06-01T10:00:00Z',
    usageCount: 987654,
  },
];

const defaultWebhooks = [
  {
    id: 'wh-001',
    url: 'https://api.firstbank.com/webhooks/payment-switch',
    events: ['transfer.completed', 'transfer.failed', 'settlement.completed'],
    status: 'ACTIVE',
    lastDeliveryAt: new Date(Date.now() - 120000).toISOString(),
    lastDeliveryStatus: 'SUCCESS',
    successRate: 99.8,
  },
  {
    id: 'wh-002',
    url: 'https://api.firstbank.com/webhooks/alerts',
    events: ['fraud.alert', 'participant.suspended'],
    status: 'ACTIVE',
    lastDeliveryAt: new Date(Date.now() - 3600000).toISOString(),
    lastDeliveryStatus: 'SUCCESS',
    successRate: 100,
  },
];

const generateUsageData = () => {
  const data = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    data.push({
      timestamp: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      requests: Math.floor(Math.random() * 50000) + 30000,
    });
  }
  return data;
};

export function DeveloperPortal() {
  const keyFetcher = useCallback(() =>
    lakehouseAPI.fetch<{ keys: APIKey[] }>('/api/v1/developer/keys')
      .then(d => d.keys)
      .catch((err: unknown) => { logger.error("API fallback:", err); return []; }), []);
  const { data: apiKeys_ } = useLakehouseData(keyFetcher, 30000);
  const [apiKeys, setApiKeys] = useState<APIKey[]>(defaultAPIKeys);
  const [webhooks, setWebhooks] = useState(defaultWebhooks);
  useEffect(() => { if (apiKeys_) setApiKeys(apiKeys_); }, [apiKeys_]);
  const [activeTab, setActiveTab] = useState<'keys' | 'webhooks' | 'docs' | 'sandbox'>('keys');
  const [showCreateKeyModal, setShowCreateKeyModal] = useState(false);
  const [showCreateWebhookModal, setShowCreateWebhookModal] = useState(false);
  const [showRevokeModal, setShowRevokeModal] = useState(false);
  const [selectedKey, setSelectedKey] = useState<APIKey | null>(null);

  const usageData = generateUsageData();
  const totalRequests = apiKeys.reduce((sum, k) => sum + k.usageCount, 0);
  const activeKeys = apiKeys.filter(k => k.status === 'ACTIVE').length;

  const handleRevokeKey = () => {
    if (selectedKey) {
      setApiKeys(prev =>
        prev.map(k =>
          k.id === selectedKey.id ? { ...k, status: 'REVOKED' } : k
        )
      );
    }
    setShowRevokeModal(false);
  };

  return (
    <div className="space-y-6">
      {/* Summary Metrics */}
      <MetricGrid columns={4}>
        <MetricCard
          title="Total API Requests"
          value={totalRequests}
          format="compact"
          change={12.5}
          trend="up"
          icon={<Activity className="h-5 w-5" />}
        />
        <MetricCard
          title="Active API Keys"
          value={activeKeys}
          icon={<Key className="h-5 w-5" />}
        />
        <MetricCard
          title="Webhook Success Rate"
          value={99.9}
          format="percentage"
          icon={<Webhook className="h-5 w-5" />}
        />
        <MetricCard
          title="Avg Response Time"
          value="45ms"
          change={-5}
          trend="down"
          icon={<Clock className="h-5 w-5" />}
        />
      </MetricGrid>

      {/* Usage Chart */}
      <TransactionChart
        data={usageData}
        title="API Usage (Last 30 Days)"
        dataKey="requests"
        color="#0ea5e9"
        type="bar"
        height={200}
      />

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8">
          {[
            { id: 'keys', label: 'API Keys', icon: Key },
            { id: 'webhooks', label: 'Webhooks', icon: Webhook },
            { id: 'docs', label: 'Documentation', icon: Book },
            { id: 'sandbox', label: 'Sandbox', icon: Terminal },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={cn(
                'py-4 px-1 border-b-2 font-medium text-sm flex items-center',
                activeTab === tab.id
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              <tab.icon className="h-4 w-4 mr-2" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* API Keys Tab */}
      {activeTab === 'keys' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setShowCreateKeyModal(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create API Key
            </Button>
          </div>
          {apiKeys.map((key) => (
            <APIKeyCard
              key={key.id}
              apiKey={key}
              onRevoke={() => {
                setSelectedKey(key);
                setShowRevokeModal(true);
              }}
            />
          ))}
        </div>
      )}

      {/* Webhooks Tab */}
      {activeTab === 'webhooks' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setShowCreateWebhookModal(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Webhook
            </Button>
          </div>
          {webhooks.map((webhook) => (
            <WebhookCard key={webhook.id} webhook={webhook} />
          ))}
        </div>
      )}

      {/* Documentation Tab */}
      {activeTab === 'docs' && <DocumentationSection />}

      {/* Sandbox Tab */}
      {activeTab === 'sandbox' && <SandboxSection />}

      {/* Create API Key Modal */}
      <CreateAPIKeyModal
        isOpen={showCreateKeyModal}
        onClose={() => setShowCreateKeyModal(false)}
        onCreate={(data) => {
          const newKey: APIKey = {
            id: `key-${Date.now()}`,
            name: data.name,
            keyPrefix: data.environment === 'production' ? 'pk_live_' : 'pk_test_',
            participantId: 'firstbank',
            permissions: data.permissions,
            rateLimit: data.rateLimit,
            status: 'ACTIVE',
            createdAt: new Date().toISOString(),
            usageCount: 0,
          };
          setApiKeys(prev => [newKey, ...prev]);
          setShowCreateKeyModal(false);
        }}
      />

      {/* Create Webhook Modal */}
      <CreateWebhookModal
        isOpen={showCreateWebhookModal}
        onClose={() => setShowCreateWebhookModal(false)}
        onCreate={(data) => {
          const newWebhook = {
            id: `wh-${Date.now()}`,
            url: data.url,
            events: data.events,
            status: 'ACTIVE',
            lastDeliveryAt: '',
            lastDeliveryStatus: '',
            successRate: 100,
          };
          setWebhooks(prev => [newWebhook, ...prev]);
          setShowCreateWebhookModal(false);
        }}
      />

      {/* Revoke Confirmation Modal */}
      <ConfirmModal
        isOpen={showRevokeModal}
        onClose={() => setShowRevokeModal(false)}
        onConfirm={handleRevokeKey}
        title="Revoke API Key"
        message={`Are you sure you want to revoke "${selectedKey?.name}"? This action cannot be undone and will immediately invalidate the key.`}
        confirmText="Revoke Key"
        variant="danger"
      />
    </div>
  );
}

interface APIKeyCardProps {
  apiKey: APIKey;
  onRevoke: () => void;
}

function APIKeyCard({ apiKey, onRevoke }: APIKeyCardProps) {
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);

  const maskedKey = `${apiKey.keyPrefix}${'*'.repeat(24)}`;
  const fullKey = `${apiKey.keyPrefix}abc123def456ghi789jkl012`;

  const handleCopy = () => {
    navigator.clipboard.writeText(fullKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="font-medium text-gray-900">{apiKey.name}</h4>
              <Badge variant={apiKey.status === 'ACTIVE' ? 'success' : 'danger'}>
                {apiKey.status}
              </Badge>
            </div>
            <div className="flex items-center gap-2 mb-3">
              <code className="bg-gray-100 px-3 py-1 rounded text-sm font-mono">
                {showKey ? fullKey : maskedKey}
              </code>
              <button
                onClick={() => setShowKey(!showKey)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <button
                onClick={handleCopy}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                {copied ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>
            <div className="flex flex-wrap gap-1 mb-2">
              {apiKey.permissions.map((perm) => (
                <Badge key={perm} variant="info" className="text-xs">
                  {perm}
                </Badge>
              ))}
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <span>Rate Limit: {apiKey.rateLimit}/min</span>
              <span>Usage: {apiKey.usageCount.toLocaleString()} requests</span>
              {apiKey.lastUsedAt && (
                <span>Last used: {formatDateTime(apiKey.lastUsedAt)}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {apiKey.status === 'ACTIVE' && (
              <>
                <Button variant="ghost" size="sm">
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Rotate
                </Button>
                <Button variant="danger" size="sm" onClick={onRevoke}>
                  <Trash2 className="h-4 w-4 mr-1" />
                  Revoke
                </Button>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface WebhookCardProps {
  webhook: {
    id: string;
    url: string;
    events: string[];
    status: string;
    lastDeliveryAt?: string;
    lastDeliveryStatus?: string;
    successRate: number;
  };
}

function WebhookCard({ webhook }: WebhookCardProps) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-sm font-mono text-primary-600">{webhook.url}</code>
              <Badge variant={webhook.status === 'ACTIVE' ? 'success' : 'danger'}>
                {webhook.status}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-1 mb-2">
              {webhook.events.map((event) => (
                <Badge key={event} variant="default" className="text-xs">
                  {event}
                </Badge>
              ))}
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <span>Success Rate: {webhook.successRate}%</span>
              {webhook.lastDeliveryAt && (
                <span className="flex items-center">
                  Last delivery: {formatDateTime(webhook.lastDeliveryAt)}
                  {webhook.lastDeliveryStatus === 'SUCCESS' ? (
                    <CheckCircle className="h-4 w-4 ml-1 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 ml-1 text-red-500" />
                  )}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm">Test</Button>
            <Button variant="ghost" size="sm">Edit</Button>
            <Button variant="ghost" size="sm">
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DocumentationSection() {
  const endpoints = [
    { method: 'POST', path: '/api/v1/transfers', description: 'Initiate a new transfer' },
    { method: 'GET', path: '/api/v1/transfers/:id', description: 'Get transfer details' },
    { method: 'GET', path: '/api/v1/participants', description: 'List all participants' },
    { method: 'GET', path: '/api/v1/settlements', description: 'List settlement windows' },
    { method: 'POST', path: '/api/v1/quotes', description: 'Request a quote' },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>API Reference</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {endpoints.map((endpoint, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <Badge
                    variant={endpoint.method === 'GET' ? 'info' : 'success'}
                    className="w-16 justify-center"
                  >
                    {endpoint.method}
                  </Badge>
                  <code className="text-sm font-mono">{endpoint.path}</code>
                </div>
                <span className="text-sm text-gray-500">{endpoint.description}</span>
              </div>
            ))}
          </div>
        </CardContent>
        <CardFooter>
          <Button variant="secondary">
            <ExternalLink className="h-4 w-4 mr-2" />
            View Full Documentation
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quick Start Guide</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-gray-900 rounded-lg p-4 text-sm font-mono text-gray-100 overflow-x-auto">
            <pre>{`# Install the SDK
npm install @payment-switch/sdk

# Initialize the client
import { PaymentSwitch } from '@payment-switch/sdk';

const client = new PaymentSwitch({
  apiKey: 'pk_live_your_api_key',
  environment: 'production'
});

# Create a transfer
const transfer = await client.transfers.create({
  payerFsp: 'firstbank',
  payeeFsp: 'gtbank',
  amount: { amount: '1000', currency: 'NGN' },
  payee: { partyIdType: 'MSISDN', partyIdentifier: '+2348012345678' }
});`}</pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SandboxSection() {
  const [request, setRequest] = useState(`{
  "payerFsp": "testbank1",
  "payeeFsp": "testbank2",
  "amount": {
    "amount": "1000",
    "currency": "NGN"
  },
  "payee": {
    "partyIdType": "MSISDN",
    "partyIdentifier": "+2348012345678"
  }
}`);
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);

  const handleExecute = async () => {
    setLoading(true);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    setResponse(JSON.stringify({
      transferId: 'TRF-SANDBOX-001',
      state: 'COMMITTED',
      completedAt: new Date().toISOString(),
      amount: { amount: '1000', currency: 'NGN' },
    }, null, 2));
    setLoading(false);
  };

  return (
    <div className="grid grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Request</CardTitle>
        </CardHeader>
        <CardContent>
          <Select
            label="Endpoint"
            options={[
              { value: 'POST /transfers', label: 'POST /api/v1/transfers' },
              { value: 'GET /transfers', label: 'GET /api/v1/transfers/:id' },
              { value: 'POST /quotes', label: 'POST /api/v1/quotes' },
            ]}
            className="mb-4"
          />
          <Textarea
            label="Request Body"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            rows={12}
            className="font-mono text-sm"
          />
        </CardContent>
        <CardFooter>
          <Button variant="primary" onClick={handleExecute} loading={loading}>
            <Terminal className="h-4 w-4 mr-2" />
            Execute
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Response</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-gray-900 rounded-lg p-4 min-h-[300px]">
            {response ? (
              <pre className="text-sm font-mono text-green-400">{response}</pre>
            ) : (
              <p className="text-gray-500 text-sm">Execute a request to see the response</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface CreateAPIKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: { name: string; environment: string; permissions: string[]; rateLimit: number }) => void;
}

function CreateAPIKeyModal({ isOpen, onClose, onCreate }: CreateAPIKeyModalProps) {
  const [name, setName] = useState('');
  const [environment, setEnvironment] = useState('sandbox');
  const [rateLimit, setRateLimit] = useState(100);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create API Key"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => onCreate({
              name,
              environment,
              permissions: ['transfers:read', 'transfers:write'],
              rateLimit,
            })}
          >
            Create Key
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Key Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Production API Key"
        />
        <Select
          label="Environment"
          value={environment}
          onChange={(e) => setEnvironment(e.target.value)}
          options={[
            { value: 'sandbox', label: 'Sandbox' },
            { value: 'production', label: 'Production' },
          ]}
        />
        <Input
          label="Rate Limit (requests/minute)"
          type="number"
          value={rateLimit}
          onChange={(e) => setRateLimit(parseInt(e.target.value))}
        />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Permissions</label>
          <div className="space-y-2">
            {['transfers:read', 'transfers:write', 'participants:read', 'settlements:read', 'webhooks:manage'].map((perm) => (
              <label key={perm} className="flex items-center">
                <input type="checkbox" className="rounded border-gray-300 text-primary-600 mr-2" defaultChecked={perm.includes('transfers')} />
                <span className="text-sm text-gray-700">{perm}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

interface CreateWebhookModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: { url: string; events: string[] }) => void;
}

function CreateWebhookModal({ isOpen, onClose, onCreate }: CreateWebhookModalProps) {
  const [url, setUrl] = useState('');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Webhook"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => onCreate({
              url,
              events: ['transfer.completed', 'transfer.failed'],
            })}
          >
            Add Webhook
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Webhook URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-domain.com/webhooks"
        />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Events</label>
          <div className="space-y-2">
            {[
              'transfer.completed',
              'transfer.failed',
              'transfer.expired',
              'settlement.completed',
              'participant.suspended',
              'fraud.alert',
            ].map((event) => (
              <label key={event} className="flex items-center">
                <input type="checkbox" className="rounded border-gray-300 text-primary-600 mr-2" defaultChecked={event.includes('transfer')} />
                <span className="text-sm text-gray-700">{event}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
