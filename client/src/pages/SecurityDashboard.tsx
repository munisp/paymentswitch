import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Database, Lock, RefreshCw, Shield, ShieldAlert, Wifi } from "lucide-react";

type Dependency = {
  service?: string;
  status?: string;
  checkedAt?: string;
  details?: Record<string, unknown>;
  error?: string;
};

type Evidence = {
  source?: string;
  checkedAt?: string;
  status?: string;
  details?: Record<string, unknown>;
  error?: string | null;
  note?: string;
  score?: number | null;
  grade?: string | null;
  dependencies?: Dependency[];
};

function asEvidence(value: unknown): Evidence | null {
  return value && typeof value === "object" ? value as Evidence : null;
}

function statusVariant(status?: string) {
  if (status === "healthy") return "default" as const;
  if (status === "unavailable" || status === "misconfigured") return "destructive" as const;
  return "secondary" as const;
}

function dependencyRows(evidence: Evidence | null): Dependency[] {
  if (!evidence) return [];
  if (Array.isArray(evidence.dependencies)) return evidence.dependencies;
  if (evidence.status || evidence.source) {
    return [{ service: evidence.source ?? "Security dependency", status: evidence.status, checkedAt: evidence.checkedAt, details: evidence.details, error: evidence.error ?? undefined }];
  }
  return [];
}

function EvidencePanel({ title, icon: Icon, data, error, onRefresh }: { title: string; icon: typeof Shield; data: unknown; error: unknown; onRefresh: () => void }) {
  const evidence = asEvidence(data);
  const dependencies = dependencyRows(evidence);
  const errorText = error instanceof Error ? error.message : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base"><Icon className="h-5 w-5" />{title}</CardTitle>
        <Button variant="ghost" size="icon" onClick={onRefresh} aria-label={`Refresh ${title}`}><RefreshCw className="h-4 w-4" /></Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {!evidence && !errorText && <p className="text-sm text-muted-foreground">Loading live evidence…</p>}
        {errorText && <p className="text-sm text-destructive">Live evidence is unavailable: {errorText}</p>}
        {evidence && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusVariant(evidence.status)}>{evidence.status ?? "evidence-only"}</Badge>
              {evidence.source && <span className="text-sm text-muted-foreground">Source: {evidence.source}</span>}
              {evidence.checkedAt && <span className="text-xs text-muted-foreground">Checked {new Date(evidence.checkedAt).toLocaleString()}</span>}
            </div>
            {evidence.note && <p className="text-sm text-muted-foreground">{evidence.note}</p>}
            {evidence.error && <p className="text-sm text-destructive">{evidence.error}</p>}
            {evidence.score !== undefined && (
              <p className="text-sm">Scanner score: <strong>{evidence.score ?? "Unavailable"}</strong>{evidence.grade ? ` (${evidence.grade})` : ""}</p>
            )}
            {dependencies.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b"><th className="p-2 text-left">Dependency</th><th className="p-2 text-left">Status</th><th className="p-2 text-left">Details</th><th className="p-2 text-left">Error</th></tr></thead>
                  <tbody>
                    {dependencies.map((dependency, index) => (
                      <tr key={`${dependency.service ?? "dependency"}-${index}`} className="border-b align-top">
                        <td className="p-2">{dependency.service ?? "Unknown"}</td>
                        <td className="p-2"><Badge variant={statusVariant(dependency.status)}>{dependency.status ?? "unknown"}</Badge></td>
                        <td className="p-2 font-mono text-xs">{JSON.stringify(dependency.details ?? {})}</td>
                        <td className="p-2 text-xs text-destructive">{dependency.error ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function SecurityDashboard() {
  const ddos = trpc.security.ddosStatus.useQuery();
  const ransomware = trpc.security.ransomwareStatus.useQuery();
  const pbac = trpc.security.pbacStatus.useQuery();
  const vulnerabilities = trpc.security.vulnerabilityScore.useQuery();
  const resilience = trpc.security.resilienceStatus.useQuery();

  const refreshAll = () => {
    void ddos.refetch();
    void ransomware.refetch();
    void pbac.refetch();
    void vulnerabilities.refetch();
    void resilience.refetch();
  };

  return (
    <main className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold"><Shield className="h-6 w-6" />Security Evidence Center</h1>
            <p className="mt-1 text-sm text-muted-foreground">This view reports configured live probes only. It does not estimate attacks, policy decisions, backups, compliance, or vulnerability findings.</p>
          </div>
          <Button onClick={refreshAll}><RefreshCw className="mr-2 h-4 w-4" />Refresh evidence</Button>
        </header>
        <section className="grid gap-4 lg:grid-cols-2">
          <EvidencePanel title="OpenAppSec Edge Evidence" icon={ShieldAlert} data={ddos.data} error={ddos.error} onRefresh={() => void ddos.refetch()} />
          <EvidencePanel title="PostgreSQL Backup Evidence" icon={Database} data={ransomware.data} error={ransomware.error} onRefresh={() => void ransomware.refetch()} />
          <EvidencePanel title="Permify Authorization Evidence" icon={Lock} data={pbac.data} error={pbac.error} onRefresh={() => void pbac.refetch()} />
          <EvidencePanel title="Scanner and Dependency Evidence" icon={Activity} data={vulnerabilities.data} error={vulnerabilities.error} onRefresh={() => void vulnerabilities.refetch()} />
          <EvidencePanel title="Resilience Dependency Evidence" icon={Wifi} data={resilience.data} error={resilience.error} onRefresh={() => void resilience.refetch()} />
        </section>
      </div>
    </main>
  );
}
