# OpenTelemetry tracing for multipart uploads and cleanup

## Trace topology

The browser creates or propagates a W3C `traceparent` through the onboarding API request. The Node API creates spans for multipart initiation, presigning, completion, abort, draft persistence, and PostgreSQL operations. The cleanup CronJob starts a new root span for each batch and a child span for each claimed session and S3 `AbortMultipartUpload` call. The same `upload_id` and database session ID are recorded as span attributes, never as secrets.

Recommended span names are:

| Span                            | Kind     | Important attributes                                                              |
| ------------------------------- | -------- | --------------------------------------------------------------------------------- |
| `onboarding.multipart.initiate` | SERVER   | `app.user_scope`, `document.label`, `document.size_bytes`, `multipart.part_count` |
| `onboarding.multipart.complete` | SERVER   | `multipart.upload_id_hash`, `multipart.part_count`                                |
| `onboarding.draft.save`         | SERVER   | `onboarding.draft_version`, `onboarding.current_step`, `onboarding.conflict`      |
| `cleanup.multipart.batch`       | INTERNAL | `cleanup.claimed_count`, `cleanup.aborted_count`, `cleanup.failed_count`          |
| `cleanup.multipart.session`     | INTERNAL | `db.session_id`, `multipart.attempt`, `multipart.status`                          |
| `storage.s3.abort_multipart`    | CLIENT   | `server.address`, `aws.s3.bucket`, `aws.s3.key_prefix`, `error.type`              |
| `db.multipart.claim`            | CLIENT   | `db.system=postgresql`, `db.operation=SELECT_FOR_UPDATE_SKIP_LOCKED`              |

Do not record passwords, session cookies, access keys, full object keys, raw filenames, KYC content, JWTs, or presigned URLs. Hash upload IDs and redact object identifiers where the tracing backend is shared.

## Node initialization

Install and pin the official packages in the application image:

```bash
pnpm add @opentelemetry/api @opentelemetry/sdk-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/instrumentation-http \
  @opentelemetry/instrumentation-express \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions
```

Initialize tracing before importing Express, Drizzle, or the routers. A production bootstrap should set:

```bash
OTEL_SERVICE_NAME=paymentswitch-api
OTEL_SERVICE_VERSION=$RELEASE_VERSION
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,service.namespace=paymentswitch
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector.observability.svc:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.10
```

Use `NodeSDK` with `OTLPTraceExporter`, `HttpInstrumentation`, and `ExpressInstrumentation`; call `sdk.start()` before the application entrypoint and `sdk.shutdown()` during graceful termination. The API and cleanup runner must use different `OTEL_SERVICE_NAME` values, for example `paymentswitch-api` and `paymentswitch-multipart-cleanup`.

## Manual spans

Use the OpenTelemetry API around business operations:

```ts
import {
  context,
  propagation,
  trace,
  SpanStatusCode,
} from "@opentelemetry/api";

const tracer = trace.getTracer("paymentswitch-onboarding");

export async function tracedAbort(uploadId: string, key: string) {
  return tracer.startActiveSpan("storage.s3.abort_multipart", async span => {
    span.setAttribute("multipart.upload_id_hash", sha256(uploadId));
    span.setAttribute(
      "aws.s3.key_prefix",
      key.split("/").slice(0, 3).join("/")
    );
    try {
      const result = await abortMultipartUpload({ uploadId, key });
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
```

For asynchronous CronJob execution, do not pretend that the browser trace continues across hours. Start a new cleanup root span and link the session’s stored trace ID only if a trusted trace context was persisted. The database row should store a trace ID, not arbitrary request headers, if cross-phase correlation is required.

## Collector deployment

Deploy an OpenTelemetry Collector with OTLP HTTP and gRPC receivers, batch processing, memory limiting, and an enterprise exporter. The collector should enforce TLS/mTLS on external egress and redact attributes before export. A minimal internal configuration is:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
      http:
processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 512
  batch:
    timeout: 5s
    send_batch_size: 512
exporters:
  otlphttp/enterprise:
    endpoint: ${env:ENTERPRISE_OTLP_ENDPOINT}
    headers:
      Authorization: ${env:ENTERPRISE_OTLP_AUTH}
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlphttp/enterprise]
```

Expose collector port `4318` only inside the cluster, use NetworkPolicies to permit application namespaces, and monitor collector queue depth, export failures, dropped spans, and memory pressure.

## Verification

Generate a correlation ID by starting a test onboarding request and query the tracing backend for `onboarding.multipart.initiate`. Confirm a child `storage.s3.abort_multipart` span appears during cleanup, with the same trace ID for a single cleanup batch and the expected `multipart.attempt`. During chaos tests, verify S3 timeouts are recorded as span errors and that retry spans do not contain credentials or presigned URLs.
