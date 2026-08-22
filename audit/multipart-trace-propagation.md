# Multipart upload distributed trace propagation

## Trace contract

The platform uses W3C Trace Context. The incoming `traceparent` and optional `tracestate` headers are accepted by the OpenTelemetry HTTP instrumentation and propagated through the Express/tRPC request context. APISIX must preserve these headers and must not generate a second unrelated trace for the same request.

The browser starts the request. APISIX forwards:

```http
traceparent: 00-<32-hex-trace-id>-<16-hex-parent-id>-01
tracestate: <optional-vendor-state>
```

The API creates `onboarding.multipart.initiate`, calls the S3 multipart-initiation operation, and stores the sanitized `traceparent` value on `multipart_upload_sessions`. The database row is the handoff boundary between the request and the later CronJob.

## API and gateway requirements

APISIX should preserve `traceparent` and `tracestate` in its proxy header allowlist. It should not log those values with credentials or raw document metadata. If an APISIX OpenTelemetry plugin is enabled, use the same W3C propagation format and configure it as a producer of the incoming server span rather than overwriting the request context.

The API’s `server/telemetry.ts` must load before Express and enable HTTP/Express instrumentation. For services called by the API, use the OpenTelemetry HTTP client instrumentation or explicitly inject the current context:

```ts
const headers: Record<string, string> = {};
propagation.inject(context.active(), headers);
await fetch(target, { headers });
```

For Dapr or message-based calls, include the same carrier in the message metadata. Consumers must extract it before starting the handler span:

```ts
const parent = propagation.extract(ROOT_CONTEXT, message.metadata);
await context.with(parent, async () => {
  await tracer.startActiveSpan("ledger.transfer", async span => {
    // process the message
    span.end();
  });
});
```

## Background cleanup

The cleanup worker runs later and cannot rely on the original process context. It reads `multipart_upload_sessions.traceparent`, extracts it into a new parent context, and starts:

```text
cleanup.multipart.session
  └── storage.s3.abort_multipart
```

The worker also creates a root `cleanup.multipart.batch` span for the CronJob execution. The session span is linked to the original API trace through the persisted W3C parent. This makes the trace searchable from the original multipart initialization through cleanup, while preserving the fact that the cleanup execution occurred in a different process and time window.

If the traceparent is absent or invalid, the worker starts a new trace and records `multipart.trace_context_missing=true`; it must never trust arbitrary user-supplied trace IDs as identity or authorization data.

## Security controls

Trace context is correlation metadata only. It must not authorize object access, select a user, or replace the authenticated session. Never store cookies, Authorization headers, access keys, presigned URLs, raw filenames, or document content in spans. Persist only a validated W3C `traceparent` with a maximum length of 255 characters; treat `tracestate` as optional and do not persist vendor secrets.

## Verification

1. Send a request through APISIX with a known test `traceparent`.
2. Confirm the API emits `onboarding.multipart.initiate` with the same trace ID.
3. Query the multipart session and verify the stored traceparent has the expected format.
4. Run the cleanup CronJob after expiry.
5. Confirm the cleanup batch span has a new worker trace and the cleanup session span has the original trace ID as its parent.
6. Confirm `storage.s3.abort_multipart` is a child of `cleanup.multipart.session`.
7. Repeat with a missing/malformed traceparent and verify the operation succeeds with a new trace, without accepting unauthorized storage access.
