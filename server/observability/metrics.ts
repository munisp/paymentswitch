type Labels = Record<string, string>;

type Metric = {
  help: string;
  type: "counter" | "gauge";
  values: Map<string, number>;
};

const metrics = new Map<string, Metric>();

function key(labels: Labels): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
    .join(",");
}

function metric(name: string, help: string, type: Metric["type"]): Metric {
  let value = metrics.get(name);
  if (!value) {
    value = { help, type, values: new Map() };
    metrics.set(name, value);
  }
  return value;
}

function add(
  name: string,
  help: string,
  type: Metric["type"],
  value: number,
  labels: Labels = {}
): void {
  const target = metric(name, help, type);
  const labelsKey = key(labels);
  target.values.set(labelsKey, (target.values.get(labelsKey) ?? 0) + value);
}

export function recordMultipartStarted(): void {
  add(
    "paymentswitch_multipart_uploads_started_total",
    "Multipart uploads started.",
    "counter",
    1
  );
  add(
    "paymentswitch_multipart_uploads_active",
    "Multipart uploads currently active in this process.",
    "gauge",
    1
  );
}

export function recordMultipartCompleted(): void {
  add(
    "paymentswitch_multipart_uploads_completed_total",
    "Multipart uploads completed.",
    "counter",
    1
  );
  add(
    "paymentswitch_multipart_uploads_active",
    "Multipart uploads currently active in this process.",
    "gauge",
    -1
  );
}

export function recordMultipartAborted(reason: string): void {
  add(
    "paymentswitch_multipart_uploads_aborted_total",
    "Multipart uploads aborted.",
    "counter",
    1,
    { reason }
  );
  add(
    "paymentswitch_multipart_uploads_active",
    "Multipart uploads currently active in this process.",
    "gauge",
    -1
  );
}

export function recordCleanupDuration(durationSeconds: number): void {
  add(
    "paymentswitch_multipart_cleanup_duration_seconds_sum",
    "Total multipart cleanup worker duration in seconds.",
    "counter",
    durationSeconds
  );
  add(
    "paymentswitch_multipart_cleanup_duration_seconds_count",
    "Number of multipart cleanup worker duration observations.",
    "counter",
    1
  );
}

export function recordCleanupClaimed(count: number): void {
  add(
    "paymentswitch_multipart_cleanup_claimed_total",
    "Multipart sessions claimed by cleanup workers.",
    "counter",
    count
  );
}
export function recordCleanupAborted(count: number): void {
  add(
    "paymentswitch_multipart_cleanup_aborted_total",
    "Multipart sessions successfully aborted by cleanup workers.",
    "counter",
    count
  );
}
export function recordCleanupRetry(reason: string): void {
  add(
    "paymentswitch_multipart_cleanup_retries_total",
    "Multipart cleanup retries scheduled.",
    "counter",
    1,
    { reason }
  );
}
export function recordCleanupFailure(reason: string): void {
  add(
    "paymentswitch_multipart_cleanup_failures_total",
    "Multipart cleanup failures.",
    "counter",
    1,
    { reason }
  );
}
export function recordMultipartAbandoned(): void {
  add(
    "paymentswitch_multipart_uploads_abandoned_total",
    "Multipart uploads found past their expiration time.",
    "counter",
    1
  );
}

export function setMultipartAbandonedGauge(count: number): void {
  const target = metric(
    "paymentswitch_multipart_uploads_abandoned",
    "Multipart uploads currently past expiration.",
    "gauge"
  );
  target.values.set("", count);
}

export function recordDraftConflict(): void {
  add(
    "paymentswitch_onboarding_draft_conflicts_total",
    "Optimistic concurrency conflicts while saving onboarding drafts.",
    "counter",
    1,
    {}
  );
}

export function recordRedisCircuitTrip(): void {
  add(
    "paymentswitch_redis_circuit_breaker_trips_total",
    "Redis circuit breaker openings.",
    "counter",
    1
  );
}

export function recordRedisTopologyChange(): void {
  add(
    "paymentswitch_redis_sentinel_topology_changes_total",
    "Redis Sentinel primary topology changes observed by the application.",
    "counter",
    1
  );
}

export function recordRedisFailoverDuration(durationSeconds: number): void {
  add(
    "paymentswitch_redis_sentinel_failover_duration_seconds_sum",
    "Total Redis Sentinel failover discovery duration in seconds.",
    "counter",
    durationSeconds
  );
  add(
    "paymentswitch_redis_sentinel_failover_duration_seconds_count",
    "Number of Redis Sentinel failover discovery observations.",
    "counter",
    1
  );
}

export function recordRedisCircuitOperationFailure(): void {
  add(
    "paymentswitch_redis_circuit_breaker_operation_failures_total",
    "Redis operations that failed while managed by the circuit breaker.",
    "counter",
    1
  );
}

export function recordTwoFactorRedisUnavailable(
  operation: "reserve" | "release"
): void {
  add(
    "paymentswitch_two_factor_redis_fail_closed_total",
    "2FA operations rejected because distributed Redis state was unavailable.",
    "counter",
    1,
    { operation }
  );
}

export function recordDraftSave(): void {
  add(
    "paymentswitch_onboarding_draft_saves_total",
    "Successful onboarding draft saves.",
    "counter",
    1,
    {}
  );
}

export function renderPrometheus(): string {
  const lines: string[] = [];
  for (const [name, definition] of Array.from(metrics.entries())) {
    lines.push(`# HELP ${name} ${definition.help}`);
    lines.push(`# TYPE ${name} ${definition.type}`);
    for (const [labelsKey, value] of Array.from(definition.values.entries())) {
      const suffix = labelsKey ? `{${labelsKey}}` : "";
      lines.push(`${name}${suffix} ${Math.max(0, value)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
