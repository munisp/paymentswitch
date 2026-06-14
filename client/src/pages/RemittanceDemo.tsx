import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';
import { 
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BellPlus,
  Bitcoin, 
  Building2, 
  CheckCircle2, 
  Clock, 
  CreditCard, 
  DollarSign, 
  Loader2,
  MapPin,
  Receipt,
  RefreshCw, 
  Shield,
  Smartphone,
  TrendingUp,
  Wallet,
  XCircle
} from 'lucide-react';

const log = createLogger('RemittanceDemo');

export default function RemittanceDemo() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="container py-8">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
            Crypto Remittance Demo
          </h1>
          <p className="text-muted-foreground">
            Test the complete USA → Nigeria remittance flow
          </p>
        </div>

        {/* Main Demo Tabs */}
        <Tabs defaultValue="calculator" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 lg:grid-cols-8">
            <TabsTrigger value="calculator">
              <DollarSign className="w-4 h-4 mr-2" />
              Calculator
            </TabsTrigger>
            <TabsTrigger value="remittance">
              <CreditCard className="w-4 h-4 mr-2" />
              Send Money
            </TabsTrigger>
            <TabsTrigger value="agent">
              <MapPin className="w-4 h-4 mr-2" />
              Agent Cash
            </TabsTrigger>
            <TabsTrigger value="bills">
              <Receipt className="w-4 h-4 mr-2" />
              Bill Payment
            </TabsTrigger>
            <TabsTrigger value="mobile">
              <Smartphone className="w-4 h-4 mr-2" />
              Mobile Money
            </TabsTrigger>
            <TabsTrigger value="verify">
              <Building2 className="w-4 h-4 mr-2" />
              Verify Account
            </TabsTrigger>
            <TabsTrigger value="kyc">
              <Shield className="w-4 h-4 mr-2" />
              KYC
            </TabsTrigger>
            <TabsTrigger value="track">
              <Clock className="w-4 h-4 mr-2" />
              Track
            </TabsTrigger>
          </TabsList>

          {/* Exchange Rate Calculator */}
          <TabsContent value="calculator" className="space-y-6">
            <ExchangeRateCalculator />
            <RateAlertWidget />
            <RateComparison />
          </TabsContent>

          {/* Create Remittance */}
          <TabsContent value="remittance">
            <CreateRemittance />
          </TabsContent>

          {/* Agent Cash Pickup */}
          <TabsContent value="agent">
            <AgentCashDemo />
          </TabsContent>

          {/* Bill Payment */}
          <TabsContent value="bills">
            <BillPaymentDemo />
          </TabsContent>

          {/* Mobile Money */}
          <TabsContent value="mobile">
            <MobileMoneyDemo />
          </TabsContent>

          {/* Bank Account Verification */}
          <TabsContent value="verify">
            <BankAccountVerifier />
          </TabsContent>

          {/* KYC Simulator */}
          <TabsContent value="kyc">
            <KYCSimulator />
          </TabsContent>

          {/* Payment Tracker */}
          <TabsContent value="tracker">
            <PaymentTracker />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/**
 * Exchange Rate Calculator Component
 */
