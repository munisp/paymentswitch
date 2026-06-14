import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import {
  Loader2, Plus, Copy, RefreshCw, ExternalLink, CheckCircle2, XCircle, Clock,
  BarChart3, Webhook, Shield, AlertTriangle, Users, FileText, Bell,
  Activity, ArrowUpDown, Settings, Key, Globe, Lock, TrendingUp, DollarSign,
  Search, Filter, Download, Eye, Trash2, Send, ShieldCheck, Zap
} from "lucide-react";
import Analytics from "./Analytics";
import BrandingSettings from "./BrandingSettings";
import { toast } from "sonner";

// Webhook event types
const WEBHOOK_EVENTS = [
  'payment.completed', 'payment.failed', 'payment.refunded',
  'session.created', 'session.expired',
  'dispute.created', 'dispute.resolved',
  'settlement.completed', 'settlement.failed',
  'payout.sent', 'payout.failed',
];

// Default settlement data
const defaultSettlements = [
  { id: 'STL-2026-001', date: '2026-06-05', grossAmount: 2450000, fees: 36750, netAmount: 2413250, transactions: 156, status: 'settled', bankName: 'GTBank', accountNumber: '****4521' },
  { id: 'STL-2026-002', date: '2026-06-04', grossAmount: 1890000, fees: 28350, netAmount: 1861650, transactions: 123, status: 'settled', bankName: 'GTBank', accountNumber: '****4521' },
  { id: 'STL-2026-003', date: '2026-06-03', grossAmount: 3120000, fees: 46800, netAmount: 3073200, transactions: 201, status: 'settled', bankName: 'GTBank', accountNumber: '****4521' },
  { id: 'STL-2026-004', date: '2026-06-02', grossAmount: 980000, fees: 14700, netAmount: 965300, transactions: 67, status: 'processing', bankName: 'GTBank', accountNumber: '****4521' },
  { id: 'STL-2026-005', date: '2026-06-01', grossAmount: 4250000, fees: 63750, netAmount: 4186250, transactions: 289, status: 'settled', bankName: 'GTBank', accountNumber: '****4521' },
];

// Default dispute data
const defaultDisputes = [
  { id: 'DSP-001', transactionId: 'TXN-89421', amount: 15000, currency: 'NGN', reason: 'Unauthorized transaction', status: 'open', createdAt: '2026-06-04', dueDate: '2026-06-18', customerEmail: 'john@example.com' },
  { id: 'DSP-002', transactionId: 'TXN-89380', amount: 45000, currency: 'NGN', reason: 'Product not received', status: 'under_review', createdAt: '2026-06-03', dueDate: '2026-06-17', customerEmail: 'ada@example.com' },
  { id: 'DSP-003', transactionId: 'TXN-89201', amount: 8500, currency: 'NGN', reason: 'Duplicate charge', status: 'won', createdAt: '2026-05-28', dueDate: '2026-06-11', customerEmail: 'tunde@example.com' },
  { id: 'DSP-004', transactionId: 'TXN-89150', amount: 120000, currency: 'NGN', reason: 'Service not as described', status: 'lost', createdAt: '2026-05-25', dueDate: '2026-06-08', customerEmail: 'fatima@example.com' },
  { id: 'DSP-005', transactionId: 'TXN-89099', amount: 32000, currency: 'NGN', reason: 'Fraudulent transaction', status: 'open', createdAt: '2026-06-05', dueDate: '2026-06-19', customerEmail: 'chidi@example.com' },
];

// Default team members
const defaultTeamMembers = [
  { id: 1, name: 'Oluwaseun Adeyemi', email: 'oluwa@merchant.com', role: 'owner', status: 'active', lastLogin: '2026-06-05 14:30', apiKeyCount: 2 },
  { id: 2, name: 'Chioma Eze', email: 'chioma@merchant.com', role: 'admin', status: 'active', lastLogin: '2026-06-05 12:15', apiKeyCount: 1 },
  { id: 3, name: 'Ibrahim Musa', email: 'ibrahim@merchant.com', role: 'developer', status: 'active', lastLogin: '2026-06-04 09:00', apiKeyCount: 3 },
  { id: 4, name: 'Fatima Bello', email: 'fatima@merchant.com', role: 'finance', status: 'active', lastLogin: '2026-06-03 16:45', apiKeyCount: 0 },
  { id: 5, name: 'Emeka Obi', email: 'emeka@merchant.com', role: 'support', status: 'inactive', lastLogin: '2026-05-20 11:30', apiKeyCount: 0 },
];

// Default compliance status
const defaultCompliance = {
  kycStatus: 'verified' as const,
  kycVerifiedDate: '2026-03-15',
  kybStatus: 'verified' as const,
  kybVerifiedDate: '2026-03-20',
  amlStatus: 'compliant' as const,
  lastAmlCheck: '2026-06-01',
  pciDssLevel: 'Level 1',
  pciExpiry: '2027-03-15',
  documents: [
    { name: 'Certificate of Incorporation', status: 'verified', uploadDate: '2026-03-10' },
    { name: 'CAC Business Name Registration', status: 'verified', uploadDate: '2026-03-10' },
    { name: 'Tax Clearance Certificate', status: 'verified', uploadDate: '2026-03-12' },
    { name: 'Board Resolution', status: 'verified', uploadDate: '2026-03-12' },
    { name: 'AML/CFT Policy Document', status: 'verified', uploadDate: '2026-03-14' },
    { name: 'Data Protection Certificate', status: 'expiring_soon', uploadDate: '2026-01-05' },
  ],
};

