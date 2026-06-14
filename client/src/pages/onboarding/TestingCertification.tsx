import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TestHistoryDialog } from "@/components/TestHistoryDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Play,
  Award,
  Shield,
  AlertTriangle,
  FileCheck,
  Loader2,
  Calendar,
  Pause,
  PlayCircle,
  Trash2,
  History,
} from "lucide-react";
import ScheduleTestDialog from "@/components/ScheduleTestDialog";
import { SavedComparisonsTab } from "@/components/SavedComparisonsTab";

interface TestingCertificationProps {
  credentialId?: number;
}

export default function TestingCertification({ credentialId = 1 }: TestingCertificationProps) {
  const [runningTests, setRunningTests] = useState<Set<number>>(new Set());
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState<{ id: number; name: string } | null>(null);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);

  // Fetch test scenarios
  const { data: scenarios, isLoading: scenariosLoading } = trpc.testingCertification.getScenarios.useQuery();

  // Fetch test executions
  const { data: executions, refetch: refetchExecutions } = trpc.testingCertification.getExecutions.useQuery({
    credentialId,
  });

  // Fetch test summary
  const { data: summary, refetch: refetchSummary } = trpc.testingCertification.getTestSummary.useQuery({
    credentialId,
  });

  // Fetch certification status
  const { data: certification, refetch: refetchCertification } = trpc.testingCertification.getCertificationStatus.useQuery({
    credentialId,
  });

  // Fetch schedules
  const { data: schedules, refetch: refetchSchedules } = trpc.testingCertification.listSchedules.useQuery({
    credentialId,
  });

  // Pause schedule mutation
  const pauseScheduleMutation = trpc.testingCertification.pauseSchedule.useMutation({
    onSuccess: () => {
      toast.success("Schedule paused");
      refetchSchedules();
    },
  });

  // Resume schedule mutation
  const resumeScheduleMutation = trpc.testingCertification.resumeSchedule.useMutation({
    onSuccess: () => {
      toast.success("Schedule resumed");
      refetchSchedules();
    },
  });

  // Delete schedule mutation
  const deleteScheduleMutation = trpc.testingCertification.deleteSchedule.useMutation({
    onSuccess: () => {
      toast.success("Schedule deleted");
      refetchSchedules();
    },
  });

  // Execute test mutation
  const executeTestMutation = trpc.testingCertification.executeTest.useMutation({
    onSuccess: (data) => {
      toast.success(`Test ${data.status === "passed" ? "passed" : "failed"}!`);
      refetchExecutions();
      refetchSummary();
      setRunningTests((prev) => {
        const next = new Set(prev);
        next.delete(data.executionId);
        return next;
      });
    },
    onError: (error) => {
      toast.error(`Test failed: ${error.message}`);
      setRunningTests(new Set());
    },
  });

  // Submit for certification mutation
  const submitCertificationMutation = trpc.testingCertification.submitForCertification.useMutation({
    onSuccess: (data) => {
      toast.success(
        data.status === "passed"
          ? `Certification passed! Certificate ID: ${data.certificateId}`
          : "Certification failed. Please review the results."
      );
      refetchCertification();
    },
    onError: (error) => {
      toast.error(`Certification submission failed: ${error.message}`);
    },
  });

  const handleRunTest = async (scenarioId: number) => {
    setRunningTests((prev) => new Set(prev).add(scenarioId));
    await executeTestMutation.mutateAsync({
      credentialId,
      scenarioId,
    });
  };

  const handleSubmitCertification = async () => {
    if (!summary || summary.requiredPassed < summary.requiredTests) {
      toast.error("Please pass all required tests before submitting for certification");
      return;
    }

    await submitCertificationMutation.mutateAsync({ credentialId });
  };

  const getTestStatus = (scenarioId: number) => {
    if (!executions) return null;
    const execution = executions
      .filter((e) => e.scenarioId === scenarioId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    return execution;
  };

  const groupedScenarios = scenarios?.reduce((acc, scenario) => {
    if (!acc[scenario.category]) {
      acc[scenario.category] = [];
    }
    acc[scenario.category].push(scenario);
    return acc;
  }, {} as Record<string, typeof scenarios>);

  if (scenariosLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCheck className="h-5 w-5" />
            Testing & Certification Overview
          </CardTitle>
          <CardDescription>
            Complete all required tests and submit for certification to proceed to production
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {summary && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">
                    {summary.requiredPassed}/{summary.requiredTests}
                  </div>
                  <div className="text-sm text-muted-foreground">Required Tests</div>
                </div>
                <div className="bg-green-50 dark:bg-green-950 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">{summary.optionalPassed}</div>
                  <div className="text-sm text-muted-foreground">Optional Tests</div>
                </div>
                <div className="bg-purple-50 dark:bg-purple-950 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-purple-600">{summary.passRate}%</div>
                  <div className="text-sm text-muted-foreground">Pass Rate</div>
                </div>
                <div className="bg-orange-50 dark:bg-orange-950 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-orange-600">{summary.totalExecutions}</div>
                  <div className="text-sm text-muted-foreground">Total Executions</div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span>Overall Progress</span>
                  <span>{Math.round((summary.requiredPassed / summary.requiredTests) * 100)}%</span>
                </div>
                <Progress value={(summary.requiredPassed / summary.requiredTests) * 100} />
              </div>
            </>
          )}

          {certification && (
            <div className="mt-4 p-4 border rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Award className="h-5 w-5 text-yellow-600" />
                  <span className="font-semibold">Certification Status:</span>
                  <Badge
                    variant={
                      certification.status === "passed"
                        ? "default"
                        : certification.status === "failed"
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {certification.status}
                  </Badge>
                </div>
                {certification.certificateId && (
                  <div className="text-sm text-muted-foreground">
                    Certificate ID: {certification.certificateId}
                  </div>
                )}
              </div>
              {certification.score !== null && (
                <div className="mt-2">
                  <div className="flex justify-between text-sm mb-1">
                    <span>Score</span>
                    <span>{certification.score}/100</span>
                  </div>
                  <Progress value={certification.score ?? 0} />
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <Button
              onClick={handleSubmitCertification}
              disabled={
                !summary ||
                summary.requiredPassed < summary.requiredTests ||
                submitCertificationMutation.isPending ||
                (certification?.status === "in_progress")
              }
            >
              {submitCertificationMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Award className="h-4 w-4 mr-2" />
                  Submit for Certification
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Test Scenarios */}
      <Card>
        <CardHeader>
          <CardTitle>Test Scenarios</CardTitle>
          <CardDescription>Run tests to validate your integration</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="all">
            <TabsList className="grid w-full grid-cols-7">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="connectivity">Connectivity</TabsTrigger>
              <TabsTrigger value="authentication">Auth</TabsTrigger>
              <TabsTrigger value="transaction">Transaction</TabsTrigger>
              <TabsTrigger value="webhook">Webhook</TabsTrigger>
              <TabsTrigger value="security">Security</TabsTrigger>
              <TabsTrigger value="performance">Performance</TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="space-y-4 mt-4">
              {scenarios?.map((scenario) => {
                const status = getTestStatus(scenario.id);
                const isRunning = runningTests.has(scenario.id);

                return (
                  <div key={scenario.id} className="border rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="font-semibold">{scenario.name}</h4>
                          {!!scenario.isRequired && (
                            <Badge variant="destructive" className="text-xs">
                              Required
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-xs">
                            {scenario.category}
                          </Badge>
                          {status && (
                            <Badge
                              variant={
                                status.status === "passed"
                                  ? "default"
                                  : status.status === "failed"
                                  ? "destructive"
                                  : "secondary"
                              }
                            >
                              {status.status === "passed" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                              {status.status === "failed" && <XCircle className="h-3 w-3 mr-1" />}
                              {status.status === "running" && <Clock className="h-3 w-3 mr-1" />}
                              {status.status}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mb-2">{scenario.description}</p>
                        <p className="text-xs text-muted-foreground">
                          <strong>Passing Criteria:</strong> {scenario.passingCriteria}
                        </p>
                      </div>
                      <Button
                        onClick={() => handleRunTest(scenario.id)}
                        disabled={isRunning || executeTestMutation.isPending}
                        size="sm"
                      >
                        {isRunning ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            Running...
                          </>
                        ) : (
                          <>
                            <Play className="h-4 w-4 mr-1" />
                            Run Test
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </TabsContent>

            {Object.entries(groupedScenarios || {}).map(([category, categoryScenarios]) => (
              <TabsContent key={category} value={category} className="space-y-4 mt-4">
                {categoryScenarios.map((scenario) => {
                  const status = getTestStatus(scenario.id);
                  const isRunning = runningTests.has(scenario.id);

                  return (
                    <div key={scenario.id} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h4 className="font-semibold">{scenario.name}</h4>
                            {!!scenario.isRequired && (
                              <Badge variant="destructive" className="text-xs">
                                Required
                              </Badge>
                            )}
                            {status && (
                              <Badge
                                variant={
                                  status.status === "passed"
                                    ? "default"
                                    : status.status === "failed"
                                    ? "destructive"
                                    : "secondary"
                                }
                              >
                                {status.status === "passed" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                                {status.status === "failed" && <XCircle className="h-3 w-3 mr-1" />}
                                {status.status === "running" && <Clock className="h-3 w-3 mr-1" />}
                                {status.status}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mb-2">{scenario.description}</p>
                          <p className="text-xs text-muted-foreground">
                            <strong>Passing Criteria:</strong> {scenario.passingCriteria}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={() => handleRunTest(scenario.id)}
                            disabled={isRunning || executeTestMutation.isPending}
                            size="sm"
                          >
                            {isRunning ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                Running...
                              </>
                            ) : (
                              <>
                                <Play className="h-4 w-4 mr-1" />
                                Run Test
                              </>
                            )}
                          </Button>
                          <Button
                            onClick={() => {
                              setSelectedScenario({ id: scenario.id, name: scenario.name });
                              setScheduleDialogOpen(true);
                            }}
                            variant="outline"
                            size="sm"
                          >
                            <Calendar className="h-4 w-4 mr-1" />
                            Schedule
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      {/* Scheduled Tests */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Testing & Certification</CardTitle>
              <CardDescription>
                Complete mandatory test scenarios and get certified for production
              </CardDescription>
            </div>
            <Button variant="outline" onClick={() => setHistoryDialogOpen(true)}>
              <History className="h-4 w-4 mr-2" />
              View History
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {schedules && schedules.length > 0 ? (
            <div className="space-y-3">
              {schedules.map((schedule) => {
                const scenario = scenarios?.find((s) => s.id === schedule.scenarioId);
                const isActive = schedule.isActive === 1;

                return (
                  <div
                    key={schedule.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium">{scenario?.name || "Unknown Test"}</h4>
                        {isActive ? (
                          <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">
                            Active
                          </span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full">
                            Paused
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {schedule.frequency === "daily" && `Every day at ${schedule.scheduledTime}`}
                        {schedule.frequency === "weekly" &&
                          `Every ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][schedule.scheduledDay || 0]} at ${schedule.scheduledTime}`}
                        {schedule.frequency === "monthly" &&
                          `Day ${schedule.scheduledDay} of every month at ${schedule.scheduledTime}`}
                        {schedule.frequency === "custom" &&
                          `Every ${schedule.customIntervalHours} hour${schedule.customIntervalHours !== 1 ? "s" : ""}`}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Next run: {new Date(schedule.nextRunAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {isActive ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => pauseScheduleMutation.mutate({ scheduleId: schedule.id })}
                          disabled={pauseScheduleMutation.isPending}
                        >
                          <Pause className="h-4 w-4 mr-1" />
                          Pause
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => resumeScheduleMutation.mutate({ scheduleId: schedule.id })}
                          disabled={resumeScheduleMutation.isPending}
                        >
                          <PlayCircle className="h-4 w-4 mr-1" />
                          Resume
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => deleteScheduleMutation.mutate({ scheduleId: schedule.id })}
                        disabled={deleteScheduleMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">
              No scheduled tests. Click "Schedule" on any test scenario to create a schedule.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Schedule Dialog */}
      {selectedScenario && (
        <ScheduleTestDialog
          open={scheduleDialogOpen}
          onOpenChange={setScheduleDialogOpen}
          credentialId={credentialId}
          scenarioId={selectedScenario.id}
          scenarioName={selectedScenario.name}
        />
      )}

      {/* History Dialog */}
      <TestHistoryDialog
        open={historyDialogOpen}
        onOpenChange={setHistoryDialogOpen}
        credentialId={credentialId}
      />

      {/* Saved Comparisons */}
      <Card>
        <CardHeader>
          <CardTitle>Saved Comparisons</CardTitle>
          <CardDescription>
            View and manage saved test comparisons
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SavedComparisonsTab credentialId={credentialId} />
        </CardContent>
      </Card>
    </div>
  );
}
