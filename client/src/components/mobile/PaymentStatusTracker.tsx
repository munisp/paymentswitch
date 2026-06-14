import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckCircle2, Clock, XCircle, RefreshCw, Download } from "lucide-react";
import { useState, useEffect } from "react";
import { trpc } from '@/lib/trpc';
import { createLogger } from '@/lib/logger';
const log = createLogger('PaymentStatusTracker');

interface PaymentStatus {
  transactionID: string;
  amount: number;
  currency: string;
  status: "pending" | "processing" | "completed" | "failed";
  paymentMethod: string;
  createdAt: string;
  timeline: Array<{
    step: string;
    status: "completed" | "current" | "pending";
    timestamp?: string;
  }>;
}

interface PaymentStatusTrackerProps {
  transactionID: string;
  onRetry?: () => void;
  onDownloadReceipt?: () => void;
}

export default function PaymentStatusTracker({
  transactionID,
  onRetry,
  onDownloadReceipt,
}: PaymentStatusTrackerProps) {
  const [status, setStatus] = useState<PaymentStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch payment status
    fetchPaymentStatus();

    // Poll for updates every 3 seconds if pending/processing
    const interval = setInterval(() => {
      if (status?.status === "pending" || status?.status === "processing") {
        fetchPaymentStatus();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [transactionID, status?.status]);

  const fetchPaymentStatus = async () => {
    try {
      const result = await (trpc.remittance.getRemittance as any).query({ remittanceId: transactionID });

      setStatus({
        transactionID: result.remittanceId,
        amount: result.senderAmount,
        currency: result.senderCurrency,
        status: result.status === 'completed' ? 'completed'
          : result.status === 'failed' || result.status === 'expired' || result.status === 'cancelled' ? 'failed'
          : result.status === 'pending_recipient_info' || result.status === 'pending_payment' ? 'pending'
          : 'processing',
        paymentMethod: result.deliveryOption,
        createdAt: result.createdAt,
        timeline: [
          { step: "Payment initiated", status: "completed", timestamp: result.createdAt },
          { step: "Fraud check", status: "completed", timestamp: result.createdAt },
          { step: "Authorization", status: result.status === 'pending_recipient_info' ? 'pending' : 'completed', timestamp: result.createdAt },
          { step: "Payment captured", status: result.status === 'completed' ? 'completed' : 'pending', timestamp: result.createdAt },
          { step: "Receipt sent", status: result.status === 'completed' ? 'completed' : 'pending', timestamp: result.createdAt },
        ],
      });
      setLoading(false);
    } catch {
      // Fallback when API is unreachable
      setStatus({
        transactionID,
        amount: 0,
        currency: "NGN",
        status: "pending",
        paymentMethod: "unknown",
        createdAt: new Date().toISOString(),
        timeline: [{ step: "Payment initiated", status: "pending", timestamp: new Date().toISOString() }],
      });
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </Card>
    );
  }

  if (!status) {
    return (
      <Card className="p-6">
        <p className="text-center text-muted-foreground">
          Payment not found
        </p>
      </Card>
    );
  }

  const getStatusIcon = () => {
    switch (status.status) {
      case "completed":
        return <CheckCircle2 className="h-12 w-12 text-green-500" />;
      case "failed":
        return <XCircle className="h-12 w-12 text-red-500" />;
      case "processing":
        return <RefreshCw className="h-12 w-12 animate-spin text-blue-500" />;
      default:
        return <Clock className="h-12 w-12 text-yellow-500" />;
    }
  };

  const getStatusBadge = () => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      completed: "default",
      failed: "destructive",
      processing: "secondary",
      pending: "outline",
    };

    return (
      <Badge variant={variants[status.status]} className="text-sm">
        {status.status.toUpperCase()}
      </Badge>
    );
  };

  const formatAmount = (amount: number, currency: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount / 100);
  };

  const formatTimestamp = (timestamp: string) => {
    return new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(timestamp));
  };

  return (
    <div className="space-y-4">
      {/* Status Header */}
      <Card className="p-6">
        <div className="flex flex-col items-center text-center space-y-4">
          {getStatusIcon()}
          <div>
            <h2 className="text-2xl font-bold">
              {formatAmount(status.amount, status.currency)}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Transaction ID: {status.transactionID}
            </p>
          </div>
          {getStatusBadge()}
        </div>
      </Card>

      {/* Timeline */}
      <Card className="p-6">
        <h3 className="font-semibold mb-4">Payment Timeline</h3>
        <div className="space-y-4">
          {status.timeline.map((item, index) => (
            <div key={index} className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-1">
                {item.status === "completed" ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                ) : item.status === "current" ? (
                  <RefreshCw className="h-5 w-5 animate-spin text-blue-500" />
                ) : (
                  <Clock className="h-5 w-5 text-gray-300" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${
                  item.status === "pending" ? "text-muted-foreground" : ""
                }`}>
                  {item.step}
                </p>
                {item.timestamp && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatTimestamp(item.timestamp)}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Actions */}
      <div className="flex flex-col gap-2">
        {status.status === "completed" && onDownloadReceipt && (
          <Button onClick={onDownloadReceipt} className="w-full">
            <Download className="h-4 w-4 mr-2" />
            Download Receipt
          </Button>
        )}
        {status.status === "failed" && onRetry && (
          <Button onClick={onRetry} className="w-full">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry Payment
          </Button>
        )}
      </div>
    </div>
  );
}