// Default integration health
const defaultIntegrationHealth = {
  apiLatency: { p50: 45, p95: 120, p99: 250 },
  successRate: 99.2,
  errorRate: 0.8,
  uptimePercent: 99.95,
  totalApiCalls24h: 45892,
  totalApiCalls7d: 312450,
  recentErrors: [
    { timestamp: '2026-06-05 14:22', endpoint: '/api/payment/create', statusCode: 500, message: 'Internal server error', count: 3 },
    { timestamp: '2026-06-05 10:15', endpoint: '/api/payment/capture', statusCode: 422, message: 'Invalid amount', count: 12 },
    { timestamp: '2026-06-04 23:45', endpoint: '/api/webhook/test', statusCode: 408, message: 'Request timeout', count: 1 },
  ],
  webhookDelivery: { total: 1250, successful: 1238, failed: 12, retrying: 5 },
};

// Default financial summary
const defaultFinancials = {
  currentMonth: { revenue: 12690000, fees: 190350, refunds: 245000, chargebacks: 120000, netRevenue: 12134650, transactions: 836 },
  lastMonth: { revenue: 10450000, fees: 156750, refunds: 180000, chargebacks: 85000, netRevenue: 10028250, transactions: 692 },
  growth: 21.4,
  monthlyRevenue: [
    { month: 'Jan', revenue: 6200000 }, { month: 'Feb', revenue: 7100000 }, { month: 'Mar', revenue: 8500000 },
    { month: 'Apr', revenue: 9200000 }, { month: 'May', revenue: 10450000 }, { month: 'Jun', revenue: 12690000 },
  ],
};

// Default webhook config
const defaultWebhooks = [
  { id: 1, url: 'https://api.merchant.com/webhooks/payments', events: ['payment.completed', 'payment.failed', 'payment.refunded'], status: 'active', lastDelivery: '2026-06-05 14:30', successRate: 99.1 },
  { id: 2, url: 'https://api.merchant.com/webhooks/disputes', events: ['dispute.created', 'dispute.resolved'], status: 'active', lastDelivery: '2026-06-04 16:22', successRate: 100 },
];

// Default notification prefs
const defaultNotificationPrefs = [
  { event: 'Payment above ₦500,000', email: true, sms: false, push: true },
  { event: 'Failed payment', email: true, sms: true, push: true },
  { event: 'New dispute', email: true, sms: true, push: true },
  { event: 'Settlement completed', email: true, sms: false, push: false },
  { event: 'API error rate >1%', email: true, sms: true, push: true },
  { event: 'Weekly report', email: true, sms: false, push: false },
  { event: 'Compliance document expiring', email: true, sms: true, push: true },
  { event: 'New team member added', email: true, sms: false, push: true },
];

// Demo merchant for standalone rendering when no backend is available
const DEMO_MERCHANT = {
  id: 1,
  userId: 1,
  businessName: 'Paystack Nigeria Ltd',
  businessType: 'ecommerce' as const,
  website: 'https://paystack.com',
  apiKey: 'demo_pk_abc123def456ghi789jkl012mno345',
  apiSecret: 'demo_sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  webhookUrl: 'https://paystack.com/webhooks/payments',
  webhookSecret: 'whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  status: 'active' as const,
  brandingLogo: null,
  brandingPrimaryColor: '#2563eb',
  brandingSecondaryColor: '#1e40af',
  brandingBackgroundColor: '#ffffff',
  brandingTextColor: '#1f2937',
  brandingFontFamily: 'Inter',
  brandingBorderRadius: '8px',
  createdAt: new Date('2026-01-15'),
  updatedAt: new Date('2026-06-05'),
};

// Demo transactions
const DEMO_TRANSACTIONS = [
  { id: 1, sessionId: 'sess_001', transactionId: 'TXN-20260605-001', merchantId: 1, amount: 500000, currency: 'NGN', status: 'completed', paymentMethod: 'card', provider: 'flutterwave', providerRef: 'FLW-REF-001', customerEmail: 'customer1@example.com', metadata: {}, createdAt: new Date('2026-06-05T10:30:00'), updatedAt: new Date('2026-06-05T10:31:00') },
  { id: 2, sessionId: 'sess_002', transactionId: 'TXN-20260605-002', merchantId: 1, amount: 125000, currency: 'NGN', status: 'completed', paymentMethod: 'bank_transfer', provider: 'paystack', providerRef: 'PSK-REF-002', customerEmail: 'ada@merchant.ng', metadata: {}, createdAt: new Date('2026-06-05T09:15:00'), updatedAt: new Date('2026-06-05T09:16:00') },
  { id: 3, sessionId: 'sess_003', transactionId: 'TXN-20260605-003', merchantId: 1, amount: 75000, currency: 'NGN', status: 'pending', paymentMethod: 'ussd', provider: 'flutterwave', providerRef: 'FLW-REF-003', customerEmail: 'tunde@shop.ng', metadata: {}, createdAt: new Date('2026-06-05T08:00:00'), updatedAt: new Date('2026-06-05T08:00:00') },
  { id: 4, sessionId: 'sess_004', transactionId: 'TXN-20260604-004', merchantId: 1, amount: 2300000, currency: 'NGN', status: 'completed', paymentMethod: 'bank_transfer', provider: 'nibss', providerRef: 'NIBSS-REF-004', customerEmail: 'buyer@enterprise.com', metadata: {}, createdAt: new Date('2026-06-04T16:45:00'), updatedAt: new Date('2026-06-04T16:46:00') },
  { id: 5, sessionId: 'sess_005', transactionId: 'TXN-20260604-005', merchantId: 1, amount: 50000, currency: 'NGN', status: 'failed', paymentMethod: 'card', provider: 'paystack', providerRef: 'PSK-REF-005', customerEmail: 'failed@test.com', metadata: {}, createdAt: new Date('2026-06-04T14:20:00'), updatedAt: new Date('2026-06-04T14:21:00') },
];