function ExchangeRateCalculator() {
  const [fromCurrency, setFromCurrency] = useState<'BTC' | 'ETH' | 'USDC' | 'USDT'>('USDC');
  const [amount, setAmount] = useState('500');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [refreshInterval, setRefreshInterval] = useState(30); // seconds

  const { data: rate, isLoading, refetch } = trpc.remittance.getExchangeRate.useQuery(
    {
      fromCurrency,
      toCurrency: 'NGN',
      amount: parseFloat(amount) || 0,
    },
    { 
      enabled: !!amount && parseFloat(amount) > 0,
      refetchInterval: autoRefresh ? refreshInterval * 1000 : false,
    }
  );

  // Update last updated timestamp when rate changes
  useEffect(() => {
    if (rate) {
      setLastUpdated(new Date());
    }
  }, [rate]);

  const { data: supportedCryptos } = trpc.remittance.getSupportedCryptocurrencies.useQuery();

  // Format time ago
  const getTimeAgo = () => {
    const seconds = Math.floor((new Date().getTime() - lastUpdated.getTime()) / 1000);
    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  };

  // Auto-update time ago display
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="w-5 h-5" />
          Exchange Rate Calculator
        </CardTitle>
        <CardDescription>
          Get real-time exchange rates for crypto to Nigerian Naira
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>From Currency</Label>
            <Select value={fromCurrency} onValueChange={(v: any) => setFromCurrency(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BTC">Bitcoin (BTC)</SelectItem>
                <SelectItem value="ETH">Ethereum (ETH)</SelectItem>
                <SelectItem value="USDC">USD Coin (USDC)</SelectItem>
                <SelectItem value="USDT">Tether (USDT)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Amount</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount"
              min="0"
              step="0.01"
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground">Auto-refresh</Label>
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                autoRefresh ? 'bg-primary' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  autoRefresh ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className="text-xs text-muted-foreground">
              {autoRefresh ? `Every ${refreshInterval}s` : 'Paused'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            Updated {getTimeAgo()}
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span className="ml-2 text-sm text-muted-foreground">Fetching latest rates...</span>
          </div>
        )}

        {rate && (
          <div className="space-y-4">
            <Separator />
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Exchange Rate</p>
                <p className="text-2xl font-bold">
                  1 {rate.fromCurrency} = ₦{rate.exchangeRate.toLocaleString()}
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">You Send</p>
                <p className="text-2xl font-bold">
                  {rate.amount} {rate.fromCurrency}
                </p>
              </div>
            </div>

            <Card className="bg-gradient-to-r from-green-50 to-emerald-50 border-green-200">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Recipient Gets</p>
                    <p className="text-3xl font-bold text-green-700">
                      ₦{rate.estimatedRecipientAmount.toLocaleString()}
                    </p>
                  </div>
                  <CheckCircle2 className="w-12 h-12 text-green-600" />
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Platform Fee</p>
                <p className="font-semibold">₦{rate.fee.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Total Cost</p>
                <p className="font-semibold">{rate.totalCost} {rate.fromCurrency}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Rate Expires</p>
                <p className="font-semibold">
                  {new Date(rate.expiresAt).toLocaleTimeString()}
                </p>
              </div>
            </div>

            <Button onClick={() => refetch()} variant="outline" className="w-full">
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh Rate
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Multi-Currency Rate Comparison Component
 */
function RateComparison() {
  const [amount, setAmount] = useState('500');
  const parsedAmount = parseFloat(amount) || 0;
  const [previousRates, setPreviousRates] = useState<Record<string, number>>({});

  // Fetch rates for all cryptocurrencies
  const btcRate = trpc.remittance.getExchangeRate.useQuery(
    { fromCurrency: 'BTC', toCurrency: 'NGN', amount: parsedAmount },
    { enabled: parsedAmount > 0, refetchInterval: 30000 }
  );
  const ethRate = trpc.remittance.getExchangeRate.useQuery(
    { fromCurrency: 'ETH', toCurrency: 'NGN', amount: parsedAmount },
    { enabled: parsedAmount > 0, refetchInterval: 30000 }
  );
  const usdcRate = trpc.remittance.getExchangeRate.useQuery(
    { fromCurrency: 'USDC', toCurrency: 'NGN', amount: parsedAmount },
    { enabled: parsedAmount > 0, refetchInterval: 30000 }
  );
  const usdtRate = trpc.remittance.getExchangeRate.useQuery(
    { fromCurrency: 'USDT', toCurrency: 'NGN', amount: parsedAmount },
    { enabled: parsedAmount > 0, refetchInterval: 30000 }
  );

  // Track rate changes for trending indicators
  useEffect(() => {
    const newRates: Record<string, number> = {};
    if (btcRate.data) newRates.BTC = btcRate.data.exchangeRate;
    if (ethRate.data) newRates.ETH = ethRate.data.exchangeRate;
    if (usdcRate.data) newRates.USDC = usdcRate.data.exchangeRate;
    if (usdtRate.data) newRates.USDT = usdtRate.data.exchangeRate;
    
    if (Object.keys(newRates).length > 0 && Object.keys(previousRates).length > 0) {
      // Only update if rates have changed
      const hasChanged = Object.keys(newRates).some(
        key => previousRates[key] && newRates[key] !== previousRates[key]
      );
      if (hasChanged) {
        setPreviousRates(newRates);
      }
    } else if (Object.keys(previousRates).length === 0) {
      setPreviousRates(newRates);
    }
  }, [btcRate.data, ethRate.data, usdcRate.data, usdtRate.data]);

  const getRateTrend = (currency: string, currentRate?: number) => {
    if (!currentRate || !previousRates[currency]) return null;
    const previous = previousRates[currency];
    const change = ((currentRate - previous) / previous) * 100;
    
    if (Math.abs(change) < 0.01) return { direction: 'stable', change: 0 };
    return {
      direction: change > 0 ? 'up' : 'down',
      change: Math.abs(change),
    };
  };

  const rates = [
    { currency: 'BTC', icon: Bitcoin, data: btcRate.data, loading: btcRate.isLoading, color: 'bg-orange-100 text-orange-700' },
    { currency: 'ETH', icon: DollarSign, data: ethRate.data, loading: ethRate.isLoading, color: 'bg-purple-100 text-purple-700' },
    { currency: 'USDC', icon: DollarSign, data: usdcRate.data, loading: usdcRate.isLoading, color: 'bg-blue-100 text-blue-700' },
    { currency: 'USDT', icon: DollarSign, data: usdtRate.data, loading: usdtRate.isLoading, color: 'bg-green-100 text-green-700' },
  ];

  // Find best rate (highest recipient amount)
  const bestRate = rates.reduce((best, current) => {
    if (!current.data) return best;
    if (!best.data) return current;
    return current.data.estimatedRecipientAmount > best.data.estimatedRecipientAmount ? current : best;
  }, rates[0]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5" />
          Compare All Rates
        </CardTitle>
        <CardDescription>
          See which cryptocurrency gives you the best value
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Amount to Send</Label>
          <Input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="500"
            min="0"
            step="0.01"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rates.map((rate) => {
            const Icon = rate.icon;
            const isBest = rate.currency === bestRate.currency && rate.data;
            
            return (
              <Card key={rate.currency} className={`relative ${
                isBest ? 'ring-2 ring-green-500' : ''
              }`}>
                {isBest && (
                  <div className="absolute -top-2 -right-2 bg-green-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                    Best Rate
                  </div>
                )}
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${rate.color}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-semibold">{rate.currency}</p>
                        <p className="text-xs text-muted-foreground">
                          {rate.currency === 'BTC' ? 'Bitcoin' :
                           rate.currency === 'ETH' ? 'Ethereum' :
                           rate.currency === 'USDC' ? 'USD Coin' :
                           'Tether'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {rate.loading && (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </div>
                  )}

                  {rate.data && (
                    <div className="space-y-3">
                      <div>
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted-foreground">You Receive</p>
                          {(() => {
                            const trend = getRateTrend(rate.currency, rate.data.exchangeRate);
                            if (!trend) return null;
                            return (
                              <Badge variant="outline" className="text-xs">
                                {trend.direction === 'up' && (
                                  <span className="text-green-600 flex items-center">
                                    <ArrowUpRight className="w-3 h-3 mr-1" />
                                    +{trend.change.toFixed(2)}%
                                  </span>
                                )}
                                {trend.direction === 'down' && (
                                  <span className="text-red-600 flex items-center">
                                    <ArrowDownRight className="w-3 h-3 mr-1" />
                                    -{trend.change.toFixed(2)}%
                                  </span>
                                )}
                                {trend.direction === 'stable' && (
                                  <span className="text-gray-600">Stable</span>
                                )}
                              </Badge>
                            );
                          })()}
                        </div>
                        <p className="text-2xl font-bold text-green-600">
                          ₦{rate.data.estimatedRecipientAmount.toLocaleString()}
                        </p>
                      </div>

                      <Separator />

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <p className="text-muted-foreground">Rate</p>
                          <p className="font-semibold">
                            1 {rate.currency} = ₦{rate.data.exchangeRate.toLocaleString()}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Fee</p>
                          <p className="font-semibold">₦{rate.data.fee.toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {bestRate.data && (
          <Alert className="bg-green-50 border-green-200">
            <TrendingUp className="w-4 h-4 text-green-600" />
            <AlertDescription>
              <strong>Best Choice:</strong> {bestRate.currency} gives you the highest amount - 
              ₦{bestRate.data.estimatedRecipientAmount.toLocaleString()}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Create Remittance Component
 */
function CreateRemittance() {
  const [formData, setFormData] = useState({
    senderCurrency: 'USDC' as 'BTC' | 'ETH' | 'USDC' | 'USDT',
    senderAmount: '500',
    recipientPhone: '+234',
    deliveryOption: 'EXISTING_ACCOUNT' as 'NEW_ACCOUNT' | 'EXISTING_ACCOUNT',
    accountNumber: '',
    bankCode: '',
  });

  const { data: banks } = trpc.remittance.getSupportedBanks.useQuery();
  const createMutation = trpc.remittance.createRemittance.useMutation({
    onSuccess: (data) => {
      toast.success('Remittance created successfully!');
      log.info('Remittance:', data);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleSubmit = () => {
    createMutation.mutate({
      senderCurrency: formData.senderCurrency,
      senderAmount: parseFloat(formData.senderAmount),
      recipientPhone: formData.recipientPhone,
      recipientCountry: 'NG',
      deliveryOption: formData.deliveryOption,
      metadata: formData.deliveryOption === 'EXISTING_ACCOUNT' ? {
        accountNumber: formData.accountNumber,
        bankCode: formData.bankCode,
      } : undefined,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="w-5 h-5" />
          Create Remittance
        </CardTitle>
        <CardDescription>
          Start a new crypto-to-fiat remittance transaction
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Cryptocurrency</Label>
            <Select 
              value={formData.senderCurrency} 
              onValueChange={(v: any) => setFormData({ ...formData, senderCurrency: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BTC">Bitcoin (BTC)</SelectItem>
                <SelectItem value="ETH">Ethereum (ETH)</SelectItem>
                <SelectItem value="USDC">USD Coin (USDC)</SelectItem>
                <SelectItem value="USDT">Tether (USDT)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Amount</Label>
            <Input
              type="number"
              value={formData.senderAmount}
              onChange={(e) => setFormData({ ...formData, senderAmount: e.target.value })}
              placeholder="500"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Recipient Phone</Label>
          <Input
            value={formData.recipientPhone}
            onChange={(e) => setFormData({ ...formData, recipientPhone: e.target.value })}
            placeholder="+2348012345678"
          />
        </div>

        <div className="space-y-2">
          <Label>Delivery Option</Label>
          <Select 
            value={formData.deliveryOption} 
            onValueChange={(v: any) => setFormData({ ...formData, deliveryOption: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="EXISTING_ACCOUNT">Existing Bank Account</SelectItem>
              <SelectItem value="NEW_ACCOUNT">Open New Account</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {formData.deliveryOption === 'EXISTING_ACCOUNT' && (
          <>
            <div className="space-y-2">
              <Label>Bank</Label>
              <Select 
                value={formData.bankCode} 
                onValueChange={(v) => setFormData({ ...formData, bankCode: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select bank" />
                </SelectTrigger>
                <SelectContent>
                  {banks?.banks.map((bank: any) => (
                    <SelectItem key={bank.code} value={bank.code}>
                      {bank.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Account Number</Label>
              <Input
                value={formData.accountNumber}
                onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
                placeholder="0123456789"
                maxLength={10}
              />
            </div>
          </>
        )}

        <Button 
          onClick={handleSubmit} 
          disabled={createMutation.isPending}
          className="w-full"
          size="lg"
        >
          {createMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <ArrowRight className="w-4 h-4 mr-2" />
              Create Remittance
            </>
          )}
        </Button>

        {createMutation.data && (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <AlertDescription>
              <p className="font-semibold mb-2">Remittance Created!</p>
              <p className="text-sm">ID: {createMutation.data.remittanceId}</p>
              <p className="text-sm">Status: {createMutation.data.status}</p>
              {createMutation.data.cryptoPaymentUrl && (
                <a 
                  href={createMutation.data.cryptoPaymentUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline text-sm"
                >
                  Pay with Crypto →
                </a>
              )}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Bank Account Verifier Component
 */
function BankAccountVerifier() {
  const [accountNumber, setAccountNumber] = useState('');
  const [bankCode, setBankCode] = useState('');

  const { data: banks } = trpc.remittance.getSupportedBanks.useQuery();
  const verifyMutation = trpc.remittance.verifyBankAccount.useMutation();

  const handleVerify = () => {
    verifyMutation.mutate({ accountNumber, bankCode });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="w-5 h-5" />
          Bank Account Verification
        </CardTitle>
        <CardDescription>
          Verify Nigerian bank account details via NIBSS
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Bank</Label>
          <Select value={bankCode} onValueChange={setBankCode}>
            <SelectTrigger>
              <SelectValue placeholder="Select bank" />
            </SelectTrigger>
            <SelectContent>
              {banks?.banks.map((bank: any) => (
                <SelectItem key={bank.code} value={bank.code}>
                  {bank.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Account Number</Label>
          <Input
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="0123456789"
            maxLength={10}
          />
        </div>

        <Button 
          onClick={handleVerify} 
          disabled={!accountNumber || !bankCode || verifyMutation.isPending}
          className="w-full"
        >
          {verifyMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Verifying...
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Verify Account
            </>
          )}
        </Button>

        {verifyMutation.data && (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <AlertDescription>
              <p className="font-semibold mb-2">Account Verified!</p>
              <p className="text-sm">Name: {verifyMutation.data.accountName}</p>
              <p className="text-sm">Bank: {verifyMutation.data.bankName}</p>
              <p className="text-sm">Number: {verifyMutation.data.accountNumber}</p>
            </AlertDescription>
          </Alert>
        )}

        {verifyMutation.error && (
          <Alert variant="destructive">
            <XCircle className="w-4 h-4" />
            <AlertDescription>{verifyMutation.error.message}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * KYC Simulator Component
 */
function KYCSimulator() {
  const [kycData, setKycData] = useState({
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    idType: 'BVN' as 'BVN' | 'NIN' | 'PASSPORT' | 'DRIVERS_LICENSE',
    idNumber: '',
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="w-5 h-5" />
          KYC Verification Simulator
        </CardTitle>
        <CardDescription>
          Test identity verification with Smile Identity
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>First Name</Label>
            <Input
              value={kycData.firstName}
              onChange={(e) => setKycData({ ...kycData, firstName: e.target.value })}
              placeholder="John"
            />
          </div>

          <div className="space-y-2">
            <Label>Last Name</Label>
            <Input
              value={kycData.lastName}
              onChange={(e) => setKycData({ ...kycData, lastName: e.target.value })}
              placeholder="Doe"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Date of Birth</Label>
          <Input
            type="date"
            value={kycData.dateOfBirth}
            onChange={(e) => setKycData({ ...kycData, dateOfBirth: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label>ID Type</Label>
          <Select 
            value={kycData.idType} 
            onValueChange={(v: any) => setKycData({ ...kycData, idType: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="BVN">Bank Verification Number (BVN)</SelectItem>
              <SelectItem value="NIN">National ID Number (NIN)</SelectItem>
              <SelectItem value="PASSPORT">International Passport</SelectItem>
              <SelectItem value="DRIVERS_LICENSE">Driver's License</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>ID Number</Label>
          <Input
            value={kycData.idNumber}
            onChange={(e) => setKycData({ ...kycData, idNumber: e.target.value })}
            placeholder={
              kycData.idType === 'BVN' ? '12345678901' :
              kycData.idType === 'NIN' ? '12345678901' :
              kycData.idType === 'PASSPORT' ? 'A12345678' :
              'ABC123456789DE'
            }
          />
        </div>

        <Alert>
          <AlertDescription className="text-sm">
            <strong>Note:</strong> This is a demo interface. In production, KYC verification 
            would include document upload, selfie capture, and liveness detection.
          </AlertDescription>
        </Alert>

        <Button className="w-full" disabled>
          <Shield className="w-4 h-4 mr-2" />
          Start KYC Verification (Demo Only)
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Agent Cash Pickup Demo Component
 */
function AgentCashDemo() {
  const [amount, setAmount] = useState('50000');
  const [provider, setProvider] = useState<'paga' | 'opay' | 'kudi'>('paga');
  const [location, setLocation] = useState({ lat: 6.5244, lng: 3.3792 }); // Lagos
  const [collectionCode, setCollectionCode] = useState('');

  const generateCode = () => {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    const code = (100000 + (arr[0] % 900000)).toString();
    setCollectionCode(code);
    toast.success('Collection code generated! Valid for 72 hours.');
  };

  const providerInfo = {
    paga: { name: 'Paga', agents: '25,000+', color: 'bg-red-100 text-red-700' },
    opay: { name: 'OPay', agents: '10,000+', color: 'bg-green-100 text-green-700' },
    kudi: { name: 'Kudi', agents: '5,000+', color: 'bg-blue-100 text-blue-700' },
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Configuration Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5" />
            Agent Cash Pickup
          </CardTitle>
          <CardDescription>
            Generate a collection code for cash pickup at agent locations
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Amount to Collect (NGN)</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="50000"
            />
          </div>

          <div className="space-y-2">
            <Label>Select Provider</Label>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(providerInfo).map(([key, info]) => (
                <button
                  key={key}
                  onClick={() => setProvider(key as any)}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    provider === key
                      ? 'border-primary bg-primary/5'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-full mx-auto mb-2 flex items-center justify-center ${info.color}`}>
                    <Wallet className="w-5 h-5" />
                  </div>
                  <p className="font-semibold text-sm">{info.name}</p>
                  <p className="text-xs text-muted-foreground">{info.agents} agents</p>
                </button>
              ))}
            </div>
          </div>

          <Button onClick={generateCode} className="w-full" size="lg">
            Generate Collection Code
          </Button>

          {collectionCode && (
            <Alert className="bg-green-50 border-green-200">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <AlertDescription>
                <div className="space-y-2">
                  <p className="font-semibold">Collection Code Generated!</p>
                  <div className="bg-white p-4 rounded border border-green-300">
                    <p className="text-3xl font-bold text-center tracking-wider">{collectionCode}</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Visit any {providerInfo[provider].name} agent with this code and your ID to collect ₦{parseFloat(amount).toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Valid for 72 hours • Fee: ₦{(parseFloat(amount) * 0.005).toLocaleString()}
                  </p>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Agent Locator Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5" />
            Find Nearby Agents
          </CardTitle>
          <CardDescription>
            Locate {providerInfo[provider].name} agents near you
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-gray-100 rounded-lg p-8 text-center">
            <MapPin className="w-16 h-16 mx-auto mb-4 text-gray-400" />
            <p className="text-sm text-muted-foreground mb-4">
              Map integration showing nearby agents
            </p>
            <Button variant="outline">
              <MapPin className="w-4 h-4 mr-2" />
              Use My Location
            </Button>
          </div>

          <div className="space-y-3">
            <p className="font-semibold text-sm">Nearest Agents:</p>
            {[
              { name: 'Victoria Island Branch', distance: '0.5 km', address: '123 Ahmadu Bello Way' },
              { name: 'Lekki Phase 1', distance: '1.2 km', address: '45 Admiralty Way' },
              { name: 'Ikeja Mall', distance: '2.8 km', address: '78 Allen Avenue' },
            ].map((agent, i) => (
              <div key={i} className="p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-sm">{agent.name}</p>
                    <p className="text-xs text-muted-foreground">{agent.address}</p>
                  </div>
                  <Badge variant="outline">{agent.distance}</Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Bill Payment Demo Component
 */
function BillPaymentDemo() {
  const [category, setCategory] = useState<'electricity' | 'cable' | 'airtime' | 'data'>('electricity');
  const [amount, setAmount] = useState('5000');
  const [accountNumber, setAccountNumber] = useState('');
  const [provider, setProvider] = useState('');

  const categories = {
    electricity: {
      name: 'Electricity',
      icon: '⚡',
      providers: ['EKEDC', 'IKEDC', 'AEDC', 'IBEDC', 'PHED'],
      placeholder: 'Meter Number',
    },
    cable: {
      name: 'Cable TV',
      icon: '📺',
      providers: ['DStv', 'GOtv', 'Startimes'],
      placeholder: 'Smart Card Number',
    },
    airtime: {
      name: 'Airtime',
      icon: '📱',
      providers: ['MTN', 'Airtel', 'Glo', '9mobile'],
      placeholder: 'Phone Number',
    },
    data: {
      name: 'Data Bundle',
      icon: '📶',
      providers: ['MTN', 'Airtel', 'Glo', '9mobile'],
      placeholder: 'Phone Number',
    },
  };

  const handlePayment = () => {
    toast.success(`Payment of ₦${parseFloat(amount).toLocaleString()} to ${provider} successful!`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="w-5 h-5" />
          Bill Payment
        </CardTitle>
        <CardDescription>
          Pay for electricity, cable TV, airtime, and data bundles
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Category Selection */}
        <div className="space-y-2">
          <Label>Select Category</Label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(categories).map(([key, cat]) => (
              <button
                key={key}
                onClick={() => setCategory(key as any)}
                className={`p-4 rounded-lg border-2 transition-all text-center ${
                  category === key
                    ? 'border-primary bg-primary/5'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="text-3xl mb-2">{cat.icon}</div>
                <p className="font-semibold text-sm">{cat.name}</p>
              </button>
            ))}
          </div>
        </div>

        <Separator />

        {/* Provider Selection */}
        <div className="space-y-2">
          <Label>Select Provider</Label>
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger>
              <SelectValue placeholder="Choose provider" />
            </SelectTrigger>
            <SelectContent>
              {categories[category].providers.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Account Number */}
        <div className="space-y-2">
          <Label>{categories[category].placeholder}</Label>
          <Input
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder={categories[category].placeholder}
          />
        </div>

        {/* Amount */}
        <div className="space-y-2">
          <Label>Amount (NGN)</Label>
          <Input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="5000"
          />
        </div>

        {/* Quick Amount Buttons */}
        {(category === 'airtime' || category === 'data') && (
          <div className="flex gap-2">
            {['100', '200', '500', '1000', '2000', '5000'].map((amt) => (
              <Button
                key={amt}
                variant="outline"
                size="sm"
                onClick={() => setAmount(amt)}
              >
                ₦{amt}
              </Button>
            ))}
          </div>
        )}

        {/* Summary */}
        {provider && accountNumber && (
          <Alert>
            <AlertDescription>
              <div className="space-y-1">
                <p className="font-semibold">Payment Summary</p>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Category:</span>
                    <span>{categories[category].name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Provider:</span>
                    <span>{provider}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Account:</span>
                    <span>{accountNumber}</span>
                  </div>
                  <Separator className="my-2" />
                  <div className="flex justify-between font-semibold">
                    <span>Total:</span>
                    <span>₦{parseFloat(amount).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <Button
          onClick={handlePayment}
          className="w-full"
          size="lg"
          disabled={!provider || !accountNumber || !amount}
        >
          Pay Now
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Mobile Money Demo Component
 */
function MobileMoneyDemo() {
  const [provider, setProvider] = useState<'mtn' | 'airtel' | 'glo'>('mtn');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [amount, setAmount] = useState('10000');
  const [paymentMethod, setPaymentMethod] = useState<'crypto' | 'bank'>('crypto');
  const [selectedCrypto, setSelectedCrypto] = useState<'BTC' | 'ETH' | 'USDC' | 'USDT'>('USDC');
  const parsedAmount = parseFloat(amount) || 0;

  // Fetch exchange rates for all cryptocurrencies
  const btcRate = trpc.remittance.getExchangeRate.useQuery(
    { fromCurrency: 'BTC', toCurrency: 'NGN', amount: parsedAmount },
    { enabled: parsedAmount > 0 && paymentMethod === 'crypto', refetchInterval: 30000 }
  );
  const ethRate = trpc.remittance.getExchangeRate.useQuery(
    { fromCurrency: 'ETH', toCurrency: 'NGN', amount: parsedAmount },
    { enabled: parsedAmount > 0 && paymentMethod === 'crypto', refetchInterval: 30000 }
  );
  const usdcRate = trpc.remittance.getExchangeRate.useQuery(
    { fromCurrency: 'USDC', toCurrency: 'NGN', amount: parsedAmount },
    { enabled: parsedAmount > 0 && paymentMethod === 'crypto', refetchInterval: 30000 }
  );
  const usdtRate = trpc.remittance.getExchangeRate.useQuery(
    { fromCurrency: 'USDT', toCurrency: 'NGN', amount: parsedAmount },
    { enabled: parsedAmount > 0 && paymentMethod === 'crypto', refetchInterval: 30000 }
  );

  const cryptoRates = {
    BTC: btcRate.data,
    ETH: ethRate.data,
    USDC: usdcRate.data,
    USDT: usdtRate.data,
  };

  const selectedRate = cryptoRates[selectedCrypto];
  const isLoadingRates = btcRate.isLoading || ethRate.isLoading || usdcRate.isLoading || usdtRate.isLoading;

  const providers = {
    mtn: { name: 'MTN MoMo', color: 'bg-yellow-100 text-yellow-700', prefix: '0803, 0806, 0703, 0706, 0813, 0816, 0810, 0814, 0903, 0906, 0913, 0916' },
    airtel: { name: 'Airtel Money', color: 'bg-red-100 text-red-700', prefix: '0802, 0808, 0708, 0812, 0701, 0902, 0907, 0901, 0904, 0912' },
    glo: { name: 'Glo Cash', color: 'bg-green-100 text-green-700', prefix: '0805, 0807, 0705, 0815, 0811, 0905, 0915' },
  };

  const handleTransfer = () => {
    toast.success(`Transfer of ₦${parseFloat(amount).toLocaleString()} to ${phoneNumber} successful!`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="w-5 h-5" />
          Mobile Money Transfer
        </CardTitle>
        <CardDescription>
          Send crypto and recipient receives NGN in their mobile wallet
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Payment Method Selection */}
        <div className="space-y-2">
          <Label>Payment Method</Label>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setPaymentMethod('crypto')}
              className={`p-4 rounded-lg border-2 transition-all ${
                paymentMethod === 'crypto'
                  ? 'border-primary bg-primary/5'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <Bitcoin className="w-6 h-6 mx-auto mb-2" />
              <p className="font-semibold text-sm">Pay with Crypto</p>
              <p className="text-xs text-muted-foreground">BTC, ETH, USDC, USDT</p>
            </button>
            <button
              onClick={() => setPaymentMethod('bank')}
              className={`p-4 rounded-lg border-2 transition-all ${
                paymentMethod === 'bank'
                  ? 'border-primary bg-primary/5'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <Building2 className="w-6 h-6 mx-auto mb-2" />
              <p className="font-semibold text-sm">Pay with Bank</p>
              <p className="text-xs text-muted-foreground">Nigerian banks</p>
            </button>
          </div>
        </div>

        {paymentMethod === 'crypto' && (
          <>
            <Separator />
            
            {/* Cryptocurrency Selection */}
            <div className="space-y-2">
              <Label>Select Cryptocurrency</Label>
              <div className="grid grid-cols-4 gap-2">
                {(['BTC', 'ETH', 'USDC', 'USDT'] as const).map((crypto) => (
                  <button
                    key={crypto}
                    onClick={() => setSelectedCrypto(crypto)}
                    className={`p-3 rounded-lg border-2 transition-all ${
                      selectedCrypto === crypto
                        ? 'border-primary bg-primary/5'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className="font-semibold text-sm">{crypto}</p>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        {/* Provider Selection */}
        <div className="space-y-2">
          <Label>Select Mobile Money Provider</Label>
          <div className="grid grid-cols-3 gap-3">
            {Object.entries(providers).map(([key, prov]) => (
              <button
                key={key}
                onClick={() => setProvider(key as any)}
                className={`p-4 rounded-lg border-2 transition-all ${
                  provider === key
                    ? 'border-primary bg-primary/5'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className={`w-12 h-12 rounded-full mx-auto mb-2 flex items-center justify-center ${prov.color}`}>
                  <Smartphone className="w-6 h-6" />
                </div>
                <p className="font-semibold text-sm">{prov.name}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Phone Number */}
        <div className="space-y-2">
          <Label>Recipient Phone Number</Label>
          <Input
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="08012345678"
            maxLength={11}
          />
          <p className="text-xs text-muted-foreground">
            Supported prefixes: {providers[provider].prefix}
          </p>
        </div>

        {/* Amount */}
        <div className="space-y-2">
          <Label>Amount (NGN)</Label>
          <Input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="10000"
            min="100"
            max="1000000"
          />
          <p className="text-xs text-muted-foreground">
            Min: ₦100 • Max: ₦1,000,000 • Fee: Free
          </p>
        </div>

        {/* Quick Amount Buttons */}
        <div className="space-y-2">
          <Label>Quick Amounts</Label>
          <div className="flex flex-wrap gap-2">
            {['1000', '2000', '5000', '10000', '20000', '50000'].map((amt) => (
              <Button
                key={amt}
                variant="outline"
                size="sm"
                onClick={() => setAmount(amt)}
              >
                ₦{parseInt(amt).toLocaleString()}
              </Button>
            ))}
          </div>
        </div>

        {/* Crypto Conversion Summary */}
        {paymentMethod === 'crypto' && selectedRate && phoneNumber && phoneNumber.length === 11 && (
          <Alert className="bg-blue-50 border-blue-200">
            <AlertDescription>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">Conversion Summary</p>
                  {isLoadingRates && <Loader2 className="w-4 h-4 animate-spin" />}
                </div>
                <div className="text-sm space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">You Send:</span>
                    <span className="font-semibold">
                      {(parsedAmount / selectedRate.exchangeRate).toFixed(8)} {selectedCrypto}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Exchange Rate:</span>
                    <span>1 {selectedCrypto} = ₦{selectedRate.exchangeRate.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Conversion Fee:</span>
                    <span>₦{selectedRate.fee.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Mobile Money Provider:</span>
                    <span>{providers[provider].name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Recipient:</span>
                    <span>{phoneNumber}</span>
                  </div>
                  <Separator className="my-2" />
                  <div className="flex justify-between font-semibold text-base">
                    <span>Recipient Gets:</span>
                    <span className="text-green-600">₦{selectedRate.estimatedRecipientAmount.toLocaleString()}</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Rate updates every 30 seconds • Valid for 15 minutes
                </p>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Bank Transfer Summary */}
        {paymentMethod === 'bank' && phoneNumber && phoneNumber.length === 11 && (
          <Alert>
            <AlertDescription>
              <div className="space-y-1">
                <p className="font-semibold">Transfer Summary</p>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Provider:</span>
                    <span>{providers[provider].name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Recipient:</span>
                    <span>{phoneNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Fee:</span>
                    <span className="text-green-600">Free</span>
                  </div>
                  <Separator className="my-2" />
                  <div className="flex justify-between font-semibold">
                    <span>Total:</span>
                    <span>₦{parseFloat(amount).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <Button
          onClick={handleTransfer}
          className="w-full"
          size="lg"
          disabled={!phoneNumber || phoneNumber.length !== 11 || !amount}
        >
          Send Money
        </Button>

        {/* Info Alert */}
        <Alert>
          <AlertDescription className="text-xs">
            <p className="font-semibold mb-1">How it works:</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Recipient receives instant SMS notification</li>
              <li>Money is credited to their mobile wallet immediately</li>
              <li>No fees for mobile money transfers</li>
              <li>Available 24/7 including weekends</li>
            </ul>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

/**
 * Payment Tracker Component
 */
function PaymentTracker() {
  const [remittanceId, setRemittanceId] = useState('');
  const { data: remittance, refetch } = trpc.remittance.getRemittance.useQuery(
    { remittanceId },
    { enabled: !!remittanceId }
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="w-5 h-5" />
          Payment Tracker
        </CardTitle>
        <CardDescription>
          Track the status of your remittance transaction
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex gap-2">
          <Input
            value={remittanceId}
            onChange={(e) => setRemittanceId(e.target.value)}
            placeholder="rem_abc123xyz"
            className="flex-1"
          />
          <Button onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        {remittance && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <Badge variant={
                remittance.status === 'completed' ? 'default' :
                remittance.status === 'failed' ? 'destructive' :
                'secondary'
              }>
                {remittance.status}
              </Badge>
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Amount Sent</span>
                <span className="font-semibold">
                  {remittance.senderAmount} {remittance.senderCurrency}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Amount Received</span>
                <span className="font-semibold">
                  ₦{remittance.estimatedRecipientAmount?.toLocaleString() || 'Pending'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Exchange Rate</span>
                <span className="font-semibold">
                  {remittance.exchangeRate || 'Pending'}
                </span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Rate Alert Widget Component
 * Shows active alerts and allows quick creation
 */
function RateAlertWidget() {
  const { data: alerts } = trpc.rateAlerts.list.useQuery();
  const activeAlerts = alerts?.filter(a => a.status === 'active') || [];
  const nearestAlert = activeAlerts.sort((a, b) => {
    const aDist = Math.abs(a.distanceFromTarget || Infinity);
    const bDist = Math.abs(b.distanceFromTarget || Infinity);
    return aDist - bDist;
  })[0];

  return (
    <Card className="border-2 border-blue-200 bg-blue-50/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-blue-600" />
            <CardTitle>Rate Alerts</CardTitle>
            {activeAlerts.length > 0 && (
              <Badge variant="secondary">{activeAlerts.length} active</Badge>
            )}
          </div>
          <Button size="sm" variant="outline" asChild>
            <a href="/rate-alerts">
              <BellPlus className="w-4 h-4 mr-2" />
              Manage Alerts
            </a>
          </Button>
        </div>
        <CardDescription>
          Get notified when exchange rates reach your target values
        </CardDescription>
      </CardHeader>
      <CardContent>
        {activeAlerts.length === 0 ? (
          <Alert>
            <AlertDescription className="flex items-center justify-between">
              <span>No active alerts. Create one to get notified when rates change!</span>
              <Button size="sm" asChild>
                <a href="/rate-alerts">Create Alert</a>
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-3">
            {nearestAlert && (
              <div className="p-4 bg-white rounded-lg border-2 border-blue-300">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-blue-600" />
                    <span className="font-semibold">
                      {nearestAlert.fromCurrency}/{nearestAlert.toCurrency}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {nearestAlert.condition}
                    </Badge>
                  </div>
                  <Badge className="bg-blue-600">Nearest to Target</Badge>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Target:</span>
                    <span className="font-semibold">
                      ₦{parseFloat(nearestAlert.targetRate).toLocaleString()}
                    </span>
                  </div>
                  {nearestAlert.currentRate && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Current:</span>
                      <span className="font-semibold">
                        ₦{nearestAlert.currentRate.toLocaleString()}
                      </span>
                    </div>
                  )}
                  {nearestAlert.distanceFromTarget !== undefined && (
                    <div className="text-xs text-muted-foreground text-center pt-2 border-t">
                      {Math.abs(nearestAlert.distanceFromTarget) < 1
                        ? '🎯 Almost there!'
                        : `₦${Math.abs(nearestAlert.distanceFromTarget).toLocaleString()} ${nearestAlert.condition === 'above' ? 'to go' : 'away'}`}
                    </div>
                  )}
                </div>
              </div>
            )}
            {activeAlerts.length > 1 && (
              <div className="text-center">
                <Button variant="link" size="sm" asChild>
                  <a href="/rate-alerts">
                    View all {activeAlerts.length} alerts →
                  </a>
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
