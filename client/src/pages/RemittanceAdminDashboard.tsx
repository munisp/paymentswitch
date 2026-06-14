import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { trpc } from '@/lib/trpc';
import { TransactionExport } from '@/components/TransactionExport';
import { toast } from 'sonner';
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Clock,
  DollarSign,
  Download,
  Filter,
  Loader2,
  MoreVertical,
  RefreshCw,
  Search,
  TrendingUp,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';

export default function RemittanceAdminDashboard() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="container py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Remittance Management</h1>
              <p className="text-muted-foreground mt-1">
                Monitor and manage crypto-to-fiat remittance transactions
              </p>
            </div>
            <Button>
              <Download className="w-4 h-4 mr-2" />
              Export Report
            </Button>
          </div>
        </div>
      </div>

      <div className="container py-8">
        {/* Stats Overview */}
        <StatsOverview />

        {/* Main Dashboard */}
        <Tabs defaultValue="transactions" className="mt-8">
          <TabsList>
            <TabsTrigger value="transactions">
              <Wallet className="w-4 h-4 mr-2" />
              Transactions
            </TabsTrigger>
            <TabsTrigger value="analytics">
              <BarChart3 className="w-4 h-4 mr-2" />
              Analytics
            </TabsTrigger>
            <TabsTrigger value="webhooks">
              <Activity className="w-4 h-4 mr-2" />
              Webhooks
            </TabsTrigger>
          </TabsList>

          <TabsContent value="transactions" className="mt-6">
            <div className="space-y-6">
              <TransactionExport />
              <TransactionsList />
            </div>
          </TabsContent>

          <TabsContent value="analytics" className="mt-6">
            <AnalyticsDashboard />
          </TabsContent>

          <TabsContent value="webhooks" className="mt-6">
            <WebhookLogs />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/**
 * Stats Overview Component
 */