// Demo sessions
const DEMO_SESSIONS = [
  { id: 1, sessionId: 'sess_001', merchantId: 1, amount: 500000, currency: 'NGN', status: 'completed', successUrl: 'https://shop.ng/success', cancelUrl: 'https://shop.ng/cancel', customerEmail: 'customer1@example.com', customerName: 'Adewale Johnson', metadata: {}, expiresAt: new Date('2026-06-06'), createdAt: new Date('2026-06-05T10:30:00'), updatedAt: new Date('2026-06-05T10:31:00') },
  { id: 2, sessionId: 'sess_002', merchantId: 1, amount: 125000, currency: 'NGN', status: 'completed', successUrl: 'https://shop.ng/success', cancelUrl: 'https://shop.ng/cancel', customerEmail: 'ada@merchant.ng', customerName: 'Ada Okafor', metadata: {}, expiresAt: new Date('2026-06-06'), createdAt: new Date('2026-06-05T09:15:00'), updatedAt: new Date('2026-06-05T09:16:00') },
  { id: 3, sessionId: 'sess_003', merchantId: 1, amount: 75000, currency: 'NGN', status: 'pending', successUrl: 'https://shop.ng/success', cancelUrl: 'https://shop.ng/cancel', customerEmail: 'tunde@shop.ng', customerName: 'Tunde Bakare', metadata: {}, expiresAt: new Date('2026-06-06'), createdAt: new Date('2026-06-05T08:00:00'), updatedAt: new Date('2026-06-05T08:00:00') },
  { id: 4, sessionId: 'sess_004', merchantId: 1, amount: 2300000, currency: 'NGN', status: 'expired', successUrl: 'https://enterprise.com/pay/ok', cancelUrl: 'https://enterprise.com/pay/cancel', customerEmail: 'buyer@enterprise.com', customerName: 'Enterprise Buyer', metadata: {}, expiresAt: new Date('2026-06-05'), createdAt: new Date('2026-06-04T16:45:00'), updatedAt: new Date('2026-06-04T16:46:00') },
];

