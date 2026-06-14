import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, AlertTriangle, Activity, Database } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface OpenSearchStats {
  docs_indexed: number;
  search_queries: number;
  errors: number;
}

export default function OpenSearchDashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const [serviceFilter, setServiceFilter] = useState("");

  const { data: logsData, isLoading: logsLoading, refetch: refetchLogs } = trpc.integrations.logs.search.useQuery({
    service: serviceFilter || undefined,
    level: levelFilter !== "all" ? levelFilter : undefined,
  });
  const { data: eventsData, isLoading: eventsLoading } = trpc.integrations.logs.getSecurityEvents.useQuery({});
  const { data: metrics, isLoading: metricsLoading } = trpc.integrations.getMetrics.useQuery();

  const loading = logsLoading || eventsLoading || metricsLoading;
  const logs = logsData?.hits || [];
  const securityEvents = eventsData?.hits || [];
  const stats: OpenSearchStats | null = metrics?.opensearch || null;

  const getLevelBadge = (level: string) => {
    switch (level?.toLowerCase()) {
      case "error":
        return <Badge variant="destructive">ERROR</Badge>;
      case "warn":
      case "warning":
        return <Badge variant="default">WARN</Badge>;
      case "info":
        return <Badge variant="secondary">INFO</Badge>;
      default:
        return <Badge variant="outline">{level?.toUpperCase() || "UNKNOWN"}</Badge>;
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity?.toLowerCase()) {
      case "critical":
        return <Badge variant="destructive">Critical</Badge>;
      case "high":
        return <Badge variant="default">High</Badge>;
      case "medium":
        return <Badge variant="secondary">Medium</Badge>;
      default:
        return <Badge variant="outline">{severity || "Low"}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Activity className="w-6 h-6 animate-spin mr-2" />
        <span>Loading log analytics...</span>
      </div>
    );
  }

  const errorLogs = logs.filter((l: any) => l.level?.toLowerCase() === "error").length;
  const criticalEvents = securityEvents.filter((e: any) => e.severity === "critical").length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Database className="w-6 h-6" />
          OpenSearch Log Analytics
        </h2>
        <p className="text-muted-foreground">
          Centralized logging, search, and security event analysis
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Docs Indexed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.docs_indexed?.toLocaleString() || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Search Queries</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.search_queries?.toLocaleString() || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Error Logs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{errorLogs}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Security Events</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{securityEvents.length}</div>
            <p className="text-xs text-muted-foreground">{criticalEvents} critical</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="w-5 h-5" />
            Log Search
          </CardTitle>
          <CardDescription>Search and filter application logs</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-4">
            <Input
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1"
            />
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Levels</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="warn">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="debug">Debug</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Service..."
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              className="w-40"
            />
                        <Button onClick={() => refetchLogs()}>
                          <Search className="w-4 h-4 mr-2" />
                          Search
                        </Button>
          </div>

          {logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No logs found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Trace ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs
                  .filter((log: any) =>
                    searchQuery
                      ? log.message?.toLowerCase().includes(searchQuery.toLowerCase())
                      : true
                  )
                  .slice(0, 20)
                  .map((log: any, idx: number) => (
                    <TableRow key={idx}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString()}
                      </TableCell>
                      <TableCell>{getLevelBadge(log.level)}</TableCell>
                      <TableCell>{log.service}</TableCell>
                      <TableCell className="max-w-md truncate">{log.message}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {log.trace_id?.slice(0, 8) || "-"}
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
            Security Events
          </CardTitle>
          <CardDescription>Security-related events and incidents</CardDescription>
        </CardHeader>
        <CardContent>
          {securityEvents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No security events found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {securityEvents.slice(0, 10).map((event: any, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {new Date(event.timestamp).toLocaleString()}
                    </TableCell>
                    <TableCell>{event.event_type}</TableCell>
                    <TableCell>{getSeverityBadge(event.severity)}</TableCell>
                    <TableCell>{event.source}</TableCell>
                    <TableCell>{event.action}</TableCell>
                    <TableCell>
                      <Badge variant={event.result === "success" ? "outline" : "destructive"}>
                        {event.result}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{event.description}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
