import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import {
  Activity,
  TrendingUp,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { format } from "date-fns";

interface ApiKeyMonitoringProps {
  credentialId: number;
}

export default function ApiKeyMonitoring({ credentialId }: ApiKeyMonitoringProps) {
  const [days, setDays] = useState(7);

  // Get real-time stats
  const { data: realTimeStats } = trpc.apiKeyEnhancements.monitoring.getRealTime.useQuery({
    credentialId,
  });

  // Get error rate
  const { data: errorRate } = trpc.apiKeyEnhancements.monitoring.getErrorRate.useQuery({
    credentialId,
    days,
  });

  // Get usage trends
  const { data: trends } = trpc.apiKeyEnhancements.monitoring.getTrends.useQuery({
    credentialId,
    days: 30,
  });

  // Get recent activity
  const { data: recentActivity = [] } = trpc.apiKeyEnhancements.monitoring.getActivity.useQuery({
    credentialId,
    limit: 50,
  });

  const getStatusColor = (statusCode: number) => {
    if (statusCode >= 200 && statusCode < 300) return "text-green-600";
    if (statusCode >= 400 && statusCode < 500) return "text-orange-600";
    if (statusCode >= 500) return "text-red-600";
    return "text-gray-600";
  };

  const getStatusIcon = (statusCode: number) => {
    if (statusCode >= 200 && statusCode < 300) return <CheckCircle2 className="h-4 w-4" />;
    return <XCircle className="h-4 w-4" />;
  };

  return (
    <div className="space-y-6">
      {/* Real-time Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Last 24 Hours</p>
                <p className="text-2xl font-bold">
                  {realTimeStats?.last24Hours.requests.toLocaleString() || 0}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Total Requests</p>
              </div>
              <Activity className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Error Rate</p>
                <p className="text-2xl font-bold">
                  {errorRate?.errorRate.toFixed(2) || 0}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {errorRate?.totalErrors || 0} errors / {errorRate?.totalRequests || 0} requests
                </p>
              </div>
              <AlertTriangle
                className={`h-8 w-8 ${
                  (errorRate?.errorRate || 0) > 5 ? "text-red-600" : "text-green-600"
                }`}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Avg Response Time</p>
                <p className="text-2xl font-bold">
                  {realTimeStats?.last24Hours.avgResponseTime || 0}ms
                </p>
                <p className="text-xs text-muted-foreground mt-1">Last 24 Hours</p>
              </div>
              <Clock className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs for detailed views */}
      <Tabs defaultValue="activity">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="activity">Recent Activity</TabsTrigger>
          <TabsTrigger value="trends">Usage Trends</TabsTrigger>
        </TabsList>

        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>Recent API Requests</CardTitle>
              <CardDescription>Last 50 requests made with this API key</CardDescription>
            </CardHeader>
            <CardContent>
              {recentActivity.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No activity recorded yet
                </div>
              ) : (
                <div className="space-y-2">
                  {recentActivity.map((log, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 flex-1">
                        <div className={getStatusColor(log.statusCode ?? 0)}>
                          {getStatusIcon(log.statusCode ?? 0)}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="font-mono text-xs">
                              {log.method}
                            </Badge>
                            <code className="text-sm">{log.endpoint}</code>
                          </div>
                          {log.errorMessage && (
                            <p className="text-xs text-red-600 mt-1">{log.errorMessage}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <Badge
                          variant={(log.statusCode ?? 0) < 400 ? "default" : "destructive"}
                          className="font-mono"
                        >
                          {log.statusCode}
                        </Badge>
                        <span>{log.responseTimeMs}ms</span>
                        {log.ipAddress && (
                          <span className="text-xs font-mono">{log.ipAddress}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trends">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Usage Trends (Last 30 Days)
              </CardTitle>
              <CardDescription>Request volume and error rates over time</CardDescription>
            </CardHeader>
            <CardContent>
              {trends && trends.labels.length > 0 ? (
                <div className="space-y-6">
                  {/* Simple bar chart visualization */}
                  <div>
                    <h4 className="text-sm font-medium mb-3">Daily Requests</h4>
                    <div className="space-y-2">
                      {trends.labels.slice(-14).map((label, index) => {
                        const maxRequests = Math.max(...trends.requests);
                        const requests = trends.requests[trends.labels.indexOf(label)];
                        const percentage = maxRequests > 0 ? (requests / maxRequests) * 100 : 0;
                        
                        return (
                          <div key={label} className="flex items-center gap-3">
                            <span className="text-xs text-muted-foreground w-20">
                              {format(new Date(label), "MMM dd")}
                            </span>
                            <div className="flex-1 bg-muted rounded-full h-6 relative overflow-hidden">
                              <div
                                className="bg-blue-600 h-full rounded-full transition-all"
                                style={{ width: `${percentage}%` }}
                              />
                              <span className="absolute inset-0 flex items-center justify-center text-xs font-medium">
                                {requests}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Stats Summary */}
                  <div className="grid grid-cols-3 gap-4 pt-4 border-t">
                    <div>
                      <p className="text-sm text-muted-foreground">Total Requests</p>
                      <p className="text-xl font-bold">
                        {trends.requests.reduce((a, b) => a + b, 0).toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Total Errors</p>
                      <p className="text-xl font-bold text-red-600">
                        {trends.errors.reduce((a, b) => a + b, 0).toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Avg Response Time</p>
                      <p className="text-xl font-bold">
                        {Math.round(
                          trends.avgResponseTimes.reduce((a, b) => a + b, 0) /
                            trends.avgResponseTimes.length
                        )}
                        ms
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No usage data available yet
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