function StatsOverview() {
  const isLoading = false;
  
  const stats = {
    totalVolume: 0,
    totalTransactions: 0,
    successRate: 0,
    avgProcessingTime: 0,
    pendingCount: 0,
    completedToday: 0,
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <div className="animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-24 mb-2"></div>
                <div className="h-8 bg-gray-200 rounded w-32 mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-20"></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Volume</p>
              <p className="text-2xl font-bold mt-1">
                ₦{stats.totalVolume.toLocaleString()}
              </p>
              <p className="text-xs text-green-600 mt-1 flex items-center">
                <TrendingUp className="w-3 h-3 mr-1" />
                +12.5% from last month
              </p>
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
              <DollarSign className="w-6 h-6 text-blue-600" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Transactions</p>
              <p className="text-2xl font-bold mt-1">{stats.totalTransactions}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {stats.completedToday} completed today
              </p>
            </div>
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
              <Wallet className="w-6 h-6 text-green-600" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Success Rate</p>
              <p className="text-2xl font-bold mt-1">{stats.successRate}%</p>
              <p className="text-xs text-green-600 mt-1">
                Excellent performance
              </p>
            </div>
            <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-purple-600" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Avg. Time</p>
              <p className="text-2xl font-bold mt-1">{stats.avgProcessingTime}m</p>
              <p className="text-xs text-muted-foreground mt-1">
                {stats.pendingCount} pending
              </p>
            </div>
            <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
              <Clock className="w-6 h-6 text-orange-600" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Transactions List Component
 */
function TransactionsList() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedRemittance, setSelectedRemittance] = useState<string | null>(null);

  const { data: transactionsData, isLoading, refetch } = trpc.remittance.listRemittances.useQuery({
    status: statusFilter !== 'all' ? statusFilter as "pending" | "processing" | "completed" | "failed" | "cancelled" : undefined,
    limit: 50,
  });

  const transactions = transactionsData?.remittances || [];

  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      completed: 'default',
      processing: 'secondary',
      failed: 'destructive',
      pending: 'outline',
    };

    const icons: Record<string, any> = {
      completed: <CheckCircle2 className="w-3 h-3 mr-1" />,
      processing: <Clock className="w-3 h-3 mr-1" />,
      failed: <XCircle className="w-3 h-3 mr-1" />,
      pending: <Clock className="w-3 h-3 mr-1" />,
    };

    return (
      <Badge variant={variants[status]} className="flex items-center w-fit">
        {icons[status]}
        {status}
      </Badge>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>All Transactions</CardTitle>
            <CardDescription>View and manage remittance transactions</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by ID or phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 w-64"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Remittance ID</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Amount Sent</TableHead>
              <TableHead>Amount Received</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((tx) => (
              <TableRow key={tx.remittanceId}>
                <TableCell className="font-mono text-sm">
                  {tx.remittanceId}
                </TableCell>
                <TableCell>{getStatusBadge(tx.status)}</TableCell>
                <TableCell>
                  {tx.senderAmount} {tx.senderCurrency}
                </TableCell>
                <TableCell>₦{(tx as any).recipientAmount?.toLocaleString() ?? 'N/A'}</TableCell>
                <TableCell>{(tx as any).recipientPhone ?? 'N/A'}</TableCell>
                <TableCell>
                  {new Date(tx.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => setSelectedRemittance(tx.remittanceId)}
                      >
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>Transaction Details</DialogTitle>
                        <DialogDescription>
                          Remittance ID: {tx.remittanceId}
                        </DialogDescription>
                      </DialogHeader>
                      <TransactionDetails remittanceId={tx.remittanceId} />
                    </DialogContent>
                  </Dialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/**
 * Transaction Details Component
 */
function TransactionDetails({ remittanceId }: { remittanceId: string }) {
  const { data: remittanceData } = trpc.remittance.getRemittance.useQuery({ remittanceId });
  const retryMutation = { mutateAsync: async (_input: { remittanceId: string }) => ({} as any), isPending: false };
  const cancelMutation = { mutateAsync: async (_input: { remittanceId: string }) => ({} as any), isPending: false };

  const statusMessages: Record<string, string> = {
    created: 'Remittance created',
    waiting_payment: 'Waiting for crypto payment',
    payment_received: 'Crypto payment received',
    converting: 'Converting crypto to fiat',
    transferring: 'Transferring to bank account',
    completed: 'Transfer completed successfully',
    failed: 'Transfer failed',
    cancelled: 'Remittance cancelled',
  };

  const timeline = (remittanceData as any)?.timeline || [
    { status: remittanceData?.status || 'created', timestamp: remittanceData?.createdAt || new Date().toISOString(), message: statusMessages[remittanceData?.status || 'created'] || 'Processing' },
  ];

  return (
    <div className="space-y-6">
      {/* Timeline */}
      <div>
        <h3 className="font-semibold mb-4">Transaction Timeline</h3>
        <div className="space-y-4">
          {timeline.map((event: any, index: number) => (
            <div key={index} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  index === timeline.length - 1 ? 'bg-green-100' : 'bg-gray-100'
                }`}>
                  {index === timeline.length - 1 ? (
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                  ) : (
                    <Clock className="w-4 h-4 text-gray-400" />
                  )}
                </div>
                {index < timeline.length - 1 && (
                  <div className="w-0.5 h-8 bg-gray-200" />
                )}
              </div>
              <div className="flex-1 pb-4">
                <p className="font-medium">{event.message}</p>
                <p className="text-sm text-muted-foreground">
                  {event.timestamp.toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Separator />

      {/* Actions */}
      <div className="flex gap-2">
        <Button variant="outline" size="sm">
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
        <Button variant="outline" size="sm">
          <XCircle className="w-4 h-4 mr-2" />
          Cancel
        </Button>
        <Button variant="outline" size="sm">
          <Download className="w-4 h-4 mr-2" />
          Export
        </Button>
      </div>
    </div>
  );
}

/**
 * Analytics Dashboard Component
 */
function AnalyticsDashboard() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Volume by Currency</CardTitle>
          <CardDescription>Distribution of crypto currencies</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[
              { currency: 'USDC', volume: 1200000, percentage: 48 },
              { currency: 'USDT', volume: 750000, percentage: 30 },
              { currency: 'BTC', volume: 350000, percentage: 14 },
              { currency: 'ETH', volume: 200000, percentage: 8 },
            ].map((item) => (
              <div key={item.currency}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">{item.currency}</span>
                  <span className="text-sm text-muted-foreground">
                    ₦{item.volume.toLocaleString()} ({item.percentage}%)
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full"
                    style={{ width: `${item.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Success Rate by Delivery Option</CardTitle>
          <CardDescription>Performance by delivery method</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[
              { option: 'Existing Account', success: 99.2, total: 856 },
              { option: 'New Account', success: 97.5, total: 234 },
              { option: 'Agent Cash', success: 98.8, total: 89 },
              { option: 'Bill Payment', success: 99.5, total: 55 },
            ].map((item) => (
              <div key={item.option} className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{item.option}</p>
                  <p className="text-sm text-muted-foreground">{item.total} transactions</p>
                </div>
                <Badge variant={item.success > 98 ? 'default' : 'secondary'}>
                  {item.success}%
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Processing Time Distribution</CardTitle>
          <CardDescription>Average time by workflow step</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { step: 'Payment Confirmation', time: '15m', color: 'bg-blue-100 text-blue-700' },
              { step: 'Crypto Conversion', time: '5m', color: 'bg-green-100 text-green-700' },
              { step: 'KYC Verification', time: '20m', color: 'bg-purple-100 text-purple-700' },
              { step: 'Bank Transfer', time: '5m', color: 'bg-orange-100 text-orange-700' },
            ].map((item) => (
              <div key={item.step} className={`p-4 rounded-lg ${item.color}`}>
                <p className="text-sm font-medium mb-1">{item.step}</p>
                <p className="text-2xl font-bold">{item.time}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Webhook Logs Component
 */
function WebhookLogs() {
  const isLoading = false;
  const refetch = () => {};
  const retryWebhookMutation = { mutateAsync: async (_input: { webhookId: string }) => ({} as any), isPending: false };

  const webhooks: any[] = [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhook Delivery Logs</CardTitle>
        <CardDescription>Monitor webhook event delivery status</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead>Remittance ID</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Timestamp</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {webhooks.map((webhook: any) => (
              <TableRow key={webhook.id}>
                <TableCell className="font-mono text-sm">
                  {webhook.event}
                </TableCell>
                <TableCell className="font-mono text-sm">
                  {webhook.remittanceId}
                </TableCell>
                <TableCell>
                  <Badge variant={webhook.status === 'delivered' ? 'default' : 'destructive'}>
                    {webhook.status}
                  </Badge>
                </TableCell>
                <TableCell>{webhook.attempts}</TableCell>
                <TableCell>{webhook.timestamp.toLocaleString()}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm">
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
