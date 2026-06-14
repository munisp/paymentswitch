import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Code,
  Download,
  PlayCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  Terminal,
  Book,
  Rocket,
} from "lucide-react";
import ApiKeyManagement from "@/components/ApiKeyManagement";
import { useParams } from "wouter";

export default function IntegrationDevelopment() {
  const params = useParams<{ applicationId?: string }>();
  const [applicationId] = useState(Number(params.applicationId) || 1);
  const [selectedSdk, setSelectedSdk] = useState<string>("javascript");
  const [runningTest, setRunningTest] = useState<string | null>(null);

  // Get sandbox environment
  const { data: environmentData, isLoading: envLoading } = trpc.integration.getEnvironment.useQuery({
    applicationId,
    environmentType: "sandbox",
  });
  const environment = environmentData as any;

  // Get integration tests
  const { data: tests = [], refetch: refetchTests } = trpc.integration.getTests.useQuery({
    applicationId,
  });

  // Get API documentation
  const { data: apiDocs } = trpc.integration.getApiDocs.useQuery();

  // Provision sandbox mutation
  const provisionMutation = trpc.integration.provisionSandbox.useMutation({
    onSuccess: () => {
      toast.success("Sandbox environment provisioned successfully!");
    },
    onError: (error) => {
      toast.error(`Failed to provision sandbox: ${error.message}`);
    },
  });

  // Download SDK mutation
  const downloadMutation = trpc.integration.downloadSdk.useMutation({
    onSuccess: (data) => {
      // Trigger download
      window.open(data.downloadUrl, "_blank");
      toast.success(`${data.sdkType} SDK downloaded`);
    },
    onError: (error) => {
      toast.error(`Failed to download SDK: ${error.message}`);
    },
  });

  // Run test mutation
  const runTestMutation = trpc.integration.runTest.useMutation({
    onSuccess: (data) => {
      setRunningTest(null);
      refetchTests();
      if (data.passed) {
        toast.success("Test passed!");
      } else {
        toast.error("Test failed");
      }
    },
    onError: (error) => {
      setRunningTest(null);
      toast.error(`Test execution failed: ${error.message}`);
    },
  });

  const handleProvisionSandbox = async () => {
    await provisionMutation.mutateAsync({ applicationId });
  };

  const handleDownloadSdk = async () => {
    await downloadMutation.mutateAsync({
      applicationId,
      sdkType: selectedSdk as any,
      version: "1.0.0",
    });
  };

  const handleRunTest = async (testType: string, testName: string) => {
    setRunningTest(`${testType}-${testName}`);
    await runTestMutation.mutateAsync({
      applicationId,
      testType,
      testName,
    });
  };

  const requiredTests = [
    { type: "connectivity", name: "API Connectivity Test" },
    { type: "authentication", name: "Authentication Test" },
    { type: "transaction", name: "Transaction Creation Test" },
    { type: "webhook", name: "Webhook Delivery Test" },
  ];

  const getTestStatus = (testType: string, testName: string) => {
    const test = tests.find((t) => t.test_type === testType && t.test_name === testName);
    return test?.status || "pending";
  };

  if (envLoading) {
    return (
      <div className="container max-w-6xl py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-6xl py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Integration Development</h1>
        <p className="text-muted-foreground">
          Build and test your integration with our sandbox environment
        </p>
      </div>

      {/* Sandbox Environment */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Terminal className="h-5 w-5" />
                Sandbox Environment
              </CardTitle>
              <CardDescription>
                Your isolated testing environment with API credentials
              </CardDescription>
            </div>
            {!environment && (
              <Button
                onClick={handleProvisionSandbox}
                disabled={provisionMutation.isPending}
              >
                {provisionMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Provision Sandbox
              </Button>
            )}
          </div>
        </CardHeader>
        {environment && (
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium mb-1">API Endpoint</p>
                <code className="text-sm bg-muted px-2 py-1 rounded">
                  {environment.api_endpoint}
                </code>
              </div>
              <div>
                <p className="text-sm font-medium mb-1">Status</p>
                <Badge variant={environment.status === "active" ? "default" : "secondary"}>
                  {environment.status}
                </Badge>
              </div>
            </div>

            {environment.credentials && (
              <div className="space-y-2">
                <p className="text-sm font-medium">API Credentials</p>
                <div className="bg-muted p-4 rounded space-y-2">
                  <div>
                    <p className="text-xs text-muted-foreground">API Key</p>
                    <code className="text-sm">{environment.credentials.api_key}</code>
                  </div>
                  <Alert>
                    <AlertDescription className="text-xs">
                      Keep your credentials secure. Never commit them to version control.
                    </AlertDescription>
                  </Alert>
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* SDK Downloads & API Docs */}
      <Tabs defaultValue="sdk" className="mb-6">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="sdk">SDK Downloads</TabsTrigger>
          <TabsTrigger value="docs">API Documentation</TabsTrigger>
        </TabsList>

        <TabsContent value="sdk">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="h-5 w-5" />
                SDK Libraries
              </CardTitle>
              <CardDescription>
                Download our official SDKs to integrate faster
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-5 gap-4 mb-4">
                {["javascript", "python", "java", "php", "dotnet"].map((sdk) => (
                  <Button
                    key={sdk}
                    variant={selectedSdk === sdk ? "default" : "outline"}
                    onClick={() => setSelectedSdk(sdk)}
                    className="capitalize"
                  >
                    {sdk === "dotnet" ? ".NET" : sdk}
                  </Button>
                ))}
              </div>
              <Button
                onClick={handleDownloadSdk}
                disabled={downloadMutation.isPending || !environment}
              >
                {downloadMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                <Download className="h-4 w-4 mr-2" />
                Download {selectedSdk === "dotnet" ? ".NET" : selectedSdk} SDK
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="docs">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Book className="h-5 w-5" />
                API Reference
              </CardTitle>
              <CardDescription>
                Complete API documentation with examples
              </CardDescription>
            </CardHeader>
            <CardContent>
              {apiDocs && (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <Badge>Version {apiDocs.version}</Badge>
                    <code className="text-sm">{apiDocs.baseUrl}</code>
                  </div>

                  <div className="space-y-4">
                    {apiDocs.endpoints.map((endpoint, index) => (
                      <div key={index} className="border rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline">{endpoint.method}</Badge>
                          <code className="text-sm">{endpoint.path}</code>
                        </div>
                        <p className="text-sm text-muted-foreground mb-3">
                          {endpoint.description}
                        </p>
                        <div className="text-xs">
                          <p className="font-medium mb-1">Parameters:</p>
                          <ul className="list-disc list-inside space-y-1">
                            {endpoint.parameters.map((param, idx) => (
                              <li key={idx}>
                                <code>{param.name}</code> ({param.type})
                                {param.required && (
                                  <Badge variant="destructive" className="ml-2 text-xs">
                                    required
                                  </Badge>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* API Key Management */}
      {environment && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <ApiKeyManagement
              environmentId={environment.id}
              environmentType={environment.environment_type}
            />
          </CardContent>
        </Card>
      )}

      {/* Integration Tests */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlayCircle className="h-5 w-5" />
            Integration Tests
          </CardTitle>
          <CardDescription>
            Run tests to verify your integration is working correctly
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {requiredTests.map((test) => {
              const status = getTestStatus(test.type, test.name);
              const isRunning = runningTest === `${test.type}-${test.name}`;

              return (
                <div
                  key={`${test.type}-${test.name}`}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    {status === "passed" && (
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    )}
                    {status === "failed" && <XCircle className="h-5 w-5 text-red-600" />}
                    {status === "pending" && <Code className="h-5 w-5 text-gray-400" />}
                    {status === "running" && (
                      <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                    )}
                    <div>
                      <p className="font-medium">{test.name}</p>
                      <p className="text-sm text-muted-foreground capitalize">{status}</p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRunTest(test.type, test.name)}
                    disabled={!environment || isRunning || runTestMutation.isPending}
                  >
                    {isRunning && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Run Test
                  </Button>
                </div>
              );
            })}
          </div>

          {tests.filter((t) => t.status === "passed").length === requiredTests.length && (
            <Alert className="mt-6 border-green-600">
              <Rocket className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-600">
                All integration tests passed! You're ready to proceed to testing & certification.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
