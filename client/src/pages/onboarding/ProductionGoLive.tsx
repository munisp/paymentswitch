import { useState, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { SlackConfigurationPanel } from '@/components/SlackConfigurationPanel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Rocket, 
  Shield, 
  FileCheck, 
  Server,
  Activity,
  AlertCircle,
  Bell,
  Plus,
  Trash2,
  Check
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface ProductionGoLiveProps {
  applicationId?: number;
}

export default function ProductionGoLive({ applicationId = 1 }: ProductionGoLiveProps) {
  const [currentView, setCurrentView] = useState<'checklist' | 'credentials' | 'monitoring' | 'incidents' | 'alerts'>('checklist');
  const [productionEndpoint, setProductionEndpoint] = useState('');
  const [productionWebhookUrl, setProductionWebhookUrl] = useState('');
  const [dailyLimit, setDailyLimit] = useState(10000);
  const [monthlyLimit, setMonthlyLimit] = useState(300000);
  
  // Incident form state
  const [showIncidentDialog, setShowIncidentDialog] = useState(false);
  const [incidentForm, setIncidentForm] = useState({
    incidentType: 'other' as any,
    severity: 'medium' as any,
    title: '',
    description: '',
    occurredAt: new Date().toISOString().slice(0, 16),
  });

  // Alert form state
  const [showAlertRuleDialog, setShowAlertRuleDialog] = useState(false);
  const [alertRuleForm, setAlertRuleForm] = useState({
    ruleName: '',
    metricType: 'error_rate' as any,
    operator: 'greater_than' as any,
    thresholdValue: 10,
    severity: 'warning' as any,
    enabled: true,
  });

  // Queries
  const { data: checklist, isLoading: checklistLoading, refetch: refetchChecklist } = 
    trpc.productionGoLive.getChecklist.useQuery({ applicationId });
  
  const { data: readiness, refetch: refetchReadiness } = 
    trpc.productionGoLive.validateGoLive.useQuery({ applicationId });
  
  const { data: credentials, refetch: refetchCredentials } = 
    trpc.productionGoLive.getProductionCredentials.useQuery({ applicationId });
  
  const { data: monitoring } = trpc.productionGoLive.getMonitoringData.useQuery(
    { credentialId: credentials?.id || 0 },
    { enabled: !!credentials }
  );
  
  const { data: incidents, refetch: refetchIncidents } = trpc.productionGoLive.getIncidents.useQuery(
    { credentialId: credentials?.id || 0 },
    { enabled: !!credentials }
  );

  // Alert queries
  const { data: alertRules, refetch: refetchAlertRules } = trpc.productionGoLive.getAlertRules.useQuery(
    { credentialId: credentials?.id || 0 },
    { enabled: !!credentials }
  );

  const { data: activeAlerts, refetch: refetchActiveAlerts } = trpc.productionGoLive.getActiveAlerts.useQuery(
    { credentialId: credentials?.id || 0 },
    { enabled: !!credentials, refetchInterval: 30000 } // Refresh every 30 seconds
  );

  const { data: alertHistory } = trpc.productionGoLive.getAlertHistory.useQuery(
    { credentialId: credentials?.id || 0, limit: 50 },
    { enabled: !!credentials }
  );

  // Mutations
  const initChecklist = trpc.productionGoLive.initializeChecklist.useMutation({
    onSuccess: () => {
      toast.success('Checklist initialized');
      refetchChecklist();
    },
  });

  const updateChecklist = trpc.productionGoLive.updateChecklistItem.useMutation({
    onSuccess: () => {
      toast.success('Checklist updated');
      refetchChecklist();
      refetchReadiness();
    },
  });

  const requestAccess = trpc.productionGoLive.requestProductionAccess.useMutation({
    onSuccess: (data) => {
      toast.success('Production access requested successfully!');
      refetchCredentials();
      setCurrentView('credentials');
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const createIncident = trpc.productionGoLive.createIncident.useMutation({
    onSuccess: () => {
      toast.success('Incident reported');
      setShowIncidentDialog(false);
      refetchIncidents();
      setIncidentForm({
        incidentType: 'other',
        severity: 'medium',
        title: '',
        description: '',
        occurredAt: new Date().toISOString().slice(0, 16),
      });
    },
  });

  // Alert mutations
  const createAlertRule = trpc.productionGoLive.createAlertRule.useMutation({
    onSuccess: () => {
      toast.success('Alert rule created');
      setShowAlertRuleDialog(false);
      refetchAlertRules();
      setAlertRuleForm({
        ruleName: '',
        metricType: 'error_rate',
        operator: 'greater_than',
        thresholdValue: 10,
        severity: 'warning',
        enabled: true,
      });
    },
  });

  const deleteAlertRule = trpc.productionGoLive.deleteAlertRule.useMutation({
    onSuccess: () => {
      toast.success('Alert rule deleted');
      refetchAlertRules();
    },
  });

  const acknowledgeAlert = trpc.productionGoLive.acknowledgeAlert.useMutation({
    onSuccess: () => {
      toast.success('Alert acknowledged');
      refetchActiveAlerts();
    },
  });

  const resolveAlert = trpc.productionGoLive.resolveAlert.useMutation({
    onSuccess: () => {
      toast.success('Alert resolved');
      refetchActiveAlerts();
    },
  });

  // Initialize checklist if not exists
  useEffect(() => {
    if (!checklistLoading && !checklist) {
      initChecklist.mutate({ applicationId });
    }
  }, [checklist, checklistLoading]);

  const handleChecklistToggle = (field: string, value: boolean) => {
    updateChecklist.mutate({
      applicationId,
      updates: { [field]: value },
    });
  };

  const handleRequestAccess = () => {
    if (!productionEndpoint) {
      toast.error('Production endpoint is required');
      return;
    }

    requestAccess.mutate({
      applicationId,
      productionEndpoint,
      productionWebhookUrl: productionWebhookUrl || undefined,
      dailyTransactionLimit: dailyLimit,
      monthlyTransactionLimit: monthlyLimit,
    });
  };

  const handleReportIncident = () => {
    if (!credentials) return;

    createIncident.mutate({
      credentialId: credentials.id,
      ...incidentForm,
      occurredAt: new Date(incidentForm.occurredAt),
    });
  };

  const checklistItems = checklist ? [
    { key: 'certificationPassed', label: 'Certification Passed', value: checklist.certificationPassed, icon: Shield },
    { key: 'securityAuditComplete', label: 'Security Audit Completed', value: checklist.securityAuditComplete, icon: Shield },
    { key: 'complianceVerified', label: 'Compliance Verified', value: checklist.complianceVerified, icon: FileCheck },
    { key: 'integrationTestsPassed', label: 'Integration Tested', value: checklist.integrationTestsPassed, icon: Server },
    { key: 'documentationReviewed', label: 'Documentation Reviewed', value: checklist.documentationReviewed, icon: FileCheck },
    { key: 'supportContactsProvided', label: 'Support Contacts Provided', value: checklist.supportContactsProvided, icon: CheckCircle2 },
    { key: 'disasterRecoveryPlanSubmitted', label: 'Disaster Recovery Plan Submitted', value: checklist.disasterRecoveryPlanSubmitted, icon: Shield },
    { key: 'productionEndpointsConfigured', label: 'Production Endpoints Configured', value: checklist.productionEndpointsConfigured, icon: Server },
  ] : [];

  const completedCount = checklistItems.filter(item => item.value).length;
  const progress = checklistItems.length > 0 ? (completedCount / checklistItems.length) * 100 : 0;

  if (checklistLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container max-w-6xl py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Production Go-Live</h1>
        <p className="text-muted-foreground">
          Complete the checklist and request production access to go live
        </p>
      </div>

      {/* Navigation Tabs */}
      <div className="flex gap-2 mb-6 border-b">
        <Button
          variant={currentView === 'checklist' ? 'default' : 'ghost'}
          onClick={() => setCurrentView('checklist')}
        >
          <FileCheck className="w-4 h-4 mr-2" />
          Checklist
        </Button>
        <Button
          variant={currentView === 'credentials' ? 'default' : 'ghost'}
          onClick={() => setCurrentView('credentials')}
          disabled={!credentials}
        >
          <Shield className="w-4 h-4 mr-2" />
          Credentials
        </Button>
        <Button
          variant={currentView === 'monitoring' ? 'default' : 'ghost'}
          onClick={() => setCurrentView('monitoring')}
          disabled={!credentials}
        >
          <Activity className="w-4 h-4 mr-2" />
          Monitoring
        </Button>
        <Button
          variant={currentView === 'incidents' ? 'default' : 'ghost'}
          onClick={() => setCurrentView('incidents')}
          disabled={!credentials}
        >
          <AlertTriangle className="w-4 h-4 mr-2" />
          Incidents
        </Button>
        <Button
          variant={currentView === 'alerts' ? 'default' : 'ghost'}
          onClick={() => setCurrentView('alerts')}
          disabled={!credentials}
        >
          <Bell className="w-4 h-4 mr-2" />
          Alerts
          {activeAlerts && activeAlerts.length > 0 && (
            <Badge variant="destructive" className="ml-2">
              {activeAlerts.length}
            </Badge>
          )}
        </Button>
      </div>

      {/* Checklist View */}
      {currentView === 'checklist' && (
        <div className="space-y-6">
          {/* Progress Overview */}
          <Card>
            <CardHeader>
              <CardTitle>Go-Live Progress</CardTitle>
              <CardDescription>
                Complete all items to request production access
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium">
                      {completedCount} of {checklistItems.length} completed
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {Math.round(progress)}%
                    </span>
                  </div>
                  <Progress value={progress} />
                </div>

                {readiness && !readiness.ready && (
                  <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-500 mt-0.5" />
                      <div>
                        <h4 className="font-medium text-yellow-900 dark:text-yellow-100 mb-1">
                          Not Ready for Production
                        </h4>
                        <ul className="text-sm text-yellow-800 dark:text-yellow-200 list-disc list-inside">
                          {readiness.missingItems.map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                {readiness?.ready && !credentials && (
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-500 mt-0.5" />
                      <div>
                        <h4 className="font-medium text-green-900 dark:text-green-100">
                          Ready for Production!
                        </h4>
                        <p className="text-sm text-green-800 dark:text-green-200">
                          All checklist items are complete. You can now request production access.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Checklist Items */}
          <Card>
            <CardHeader>
              <CardTitle>Checklist Items</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {checklistItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.key}
                      className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Icon className={`w-5 h-5 ${item.value ? 'text-green-600' : 'text-muted-foreground'}`} />
                        <span className={item.value ? 'line-through text-muted-foreground' : ''}>
                          {item.label}
                        </span>
                      </div>
                      <Button
                        variant={item.value ? 'outline' : 'default'}
                        size="sm"
                        onClick={() => handleChecklistToggle(item.key, !item.value)}
                        disabled={updateChecklist.isPending}
                      >
                        {item.value ? (
                          <>
                            <XCircle className="w-4 h-4 mr-2" />
                            Unmark
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-4 h-4 mr-2" />
                            Mark Complete
                          </>
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Request Production Access */}
          {readiness?.ready && !credentials && (
            <Card>
              <CardHeader>
                <CardTitle>Request Production Access</CardTitle>
                <CardDescription>
                  Configure your production environment and request credentials
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="prodEndpoint">Production Endpoint *</Label>
                  <Input
                    id="prodEndpoint"
                    type="url"
                    placeholder="https://api.yourcompany.com/payment"
                    value={productionEndpoint}
                    onChange={(e) => setProductionEndpoint(e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="prodWebhook">Production Webhook URL</Label>
                  <Input
                    id="prodWebhook"
                    type="url"
                    placeholder="https://api.yourcompany.com/webhooks"
                    value={productionWebhookUrl}
                    onChange={(e) => setProductionWebhookUrl(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="dailyLimit">Daily Transaction Limit</Label>
                    <Input
                      id="dailyLimit"
                      type="number"
                      value={dailyLimit}
                      onChange={(e) => setDailyLimit(parseInt(e.target.value))}
                    />
                  </div>

                  <div>
                    <Label htmlFor="monthlyLimit">Monthly Transaction Limit</Label>
                    <Input
                      id="monthlyLimit"
                      type="number"
                      value={monthlyLimit}
                      onChange={(e) => setMonthlyLimit(parseInt(e.target.value))}
                    />
                  </div>
                </div>

                <Button
                  onClick={handleRequestAccess}
                  disabled={requestAccess.isPending}
                  className="w-full"
                >
                  {requestAccess.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Requesting...
                    </>
                  ) : (
                    <>
                      <Rocket className="w-4 h-4 mr-2" />
                      Request Production Access
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Credentials View */}
      {currentView === 'credentials' && credentials && (
        <Card>
          <CardHeader>
            <CardTitle>Production Credentials</CardTitle>
            <CardDescription>
              Use these credentials to integrate with the production environment
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-accent/50 rounded-lg">
              <span className="font-medium">Status</span>
              <Badge variant={credentials.status === 'active' ? 'default' : 'secondary'}>
                {credentials.status}
              </Badge>
            </div>

            <div>
              <Label>API Key</Label>
              <div className="flex gap-2">
                <Input value={credentials.productionApiKey ?? ''} readOnly />
                <Button
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(credentials.productionApiKey ?? '');
                    toast.success('API Key copied');
                  }}
                >
                  Copy
                </Button>
              </div>
            </div>

            <div>
              <Label>API Secret</Label>
              <div className="flex gap-2">
                <Input value={credentials.productionApiSecret ?? ''} type="password" readOnly />
                <Button
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(credentials.productionApiSecret ?? '');
                    toast.success('API Secret copied');
                  }}
                >
                  Copy
                </Button>
              </div>
            </div>

            {credentials.productionWebhookSecret && (
              <div>
                <Label>Webhook Secret</Label>
                <div className="flex gap-2">
                  <Input value={credentials.productionWebhookSecret || ''} type="password" readOnly />
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (credentials.productionWebhookSecret) {
                        navigator.clipboard.writeText(credentials.productionWebhookSecret);
                        toast.success('Webhook Secret copied');
                      }
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Daily Limit</Label>
                <Input value={credentials.dailyTransactionLimit?.toLocaleString() ?? 'N/A'} readOnly />
              </div>
              <div>
                <Label>Monthly Limit</Label>
                <Input value={credentials.monthlyTransactionLimit ? credentials.monthlyTransactionLimit.toLocaleString() : 'N/A'} readOnly />
              </div>
            </div>

            {credentials.status === 'pending' && (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-500 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-yellow-900 dark:text-yellow-100">
                      Pending Activation
                    </h4>
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                      Your production access request is pending admin approval.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Monitoring View */}
      {currentView === 'monitoring' && monitoring && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Production Metrics</CardTitle>
              <CardDescription>Last 30 days of production activity</CardDescription>
            </CardHeader>
            <CardContent>
              {monitoring.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  No monitoring data available yet
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Success</TableHead>
                      <TableHead>Failed</TableHead>
                      <TableHead>Avg Response</TableHead>
                      <TableHead>Uptime</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {monitoring.map((metric) => (
                      <TableRow key={metric.id}>
                        <TableCell>
                          {metric.date ? new Date(metric.date).toLocaleDateString() : 'N/A'}
                        </TableCell>
                        <TableCell>{metric.totalTransactions}</TableCell>
                        <TableCell className="text-green-600">
                          {metric.successfulTransactions}
                        </TableCell>
                        <TableCell className="text-red-600">
                          {metric.failedTransactions}
                        </TableCell>
                        <TableCell>{metric.averageResponseTime || 'N/A'}ms</TableCell>
                        <TableCell>{metric.uptimePercentage || 'N/A'}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Incidents View */}
      {currentView === 'incidents' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Incident Reports</CardTitle>
                  <CardDescription>Track and manage production incidents</CardDescription>
                </div>
                <Dialog open={showIncidentDialog} onOpenChange={setShowIncidentDialog}>
                  <DialogTrigger asChild>
                    <Button>
                      <AlertTriangle className="w-4 h-4 mr-2" />
                      Report Incident
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Report New Incident</DialogTitle>
                      <DialogDescription>
                        Provide details about the production incident
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label>Incident Type</Label>
                        <Select
                          value={incidentForm.incidentType}
                          onValueChange={(value) =>
                            setIncidentForm({ ...incidentForm, incidentType: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="outage">Outage</SelectItem>
                            <SelectItem value="performance_degradation">Performance Degradation</SelectItem>
                            <SelectItem value="security_breach">Security Breach</SelectItem>
                            <SelectItem value="data_issue">Data Issue</SelectItem>
                            <SelectItem value="integration_failure">Integration Failure</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label>Severity</Label>
                        <Select
                          value={incidentForm.severity}
                          onValueChange={(value) =>
                            setIncidentForm({ ...incidentForm, severity: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                            <SelectItem value="critical">Critical</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label>Title</Label>
                        <Input
                          value={incidentForm.title}
                          onChange={(e) =>
                            setIncidentForm({ ...incidentForm, title: e.target.value })
                          }
                          placeholder="Brief description of the incident"
                        />
                      </div>

                      <div>
                        <Label>Description</Label>
                        <Textarea
                          value={incidentForm.description}
                          onChange={(e) =>
                            setIncidentForm({ ...incidentForm, description: e.target.value })
                          }
                          placeholder="Detailed description of what happened"
                          rows={4}
                        />
                      </div>

                      <div>
                        <Label>Occurred At</Label>
                        <Input
                          type="datetime-local"
                          value={incidentForm.occurredAt}
                          onChange={(e) =>
                            setIncidentForm({ ...incidentForm, occurredAt: e.target.value })
                          }
                        />
                      </div>

                      <Button
                        onClick={handleReportIncident}
                        disabled={createIncident.isPending}
                        className="w-full"
                      >
                        {createIncident.isPending ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Reporting...
                          </>
                        ) : (
                          'Report Incident'
                        )}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {!incidents || incidents.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  No incidents reported
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Occurred</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {incidents.map((incident) => (
                      <TableRow key={incident.id}>
                        <TableCell className="font-medium">{incident.title}</TableCell>
                        <TableCell>{incident.incidentType}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              incident.severity === 'critical' || incident.severity === 'high'
                                ? 'destructive'
                                : 'secondary'
                            }
                          >
                            {incident.severity}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={incident.status === 'resolved' ? 'default' : 'secondary'}>
                            {incident.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {incident.occurredAt ? new Date(incident.occurredAt).toLocaleString() : 'N/A'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Alerts View */}
      {currentView === 'alerts' && (
        <div className="space-y-6">
          {/* Active Alerts */}
          {activeAlerts && activeAlerts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="w-5 h-5" />
                  Active Alerts
                  <Badge variant="destructive">{activeAlerts.length}</Badge>
                </CardTitle>
                <CardDescription>Alerts currently requiring attention</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {activeAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`p-4 border rounded-lg ${
                        alert.severity === 'critical'
                          ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                          : alert.severity === 'warning'
                          ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20'
                          : 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge
                              variant={
                                alert.severity === 'critical'
                                  ? 'destructive'
                                  : alert.severity === 'warning'
                                  ? 'secondary'
                                  : 'default'
                              }
                            >
                              {alert.severity}
                            </Badge>
                            <span className="font-medium">{alert.title}</span>
                          </div>
                          <p className="text-sm text-muted-foreground mb-2">
                            {alert.message}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Triggered {new Date(alert.triggeredAt).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {alert.status === 'active' && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => acknowledgeAlert.mutate({ alertId: alert.id })}
                                disabled={acknowledgeAlert.isPending}
                              >
                                <Check className="w-4 h-4 mr-1" />
                                Acknowledge
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => resolveAlert.mutate({ alertId: alert.id })}
                                disabled={resolveAlert.isPending}
                              >
                                Resolve
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Slack Integration */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
                </svg>
                Slack Integration
              </CardTitle>
              <CardDescription>
                Send real-time alert notifications to your Slack channel
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SlackConfigurationPanel credentialId={credentials?.id || 0} />
            </CardContent>
          </Card>

          {/* Alert Rules */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Alert Rules</CardTitle>
                  <CardDescription>
                    Configure thresholds and conditions for monitoring alerts
                  </CardDescription>
                </div>
                <Dialog open={showAlertRuleDialog} onOpenChange={setShowAlertRuleDialog}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="w-4 h-4 mr-2" />
                      Create Rule
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Create Alert Rule</DialogTitle>
                      <DialogDescription>
                        Set up automated alerts for production monitoring
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label>Rule Name</Label>
                        <Input
                          value={alertRuleForm.ruleName}
                          onChange={(e) =>
                            setAlertRuleForm({ ...alertRuleForm, ruleName: e.target.value })
                          }
                          placeholder="High error rate alert"
                        />
                      </div>

                      <div>
                        <Label>Metric Type</Label>
                        <Select
                          value={alertRuleForm.metricType}
                          onValueChange={(value) =>
                            setAlertRuleForm({ ...alertRuleForm, metricType: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="error_rate">Error Rate (%)</SelectItem>
                            <SelectItem value="response_time">Response Time (ms)</SelectItem>
                            <SelectItem value="transaction_volume">Transaction Volume</SelectItem>
                            <SelectItem value="uptime">Uptime (%)</SelectItem>
                            <SelectItem value="failure_rate">Failure Rate (%)</SelectItem>
                            <SelectItem value="peak_tps">Peak TPS</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Operator</Label>
                          <Select
                            value={alertRuleForm.operator}
                            onValueChange={(value) =>
                              setAlertRuleForm({ ...alertRuleForm, operator: value })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="greater_than">Greater Than</SelectItem>
                              <SelectItem value="less_than">Less Than</SelectItem>
                              <SelectItem value="equals">Equals</SelectItem>
                              <SelectItem value="not_equals">Not Equals</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label>Threshold Value</Label>
                          <Input
                            type="number"
                            value={alertRuleForm.thresholdValue}
                            onChange={(e) =>
                              setAlertRuleForm({
                                ...alertRuleForm,
                                thresholdValue: parseInt(e.target.value),
                              })
                            }
                          />
                        </div>
                      </div>

                      <div>
                        <Label>Severity</Label>
                        <Select
                          value={alertRuleForm.severity}
                          onValueChange={(value) =>
                            setAlertRuleForm({ ...alertRuleForm, severity: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="info">Info</SelectItem>
                            <SelectItem value="warning">Warning</SelectItem>
                            <SelectItem value="critical">Critical</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <Button
                        onClick={() => {
                          if (!credentials) return;
                          createAlertRule.mutate({
                            credentialId: credentials.id,
                            ...alertRuleForm,
                          });
                        }}
                        disabled={createAlertRule.isPending || !alertRuleForm.ruleName}
                        className="w-full"
                      >
                        {createAlertRule.isPending ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Creating...
                          </>
                        ) : (
                          'Create Alert Rule'
                        )}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {!alertRules || alertRules.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  No alert rules configured. Create your first rule to start monitoring.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rule Name</TableHead>
                      <TableHead>Metric</TableHead>
                      <TableHead>Condition</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {alertRules.map((rule) => (
                      <TableRow key={rule.id}>
                        <TableCell className="font-medium">{rule.name}</TableCell>
                        <TableCell>{rule.metricType.replace(/_/g, ' ')}</TableCell>
                        <TableCell>
                          {rule.operator.replace(/_/g, ' ')} {rule.threshold}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              rule.severity === 'critical'
                                ? 'destructive'
                                : rule.severity === 'warning'
                                ? 'secondary'
                                : 'default'
                            }
                          >
                            {rule.severity}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={rule.enabled ? 'default' : 'secondary'}>
                            {rule.enabled ? 'Enabled' : 'Disabled'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteAlertRule.mutate({ ruleId: rule.id })}
                            disabled={deleteAlertRule.isPending}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Alert History */}
          {alertHistory && alertHistory.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Alert History</CardTitle>
                <CardDescription>Recent alert activity</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Alert</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Triggered</TableHead>
                      <TableHead>Resolved</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {alertHistory.map((alert) => (
                      <TableRow key={alert.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{alert.title}</div>
                            <div className="text-sm text-muted-foreground">
                              {alert.message}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              alert.severity === 'critical'
                                ? 'destructive'
                                : alert.severity === 'warning'
                                ? 'secondary'
                                : 'default'
                            }
                          >
                            {alert.severity}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              alert.status === 'resolved'
                                ? 'default'
                                : alert.status === 'acknowledged'
                                ? 'secondary'
                                : 'destructive'
                            }
                          >
                            {alert.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {new Date(alert.triggeredAt).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {alert.resolvedAt
                            ? new Date(alert.resolvedAt).toLocaleString()
                            : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
