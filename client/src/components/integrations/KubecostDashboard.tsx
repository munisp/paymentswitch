import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { DollarSign, TrendingDown, Cpu, HardDrive, Activity } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function KubecostDashboard() {
  const { data: report, isLoading: loading } = trpc.integrations.cost.getReport.useQuery();

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(value);
  };

  const getEfficiencyColor = (efficiency: number) => {
    if (efficiency >= 70) return "text-green-600";
    if (efficiency >= 50) return "text-yellow-600";
    return "text-red-600";
  };

  const getEfficiencyBadge = (efficiency: number) => {
    if (efficiency >= 70) return <Badge className="bg-green-500">Good</Badge>;
    if (efficiency >= 50) return <Badge variant="secondary">Fair</Badge>;
    return <Badge variant="destructive">Poor</Badge>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Activity className="w-6 h-6 animate-spin mr-2" />
        <span>Loading cost data...</span>
      </div>
    );
  }

  const totalSavings = report?.recommendations?.reduce(
    (sum: number, r: any) => sum + (r.monthly_savings || 0),
    0
  ) || 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <DollarSign className="w-6 h-6" />
          Kubecost Cost Monitoring
        </h2>
        <p className="text-muted-foreground">
          Kubernetes cost allocation, efficiency, and optimization recommendations
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Cost (7d)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(report?.total_cost || 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">CPU Efficiency</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${getEfficiencyColor(report?.cluster_efficiency?.cpu_efficiency || 0)}`}>
              {((report?.cluster_efficiency?.cpu_efficiency || 0) * 100).toFixed(1)}%
            </div>
            <Progress
              value={(report?.cluster_efficiency?.cpu_efficiency || 0) * 100}
              className="mt-2"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">RAM Efficiency</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${getEfficiencyColor(report?.cluster_efficiency?.ram_efficiency || 0)}`}>
              {((report?.cluster_efficiency?.ram_efficiency || 0) * 100).toFixed(1)}%
            </div>
            <Progress
              value={(report?.cluster_efficiency?.ram_efficiency || 0) * 100}
              className="mt-2"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Potential Savings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(totalSavings)}/mo
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="w-5 h-5" />
              Cost by Namespace
            </CardTitle>
            <CardDescription>Resource costs broken down by namespace</CardDescription>
          </CardHeader>
          <CardContent>
            {!report?.by_namespace?.length ? (
              <div className="text-center py-8 text-muted-foreground">
                No namespace data available
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Namespace</TableHead>
                    <TableHead>CPU</TableHead>
                    <TableHead>RAM</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Efficiency</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.by_namespace.slice(0, 10).map((ns: any, idx: number) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{ns.namespace}</TableCell>
                      <TableCell>{formatCurrency(ns.cpu_cost || 0)}</TableCell>
                      <TableCell>{formatCurrency(ns.ram_cost || 0)}</TableCell>
                      <TableCell className="font-semibold">
                        {formatCurrency(ns.total_cost || 0)}
                      </TableCell>
                      <TableCell>
                        {getEfficiencyBadge((ns.efficiency || 0) * 100)}
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
              <TrendingDown className="w-5 h-5" />
              Savings Recommendations
            </CardTitle>
            <CardDescription>Optimization opportunities to reduce costs</CardDescription>
          </CardHeader>
          <CardContent>
            {!report?.recommendations?.length ? (
              <div className="text-center py-8 text-muted-foreground">
                No recommendations available
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead>Namespace</TableHead>
                    <TableHead>Savings</TableHead>
                    <TableHead>Confidence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.recommendations.slice(0, 10).map((rec: any, idx: number) => (
                    <TableRow key={idx}>
                      <TableCell>
                        <Badge variant="outline">{rec.type}</Badge>
                      </TableCell>
                      <TableCell>{rec.resource}</TableCell>
                      <TableCell>{rec.namespace}</TableCell>
                      <TableCell className="text-green-600 font-semibold">
                        {formatCurrency(rec.monthly_savings || 0)}/mo
                      </TableCell>
                      <TableCell>
                        <Progress value={(rec.confidence || 0) * 100} className="w-16" />
                      </TableCell>
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
            <HardDrive className="w-5 h-5" />
            Resource Breakdown
          </CardTitle>
          <CardDescription>Detailed cost breakdown by resource type</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-blue-50 rounded-lg">
              <div className="text-sm text-blue-600 font-medium">CPU Costs</div>
              <div className="text-xl font-bold text-blue-800">
                {formatCurrency(
                  report?.by_namespace?.reduce((sum: number, ns: any) => sum + (ns.cpu_cost || 0), 0) || 0
                )}
              </div>
            </div>
            <div className="p-4 bg-purple-50 rounded-lg">
              <div className="text-sm text-purple-600 font-medium">RAM Costs</div>
              <div className="text-xl font-bold text-purple-800">
                {formatCurrency(
                  report?.by_namespace?.reduce((sum: number, ns: any) => sum + (ns.ram_cost || 0), 0) || 0
                )}
              </div>
            </div>
            <div className="p-4 bg-green-50 rounded-lg">
              <div className="text-sm text-green-600 font-medium">Storage Costs</div>
              <div className="text-xl font-bold text-green-800">
                {formatCurrency(
                  report?.by_namespace?.reduce((sum: number, ns: any) => sum + (ns.pv_cost || 0), 0) || 0
                )}
              </div>
            </div>
            <div className="p-4 bg-orange-50 rounded-lg">
              <div className="text-sm text-orange-600 font-medium">Network Costs</div>
              <div className="text-xl font-bold text-orange-800">
                {formatCurrency(
                  report?.by_namespace?.reduce((sum: number, ns: any) => sum + (ns.network_cost || 0), 0) || 0
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
