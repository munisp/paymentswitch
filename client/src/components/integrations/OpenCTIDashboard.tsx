import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Shield, RefreshCw, Globe, Activity } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

interface OpenCTIStats {
  indicators_count: number;
  malicious_ips_count: number;
  fraud_indicators_count: number;
  last_sync: string;
  sync_errors: number;
}

export default function OpenCTIDashboard() {
  const { data: maliciousIPs = [], isLoading: ipsLoading, refetch: refetchIPs } = trpc.integrations.threatIntel.getMaliciousIPs.useQuery();
  const { data: fraudIndicators = [], isLoading: indicatorsLoading, refetch: refetchIndicators } = trpc.integrations.threatIntel.getIndicators.useQuery();
  const { data: metrics, isLoading: metricsLoading, refetch: refetchMetrics } = trpc.integrations.getMetrics.useQuery();
  
  const syncMutation = trpc.integrations.threatIntel.triggerSync.useMutation({
    onSuccess: () => {
      toast.success("Threat intelligence sync triggered");
      setTimeout(() => {
        refetchIPs();
        refetchIndicators();
        refetchMetrics();
      }, 2000);
    },
    onError: () => {
      toast.error("Failed to trigger sync");
    },
  });

  const loading = ipsLoading || indicatorsLoading || metricsLoading;
  const stats: OpenCTIStats | null = metrics?.opencti || null;

  const getSeverityColor = (score: number) => {
    if (score >= 80) return "destructive";
    if (score >= 60) return "default";
    return "secondary";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Activity className="w-6 h-6 animate-spin mr-2" />
        <span>Loading threat intelligence...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6" />
            OpenCTI Threat Intelligence
          </h2>
          <p className="text-muted-foreground">
            Real-time threat indicators and malicious IP tracking
          </p>
        </div>
                <Button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
                  <RefreshCw className={`w-4 h-4 mr-2 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                  Sync Now
                </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Indicators</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.indicators_count || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Malicious IPs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{maliciousIPs.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Fraud Indicators</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{fraudIndicators.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Last Sync</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm">
              {stats?.last_sync ? new Date(stats.last_sync).toLocaleString() : "Never"}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="w-5 h-5" />
              Malicious IPs
            </CardTitle>
            <CardDescription>High-risk IP addresses from threat intelligence</CardDescription>
          </CardHeader>
          <CardContent>
            {maliciousIPs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No malicious IPs detected
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>IP Address</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Threat Type</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {maliciousIPs.slice(0, 10).map((ip: any, idx: number) => (
                    <TableRow key={idx}>
                      <TableCell className="font-mono">{ip.ip}</TableCell>
                      <TableCell>
                        <Badge variant={getSeverityColor(ip.score)}>{ip.score}</Badge>
                      </TableCell>
                      <TableCell>{ip.threat_type || "Unknown"}</TableCell>
                      <TableCell>
                        <Badge variant={ip.is_blocked ? "destructive" : "outline"}>
                          {ip.is_blocked ? "Blocked" : "Monitored"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Fraud Indicators
            </CardTitle>
            <CardDescription>Payment fraud threat indicators</CardDescription>
          </CardHeader>
          <CardContent>
            {fraudIndicators.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No fraud indicators detected
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Confidence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fraudIndicators.slice(0, 10).map((indicator: any, idx: number) => (
                    <TableRow key={idx}>
                      <TableCell>{indicator.type}</TableCell>
                      <TableCell>{indicator.category}</TableCell>
                      <TableCell>
                        <Badge variant={getSeverityColor(indicator.score * 100)}>
                          {(indicator.score * 100).toFixed(0)}%
                        </Badge>
                      </TableCell>
                      <TableCell>{(indicator.confidence * 100).toFixed(0)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