export default function Dashboard() {
  const { user } = useAuth();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState<"ecommerce" | "saas" | "marketplace" | "nonprofit" | "other">("ecommerce");
  const [website, setWebsite] = useState("");
  const [selectedMerchant, setSelectedMerchant] = useState<number | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [selectedWebhookEvents, setSelectedWebhookEvents] = useState<string[]>([]);
  const [disputeFilter, setDisputeFilter] = useState("all");
  const [settlementFilter, setSettlementFilter] = useState("all");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("developer");

  const utils = trpc.useUtils();
  const { data: liveMerchants, isLoading: loadingMerchants } = trpc.merchant.list.useQuery();
  const merchants = liveMerchants && liveMerchants.length > 0 ? liveMerchants : [DEMO_MERCHANT];
  const { data: liveTransactions, isLoading: loadingTransactions } = trpc.payment.listTransactions.useQuery(
    { merchantId: selectedMerchant! },
    { enabled: !!selectedMerchant }
  );
  const transactions = liveTransactions && liveTransactions.length > 0 ? liveTransactions : DEMO_TRANSACTIONS;
  const { data: liveSessions, isLoading: loadingSessions } = trpc.payment.listSessions.useQuery(
    { merchantId: selectedMerchant! },
    { enabled: !!selectedMerchant }
  );
  const sessions = liveSessions && liveSessions.length > 0 ? liveSessions : DEMO_SESSIONS;

  const createMerchant = trpc.merchant.create.useMutation({
    onSuccess: (data) => {
      toast.success("Merchant account created!");
      toast.info(`API Key: ${data.apiKey}`, { duration: 10000 });
      toast.info(`API Secret: ${data.apiSecret}`, { duration: 10000 });
      setCreateDialogOpen(false);
      setBusinessName("");
      setWebsite("");
      utils.merchant.list.invalidate();
    },
    onError: (err) => {
      toast.error(`Failed to create merchant: ${err.message}`);
    },
  });

  const regenerateApiKey = trpc.merchant.regenerateApiKey.useMutation({
    onSuccess: (data) => {
      toast.success("API credentials regenerated!");
      toast.info(`New API Key: ${data.apiKey}`, { duration: 10000 });
      toast.info(`New API Secret: ${data.apiSecret}`, { duration: 10000 });
      utils.merchant.list.invalidate();
    },
  });

  const handleCreateMerchant = (e: React.FormEvent) => {
    e.preventDefault();
    createMerchant.mutate({ businessName, businessType, website: website || undefined });
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const formatAmount = (amount: number, currency: string) => {
    return `${currency} ${(amount / 100).toFixed(2)}`;
  };

  const formatNgn = (amount: number) => `₦${amount.toLocaleString()}`;

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleString();
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      completed: "default", captured: "default", settled: "default", verified: "default",
      compliant: "default", active: "default", won: "default",
      pending: "secondary", processing: "secondary", under_review: "secondary",
      failed: "destructive", cancelled: "destructive", lost: "destructive", inactive: "destructive",
      open: "outline", expiring_soon: "outline",
    };
    const colors: Record<string, string> = {
      completed: "text-green-600", captured: "text-green-600", settled: "text-green-600",
      verified: "text-green-600", compliant: "text-green-600", active: "text-green-600", won: "text-green-600",
      pending: "text-yellow-600", processing: "text-blue-600", under_review: "text-blue-600",
      failed: "text-red-600", cancelled: "text-gray-600", lost: "text-red-600", inactive: "text-gray-600",
      open: "text-orange-600", expiring_soon: "text-yellow-600",
    };
    return (
      <Badge variant={variants[status] || "outline"} className={colors[status]}>
        {status.replace(/_/g, ' ')}
      </Badge>
    );
  };

  // Auto-select first merchant
  if (merchants && merchants.length > 0 && !selectedMerchant) {
    setSelectedMerchant(merchants[0].id);
  }

  const currentMerchant = merchants?.find(m => m.id === selectedMerchant);

  const filteredDisputes = disputeFilter === 'all' ? defaultDisputes : defaultDisputes.filter(d => d.status === disputeFilter);
  const filteredSettlements = settlementFilter === 'all' ? defaultSettlements : defaultSettlements.filter(s => s.status === settlementFilter);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Merchant Dashboard</h1>
            <p className="text-muted-foreground">Manage your payment integrations, settlements, and business operations</p>
          </div>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Create Merchant Account
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleCreateMerchant}>
                <DialogHeader>
                  <DialogTitle>Create Merchant Account</DialogTitle>
                  <DialogDescription>
                    Set up a new merchant account to start accepting payments
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="businessName">Business Name *</Label>
                    <Input id="businessName" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Acme Inc." required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="businessType">Business Type *</Label>
                    <Select value={businessType} onValueChange={(v) => setBusinessType(v as typeof businessType)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ecommerce">E-commerce</SelectItem>
                        <SelectItem value="saas">SaaS</SelectItem>
                        <SelectItem value="marketplace">Marketplace</SelectItem>
                        <SelectItem value="nonprofit">Non-profit</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="website">Website</Label>
                    <Input id="website" type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://example.com" />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createMerchant.isPending}>
                    {createMerchant.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Create Account
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {loadingMerchants ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>
        ) : (
          <>
            {/* Merchant Selector */}
            {merchants.length > 1 && (
              <Card>
                <CardHeader><CardTitle>Select Merchant</CardTitle></CardHeader>
                <CardContent>
                  <Select value={selectedMerchant?.toString()} onValueChange={(v) => setSelectedMerchant(Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {merchants.map(m => (
                        <SelectItem key={m.id} value={m.id.toString()}>{m.businessName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>
            )}

            {currentMerchant && (
              <>
                {/* API Credentials */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Key className="h-5 w-5" /> API Credentials</CardTitle>
                    <CardDescription>Use these credentials to integrate payments</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <Label>API Key</Label>
                        <div className="flex gap-2 mt-1">
                          <Input value={currentMerchant.apiKey} readOnly className="font-mono text-sm" />
                          <Button variant="outline" size="icon" onClick={() => copyToClipboard(currentMerchant.apiKey, "API Key")}>
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => regenerateApiKey.mutate({ id: currentMerchant.id })} disabled={regenerateApiKey.isPending}>
                        {regenerateApiKey.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                        Regenerate Credentials
                      </Button>
                    </div>
                    <div className="bg-muted p-4 rounded-lg">
                      <p className="text-sm font-semibold mb-2">Integration Example</p>
                      <pre className="text-xs overflow-x-auto">
{`// Create a payment session
const response = await fetch('/api/trpc/payment.createSession', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    apiKey: '${currentMerchant.apiKey}',
    amount: 5000, // $50.00 in cents
    currency: 'USD',
    successUrl: 'https://yoursite.com/success',
    cancelUrl: 'https://yoursite.com/cancel'
  })
});
const { checkoutUrl } = await response.json();
// Redirect customer to checkoutUrl`}
                      </pre>
                    </div>
                  </CardContent>
                </Card>

                {/* Main Tabs */}
                <Tabs defaultValue="analytics">
                  <TabsList className="flex flex-wrap h-auto gap-1">
                    <TabsTrigger value="analytics"><BarChart3 className="h-4 w-4 mr-1" />Analytics</TabsTrigger>
                    <TabsTrigger value="transactions">Transactions</TabsTrigger>
                    <TabsTrigger value="sessions">Sessions</TabsTrigger>
                    <TabsTrigger value="settlements"><ArrowUpDown className="h-4 w-4 mr-1" />Settlements</TabsTrigger>
                    <TabsTrigger value="disputes"><AlertTriangle className="h-4 w-4 mr-1" />Disputes</TabsTrigger>
                    <TabsTrigger value="webhooks"><Webhook className="h-4 w-4 mr-1" />Webhooks</TabsTrigger>
                    <TabsTrigger value="integration"><Activity className="h-4 w-4 mr-1" />Integration</TabsTrigger>
                    <TabsTrigger value="team"><Users className="h-4 w-4 mr-1" />Team</TabsTrigger>
                    <TabsTrigger value="compliance"><Shield className="h-4 w-4 mr-1" />Compliance</TabsTrigger>
                    <TabsTrigger value="financials"><FileText className="h-4 w-4 mr-1" />Financials</TabsTrigger>
                    <TabsTrigger value="notifications"><Bell className="h-4 w-4 mr-1" />Notifications</TabsTrigger>
                    <TabsTrigger value="branding">Branding</TabsTrigger>
                  </TabsList>

                  {/* Analytics Tab */}
                  <TabsContent value="analytics">
                    <Analytics merchantId={selectedMerchant!} />
                  </TabsContent>

                  {/* Transactions Tab */}
                  <TabsContent value="transactions">
                    <Card>
                      <CardHeader>
                        <CardTitle>Recent Transactions</CardTitle>
                        <CardDescription>View all payment transactions</CardDescription>
                      </CardHeader>
                      <CardContent>
                        {loadingTransactions ? (
                          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                        ) : !transactions || transactions.length === 0 ? (
                          <p className="text-center text-muted-foreground py-8">No transactions yet</p>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Transaction ID</TableHead>
                                <TableHead>Amount</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Payment Method</TableHead>
                                <TableHead>Date</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {transactions.map(txn => (
                                <TableRow key={txn.id}>
                                  <TableCell className="font-mono text-sm">{txn.transactionId}</TableCell>
                                  <TableCell>{formatAmount(txn.amount, txn.currency)}</TableCell>
                                  <TableCell>{getStatusBadge(txn.status)}</TableCell>
                                  <TableCell className="capitalize">{txn.paymentMethod}</TableCell>
                                  <TableCell>{formatDate(txn.createdAt)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>

                  {/* Sessions Tab */}
                  <TabsContent value="sessions">
                    <Card>
                      <CardHeader>
                        <CardTitle>Payment Sessions</CardTitle>
                        <CardDescription>View all payment sessions</CardDescription>
                      </CardHeader>
                      <CardContent>
                        {loadingSessions ? (
                          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                        ) : !sessions || sessions.length === 0 ? (
                          <p className="text-center text-muted-foreground py-8">No sessions yet</p>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Session ID</TableHead>
                                <TableHead>Amount</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Customer</TableHead>
                                <TableHead>Created</TableHead>
                                <TableHead>Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {sessions.map(session => (
                                <TableRow key={session.id}>
                                  <TableCell className="font-mono text-sm">{session.sessionId}</TableCell>
                                  <TableCell>{formatAmount(session.amount, session.currency)}</TableCell>
                                  <TableCell>{getStatusBadge(session.status)}</TableCell>
                                  <TableCell>{session.customerEmail || session.customerName || "-"}</TableCell>
                                  <TableCell>{formatDate(session.createdAt)}</TableCell>
                                  <TableCell>
                                    <Button variant="ghost" size="sm" onClick={() => window.open(`/checkout/${session.sessionId}`, '_blank')}>
                                      <ExternalLink className="h-4 w-4" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>

                  {/* Settlements Tab */}
                  <TabsContent value="settlements">
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <Card><CardContent className="p-4 text-center">
                          <CheckCircle2 className="h-6 w-6 mx-auto text-green-500 mb-1" />
                          <p className="text-2xl font-bold">{defaultSettlements.filter(s => s.status === 'settled').length}</p>
                          <p className="text-xs text-muted-foreground">Settled</p>
                        </CardContent></Card>
                        <Card><CardContent className="p-4 text-center">
                          <Clock className="h-6 w-6 mx-auto text-blue-500 mb-1" />
                          <p className="text-2xl font-bold">{defaultSettlements.filter(s => s.status === 'processing').length}</p>
                          <p className="text-xs text-muted-foreground">Processing</p>
                        </CardContent></Card>
                        <Card><CardContent className="p-4 text-center">
                          <p className="text-lg font-bold">{formatNgn(defaultSettlements.reduce((sum, s) => sum + s.netAmount, 0))}</p>
                          <p className="text-xs text-muted-foreground">Total Net Settled</p>
                        </CardContent></Card>
                        <Card><CardContent className="p-4 text-center">
                          <p className="text-lg font-bold">{defaultSettlements.reduce((sum, s) => sum + s.transactions, 0)}</p>
                          <p className="text-xs text-muted-foreground">Total Transactions</p>
                        </CardContent></Card>
                      </div>
                      <div className="flex gap-1 mb-2">
                        {["all", "settled", "processing", "failed"].map(s => (
                          <Button key={s} variant={settlementFilter === s ? "default" : "outline"} size="sm" onClick={() => setSettlementFilter(s)}>
                            {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                          </Button>
                        ))}
                      </div>
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2"><ArrowUpDown className="h-5 w-5" /> Settlement History</CardTitle>
                          <CardDescription>Track your payouts and settlement status</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Settlement ID</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead>Bank</TableHead>
                                <TableHead className="text-right">Gross</TableHead>
                                <TableHead className="text-right">Fees</TableHead>
                                <TableHead className="text-right">Net</TableHead>
                                <TableHead className="text-right">Txns</TableHead>
                                <TableHead>Status</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {filteredSettlements.map(s => (
                                <TableRow key={s.id}>
                                  <TableCell className="font-mono text-sm">{s.id}</TableCell>
                                  <TableCell>{s.date}</TableCell>
                                  <TableCell>{s.bankName} ({s.accountNumber})</TableCell>
                                  <TableCell className="text-right">{formatNgn(s.grossAmount)}</TableCell>
                                  <TableCell className="text-right text-muted-foreground">{formatNgn(s.fees)}</TableCell>
                                  <TableCell className="text-right font-medium">{formatNgn(s.netAmount)}</TableCell>
                                  <TableCell className="text-right">{s.transactions}</TableCell>
                                  <TableCell>{getStatusBadge(s.status)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </CardContent>
                      </Card>
                    </div>
                  </TabsContent>

                  {/* Disputes Tab */}
                  <TabsContent value="disputes">
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <Card><CardContent className="p-4 text-center">
                          <AlertTriangle className="h-6 w-6 mx-auto text-orange-500 mb-1" />
                          <p className="text-2xl font-bold">{defaultDisputes.filter(d => d.status === 'open').length}</p>
                          <p className="text-xs text-muted-foreground">Open</p>
                        </CardContent></Card>
                        <Card><CardContent className="p-4 text-center">
                          <Clock className="h-6 w-6 mx-auto text-blue-500 mb-1" />
                          <p className="text-2xl font-bold">{defaultDisputes.filter(d => d.status === 'under_review').length}</p>
                          <p className="text-xs text-muted-foreground">Under Review</p>
                        </CardContent></Card>
                        <Card><CardContent className="p-4 text-center">
                          <CheckCircle2 className="h-6 w-6 mx-auto text-green-500 mb-1" />
                          <p className="text-2xl font-bold">{defaultDisputes.filter(d => d.status === 'won').length}</p>
                          <p className="text-xs text-muted-foreground">Won</p>
                        </CardContent></Card>
                        <Card><CardContent className="p-4 text-center">
                          <XCircle className="h-6 w-6 mx-auto text-red-500 mb-1" />
                          <p className="text-2xl font-bold">{defaultDisputes.filter(d => d.status === 'lost').length}</p>
                          <p className="text-xs text-muted-foreground">Lost</p>
                        </CardContent></Card>
                      </div>
                      <div className="flex gap-1 mb-2">
                        {["all", "open", "under_review", "won", "lost"].map(s => (
                          <Button key={s} variant={disputeFilter === s ? "default" : "outline"} size="sm" onClick={() => setDisputeFilter(s)}>
                            {s === "all" ? "All" : s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                          </Button>
                        ))}
                      </div>
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5" /> Dispute Management</CardTitle>
                          <CardDescription>Respond to chargebacks and customer disputes</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Dispute ID</TableHead>
                                <TableHead>Transaction</TableHead>
                                <TableHead>Amount</TableHead>
                                <TableHead>Reason</TableHead>
                                <TableHead>Customer</TableHead>
                                <TableHead>Due Date</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {filteredDisputes.map(d => (
                                <TableRow key={d.id}>
                                  <TableCell className="font-mono text-sm">{d.id}</TableCell>
                                  <TableCell className="font-mono text-sm">{d.transactionId}</TableCell>
                                  <TableCell>{formatNgn(d.amount)}</TableCell>
                                  <TableCell className="max-w-[200px] truncate">{d.reason}</TableCell>
                                  <TableCell>{d.customerEmail}</TableCell>
                                  <TableCell>{d.dueDate}</TableCell>
                                  <TableCell>{getStatusBadge(d.status)}</TableCell>
                                  <TableCell>
                                    {(d.status === 'open' || d.status === 'under_review') && (
                                      <Button variant="outline" size="sm"><Send className="h-3 w-3 mr-1" /> Respond</Button>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </CardContent>
                      </Card>
                    </div>
                  </TabsContent>

                  {/* Webhooks Tab */}
                  <TabsContent value="webhooks">
                    <div className="space-y-4">
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2"><Webhook className="h-5 w-5" /> Webhook Endpoints</CardTitle>
                          <CardDescription>Configure webhook URLs to receive real-time event notifications</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          {defaultWebhooks.map(wh => (
                            <div key={wh.id} className="border rounded-lg p-4 space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  {getStatusBadge(wh.status)}
                                  <code className="text-sm bg-muted px-2 py-1 rounded">{wh.url}</code>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground">Success: {wh.successRate}%</span>
                                  <Button variant="ghost" size="sm"><Eye className="h-4 w-4" /></Button>
                                  <Button variant="ghost" size="sm"><Trash2 className="h-4 w-4 text-red-500" /></Button>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {wh.events.map(e => (
                                  <Badge key={e} variant="secondary" className="text-xs">{e}</Badge>
                                ))}
                              </div>
                              <p className="text-xs text-muted-foreground">Last delivery: {wh.lastDelivery}</p>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader>
                          <CardTitle>Add Webhook Endpoint</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="space-y-2">
                            <Label>Endpoint URL</Label>
                            <Input placeholder="https://api.yoursite.com/webhooks" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} />
                          </div>
                          <div className="space-y-2">
                            <Label>Events to Subscribe</Label>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                              {WEBHOOK_EVENTS.map(event => (
                                <label key={event} className="flex items-center gap-2 text-sm cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={selectedWebhookEvents.includes(event)}
                                    onChange={e => {
                                      if (e.target.checked) setSelectedWebhookEvents(prev => [...prev, event]);
                                      else setSelectedWebhookEvents(prev => prev.filter(ev => ev !== event));
                                    }}
                                    className="rounded"
                                  />
                                  <code className="text-xs">{event}</code>
                                </label>
                              ))}
                            </div>
                          </div>
                          <Button disabled={!webhookUrl || selectedWebhookEvents.length === 0} onClick={() => { toast.success("Webhook endpoint added"); setWebhookUrl(""); setSelectedWebhookEvents([]); }}>
                            <Plus className="h-4 w-4 mr-2" /> Add Endpoint
                          </Button>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader>
                          <CardTitle>Webhook Delivery Stats</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="grid grid-cols-4 gap-4">
                            <div className="text-center"><p className="text-2xl font-bold">{defaultIntegrationHealth.webhookDelivery.total}</p><p className="text-xs text-muted-foreground">Total Deliveries</p></div>
                            <div className="text-center"><p className="text-2xl font-bold text-green-600">{defaultIntegrationHealth.webhookDelivery.successful}</p><p className="text-xs text-muted-foreground">Successful</p></div>
                            <div className="text-center"><p className="text-2xl font-bold text-red-600">{defaultIntegrationHealth.webhookDelivery.failed}</p><p className="text-xs text-muted-foreground">Failed</p></div>
                            <div className="text-center"><p className="text-2xl font-bold text-yellow-600">{defaultIntegrationHealth.webhookDelivery.retrying}</p><p className="text-xs text-muted-foreground">Retrying</p></div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </TabsContent>

                  {/* Integration Health Tab */}
                  <TabsContent value="integration">
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <Card><CardContent className="p-4 text-center">
                          <Zap className="h-6 w-6 mx-auto text-blue-500 mb-1" />
                          <p className="text-2xl font-bold">{defaultIntegrationHealth.apiLatency.p50}ms</p>
                          <p className="text-xs text-muted-foreground">API Latency (p50)</p>
                        </CardContent></Card>
                        <Card><CardContent className="p-4 text-center">
                          <CheckCircle2 className="h-6 w-6 mx-auto text-green-500 mb-1" />
                          <p className="text-2xl font-bold">{defaultIntegrationHealth.successRate}%</p>
                          <p className="text-xs text-muted-foreground">Success Rate</p>
                        </CardContent></Card>
                        <Card><CardContent className="p-4 text-center">
                          <Activity className="h-6 w-6 mx-auto text-purple-500 mb-1" />
                          <p className="text-2xl font-bold">{defaultIntegrationHealth.totalApiCalls24h.toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground">API Calls (24h)</p>
                        </CardContent></Card>
                        <Card><CardContent className="p-4 text-center">
                          <TrendingUp className="h-6 w-6 mx-auto text-emerald-500 mb-1" />
                          <p className="text-2xl font-bold">{defaultIntegrationHealth.uptimePercent}%</p>
                          <p className="text-xs text-muted-foreground">Uptime</p>
                        </CardContent></Card>
                      </div>
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" /> API Latency Breakdown</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="grid grid-cols-3 gap-6">
                            <div className="text-center border rounded-lg p-4">
                              <p className="text-3xl font-bold text-green-600">{defaultIntegrationHealth.apiLatency.p50}ms</p>
                              <p className="text-sm text-muted-foreground">p50 (median)</p>
                            </div>
                            <div className="text-center border rounded-lg p-4">
                              <p className="text-3xl font-bold text-yellow-600">{defaultIntegrationHealth.apiLatency.p95}ms</p>
                              <p className="text-sm text-muted-foreground">p95</p>
                            </div>
                            <div className="text-center border rounded-lg p-4">
                              <p className="text-3xl font-bold text-red-600">{defaultIntegrationHealth.apiLatency.p99}ms</p>
                              <p className="text-sm text-muted-foreground">p99</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader>
                          <CardTitle>Recent API Errors</CardTitle>
                          <CardDescription>Last 24 hours</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Timestamp</TableHead>
                                <TableHead>Endpoint</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Message</TableHead>
                                <TableHead className="text-right">Count</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {defaultIntegrationHealth.recentErrors.map((err, idx) => (
                                <TableRow key={idx}>
                                  <TableCell className="text-sm">{err.timestamp}</TableCell>
                                  <TableCell className="font-mono text-sm">{err.endpoint}</TableCell>
                                  <TableCell><Badge variant="destructive">{err.statusCode}</Badge></TableCell>
                                  <TableCell>{err.message}</TableCell>
                                  <TableCell className="text-right">{err.count}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </CardContent>
                      </Card>
                    </div>
                  </TabsContent>

                  {/* Team Tab */}
                  <TabsContent value="team">
                    <div className="space-y-4">
                      <Card>
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <div>
                              <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> Team Members</CardTitle>
                              <CardDescription>Manage team access and API key assignments</CardDescription>
                            </div>
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Invite Member</Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Invite Team Member</DialogTitle>
                                  <DialogDescription>Send an invitation to join your merchant account</DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4 py-4">
                                  <div className="space-y-2">
                                    <Label>Email Address</Label>
                                    <Input placeholder="team@merchant.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
                                  </div>
                                  <div className="space-y-2">
                                    <Label>Role</Label>
                                    <Select value={inviteRole} onValueChange={setInviteRole}>
                                      <SelectTrigger><SelectValue /></SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="admin">Admin</SelectItem>
                                        <SelectItem value="developer">Developer</SelectItem>
                                        <SelectItem value="finance">Finance</SelectItem>
                                        <SelectItem value="support">Support</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                                <DialogFooter>
                                  <Button onClick={() => { toast.success(`Invitation sent to ${inviteEmail}`); setInviteEmail(""); }}>
                                    <Send className="h-4 w-4 mr-2" /> Send Invite
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Email</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Last Login</TableHead>
                                <TableHead>API Keys</TableHead>
                                <TableHead>Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {defaultTeamMembers.map(m => (
                                <TableRow key={m.id}>
                                  <TableCell className="font-medium">{m.name}</TableCell>
                                  <TableCell className="text-sm">{m.email}</TableCell>
                                  <TableCell>
                                    <Badge variant={m.role === 'owner' ? 'default' : 'secondary'}>{m.role}</Badge>
                                  </TableCell>
                                  <TableCell>{getStatusBadge(m.status)}</TableCell>
                                  <TableCell className="text-sm">{m.lastLogin}</TableCell>
                                  <TableCell>{m.apiKeyCount}</TableCell>
                                  <TableCell>
                                    {m.role !== 'owner' && (
                                      <Button variant="ghost" size="sm"><Settings className="h-4 w-4" /></Button>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </CardContent>
                      </Card>
                    </div>
                  </TabsContent>

                  {/* Compliance Tab */}
                  <TabsContent value="compliance">
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <Card><CardContent className="p-4">
                          <div className="flex items-center gap-2 mb-2"><Shield className="h-5 w-5 text-green-500" /><span className="text-sm font-medium">KYC Status</span></div>
                          {getStatusBadge(defaultCompliance.kycStatus)}
                          <p className="text-xs text-muted-foreground mt-1">Verified: {defaultCompliance.kycVerifiedDate}</p>
                        </CardContent></Card>
                        <Card><CardContent className="p-4">
                          <div className="flex items-center gap-2 mb-2"><ShieldCheck className="h-5 w-5 text-green-500" /><span className="text-sm font-medium">KYB Status</span></div>
                          {getStatusBadge(defaultCompliance.kybStatus)}
                          <p className="text-xs text-muted-foreground mt-1">Verified: {defaultCompliance.kybVerifiedDate}</p>
                        </CardContent></Card>
                        <Card><CardContent className="p-4">
                          <div className="flex items-center gap-2 mb-2"><Lock className="h-5 w-5 text-blue-500" /><span className="text-sm font-medium">AML/CFT</span></div>
                          {getStatusBadge(defaultCompliance.amlStatus)}
                          <p className="text-xs text-muted-foreground mt-1">Last check: {defaultCompliance.lastAmlCheck}</p>
                        </CardContent></Card>
                        <Card><CardContent className="p-4">
                          <div className="flex items-center gap-2 mb-2"><Globe className="h-5 w-5 text-purple-500" /><span className="text-sm font-medium">PCI DSS</span></div>
                          <Badge>{defaultCompliance.pciDssLevel}</Badge>
                          <p className="text-xs text-muted-foreground mt-1">Expires: {defaultCompliance.pciExpiry}</p>
                        </CardContent></Card>
                      </div>
                      <Card>
                        <CardHeader>
                          <CardTitle>Compliance Documents</CardTitle>
                          <CardDescription>Required regulatory documents and their verification status</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Document</TableHead>
                                <TableHead>Upload Date</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {defaultCompliance.documents.map((doc, idx) => (
                                <TableRow key={idx}>
                                  <TableCell className="font-medium">{doc.name}</TableCell>
                                  <TableCell>{doc.uploadDate}</TableCell>
                                  <TableCell>{getStatusBadge(doc.status)}</TableCell>
                                  <TableCell>
                                    <div className="flex gap-1">
                                      <Button variant="ghost" size="sm"><Eye className="h-4 w-4" /></Button>
                                      <Button variant="ghost" size="sm"><Download className="h-4 w-4" /></Button>
                                      {doc.status === 'expiring_soon' && (
                                        <Button variant="outline" size="sm" className="text-yellow-600"><RefreshCw className="h-3 w-3 mr-1" /> Renew</Button>
                                      )}
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </CardContent>
                      </Card>
                    </div>
                  </TabsContent>

                  {/* Financials Tab */}
                  <TabsContent value="financials">
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        <Card className="bg-gradient-to-br from-emerald-600 to-emerald-500 text-white border-0">
                          <CardContent className="p-6">
                            <p className="text-sm opacity-90 mb-2">Revenue (This Month)</p>
                            <p className="text-3xl font-extrabold">{formatNgn(defaultFinancials.currentMonth.revenue)}</p>
                            <p className="text-xs opacity-80 mt-1 flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" /> +{defaultFinancials.growth}% from last month</p>
                          </CardContent>
                        </Card>
                        <Card className="bg-gradient-to-br from-blue-600 to-blue-500 text-white border-0">
                          <CardContent className="p-6">
                            <p className="text-sm opacity-90 mb-2">Net Revenue</p>
                            <p className="text-3xl font-extrabold">{formatNgn(defaultFinancials.currentMonth.netRevenue)}</p>
                            <p className="text-xs opacity-80 mt-1">{defaultFinancials.currentMonth.transactions} transactions</p>
                          </CardContent>
                        </Card>
                        <Card className="bg-gradient-to-br from-violet-600 to-violet-500 text-white border-0">
                          <CardContent className="p-6">
                            <p className="text-sm opacity-90 mb-2">Last Month</p>
                            <p className="text-3xl font-extrabold">{formatNgn(defaultFinancials.lastMonth.revenue)}</p>
                            <p className="text-xs opacity-80 mt-1">{defaultFinancials.lastMonth.transactions} transactions</p>
                          </CardContent>
                        </Card>
                      </div>
                      <Card>
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <div>
                              <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Financial Summary</CardTitle>
                              <CardDescription>Current month breakdown</CardDescription>
                            </div>
                            <Button variant="outline" size="sm"><Download className="h-4 w-4 mr-2" /> Export Report</Button>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            <div className="flex justify-between items-center py-2 border-b">
                              <span className="text-sm">Gross Revenue</span>
                              <span className="font-medium">{formatNgn(defaultFinancials.currentMonth.revenue)}</span>
                            </div>
                            <div className="flex justify-between items-center py-2 border-b">
                              <span className="text-sm text-muted-foreground">Platform Fees</span>
                              <span className="text-red-600">-{formatNgn(defaultFinancials.currentMonth.fees)}</span>
                            </div>
                            <div className="flex justify-between items-center py-2 border-b">
                              <span className="text-sm text-muted-foreground">Refunds</span>
                              <span className="text-red-600">-{formatNgn(defaultFinancials.currentMonth.refunds)}</span>
                            </div>
                            <div className="flex justify-between items-center py-2 border-b">
                              <span className="text-sm text-muted-foreground">Chargebacks</span>
                              <span className="text-red-600">-{formatNgn(defaultFinancials.currentMonth.chargebacks)}</span>
                            </div>
                            <div className="flex justify-between items-center py-2 font-bold text-lg">
                              <span>Net Revenue</span>
                              <span className="text-green-600">{formatNgn(defaultFinancials.currentMonth.netRevenue)}</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader>
                          <CardTitle>Monthly Revenue Trend</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="flex items-end gap-3 h-40">
                            {defaultFinancials.monthlyRevenue.map(m => {
                              const maxRev = Math.max(...defaultFinancials.monthlyRevenue.map(r => r.revenue));
                              const height = (m.revenue / maxRev) * 100;
                              return (
                                <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                                  <span className="text-xs font-medium">{formatNgn(m.revenue / 1000000)}M</span>
                                  <div className="w-full bg-primary/80 rounded-t" style={{ height: `${height}%` }} />
                                  <span className="text-xs text-muted-foreground">{m.month}</span>
                                </div>
                              );
                            })}
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </TabsContent>

                  {/* Notifications Tab */}
                  <TabsContent value="notifications">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2"><Bell className="h-5 w-5" /> Notification Preferences</CardTitle>
                        <CardDescription>Configure how you receive alerts for important merchant events</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Event</TableHead>
                              <TableHead className="text-center">Email</TableHead>
                              <TableHead className="text-center">SMS</TableHead>
                              <TableHead className="text-center">Push</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {defaultNotificationPrefs.map((pref, idx) => (
                              <TableRow key={idx}>
                                <TableCell className="font-medium">{pref.event}</TableCell>
                                <TableCell className="text-center">
                                  <input type="checkbox" defaultChecked={pref.email} className="rounded" />
                                </TableCell>
                                <TableCell className="text-center">
                                  <input type="checkbox" defaultChecked={pref.sms} className="rounded" />
                                </TableCell>
                                <TableCell className="text-center">
                                  <input type="checkbox" defaultChecked={pref.push} className="rounded" />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        <div className="mt-4 flex justify-end">
                          <Button onClick={() => toast.success("Notification preferences saved")}>
                            Save Preferences
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  {/* Branding Tab */}
                  <TabsContent value="branding">
                    <BrandingSettings />
                  </TabsContent>
                </Tabs>
              </>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
