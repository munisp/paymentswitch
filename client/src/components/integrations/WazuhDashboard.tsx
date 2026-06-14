import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, Server, Shield, Bug, Activity } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function WazuhDashboard() {
  const { data: alerts = [], isLoading: alertsLoading } = trpc.integrations.siem.getAlerts.useQuery();
  const { data: agents = [], isLoading: agentsLoading } = trpc.integrations.siem.getAgents.useQuery();
  const { data: vulnerabilities = [], isLoading: vulnsLoading } = trpc.integrations.siem.getVulnerabilities.useQuery();

  const loading = alertsLoading || agentsLoading || vulnsLoading;

  const getSeverityBadge = (level: number) => {
    if (level >= 12) return <Badge variant="destructive">Critical</Badge>;
    if (level >= 7) return <Badge variant="default">High</Badge>;
    if (level >= 4) return <Badge variant="secondary">Medium</Badge>;
    return <Badge variant="outline">Low</Badge>;
  };

  const getVulnSeverityBadge = (severity: string) => {
    switch (severity.toLowerCase()) {
      case "critical":
        return <Badge variant="destructive">Critical</Badge>;
      case "high":
        return <Badge variant="default">High</Badge>;
      case "medium":
        return <Badge variant="secondary">Medium</Badge>;
      default:
        return <Badge variant="outline">Low</Badge>;
    }
  };

  const getAgentStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case "active":
        return <Badge className="bg-green-500">Active</Badge>;
      case "disconnected":
        return <Badge variant="destructive">Disconnected</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Activity className="w-6 h-6 animate-spin mr-2" />
        <span>Loading SIEM data...</span>
      </div>
    );
  }

  const criticalAlerts = alerts.filter((a: any) => a.rule.level >= 12).length;
  const activeAgents = agents.filter((a: any) => a.status === "active").length;
  const criticalVulns = vulnerabilities.filter((v: any) => v.severity === "critical").length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="w-6 h-6" />
          Wazuh SIEM Dashboard
        </h2>
        <p className="text-muted-foreground">
          Security monitoring, alerts, and vulnerability management
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{alerts.length}</div>
            <p className="text-xs text-muted-foreground">
              {criticalAlerts} critical
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Agents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{agents.length}</div>
            <p className="text-xs text-muted-foreground">
              {activeAgents} active
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Vulnerabilities</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{vulnerabilities.length}</div>
            <p className="text-xs text-muted-foreground">
              {criticalVulns} critical
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge className="bg-green-500">Connected</Badge>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              Recent Alerts
            </CardTitle>
            <CardDescription>Latest security alerts from all agents</CardDescription>
          </CardHeader>
          <CardContent>
            {alerts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No alerts detected
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Agent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alerts.slice(0, 10).map((alert: any) => (
                    <TableRow key={alert.id}>
                      <TableCell className="text-xs">
                        {new Date(alert.timestamp).toLocaleString()}
                      </TableCell>
                      <TableCell>{getSeverityBadge(alert.rule.level)}</TableCell>
                      <TableCell className="max-w-xs truncate">
                        {alert.rule.description}
                      </TableCell>
                      <TableCell>{alert.agent.name}</TableCell>
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
              <Server className="w-5 h-5" />
              Agents
            </CardTitle>
            <CardDescription>Monitored endpoints and their status</CardDescription>
          </CardHeader>
          <CardContent>
            {agents.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No agents registered
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>OS</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agents.slice(0, 10).map((agent: any) => (
                    <TableRow key={agent.id}>
                      <TableCell>{agent.name}</TableCell>
                      <TableCell className="font-mono text-xs">{agent.ip}</TableCell>
                      <TableCell>{agent.os?.name || "Unknown"}</TableCell>
                      <TableCell>{getAgentStatusBadge(agent.status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bug className="w-5 h-5" />
            Vulnerabilities
          </CardTitle>
          <CardDescription>Detected vulnerabilities across all agents</CardDescription>
        </CardHeader>
        <CardContent>
          {vulnerabilities.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No vulnerabilities detected
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CVE</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>CVSS</TableHead>
                  <TableHead>Package</TableHead>
                  <TableHead>Agent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vulnerabilities.slice(0, 10).map((vuln: any) => (
                  <TableRow key={vuln.id}>
                    <TableCell className="font-mono text-xs">{vuln.cve}</TableCell>
                    <TableCell className="max-w-xs truncate">{vuln.title}</TableCell>
                    <TableCell>{getVulnSeverityBadge(vuln.severity)}</TableCell>
                    <TableCell>{vuln.cvss?.toFixed(1) || "N/A"}</TableCell>
                    <TableCell>{vuln.package}</TableCell>
                    <TableCell>{vuln.agent}</TableCell>
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
