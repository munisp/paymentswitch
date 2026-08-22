import { shutdownTelemetry } from "../telemetry";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { runMultipartCleanupOnce } from "./cleanupJob";

const tracer = trace.getTracer("paymentswitch-multipart-cleanup");

tracer.startActiveSpan("cleanup.multipart.batch", async span => {
  span.setAttribute("cleanup.worker", "multipart-cleanup-runner");
  span.setAttribute(
    "deployment.environment",
    process.env.NODE_ENV ?? "development"
  );

  try {
    const result = await runMultipartCleanupOnce();
    span.setAttributes({
      "cleanup.claimed_count": result.claimed,
      "cleanup.aborted_count": result.aborted,
      "cleanup.failed_count": result.failed,
    });
    if (result.failed > 0) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: "Multipart cleanup had failures",
      });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
    console.log(JSON.stringify({ service: "multipart-cleanup", ...result }));
    process.exitCode = result.failed > 0 ? 1 : 0;
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({ code: SpanStatusCode.ERROR });
    console.error("multipart cleanup failed", error);
    process.exitCode = 1;
  } finally {
    span.end();
    await shutdownTelemetry();
  }
});
