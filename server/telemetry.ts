import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

const enabled = process.env.OTEL_ENABLED !== "false";
const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
let sdk: NodeSDK | undefined;

if (enabled && endpoint) {
  if (process.env.OTEL_DIAGNOSTICS === "true") {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  }

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "paymentswitch-api",
      [ATTR_SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION ?? "unknown",
      "deployment.environment": process.env.NODE_ENV ?? "development",
      "service.namespace": "paymentswitch",
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint.replace(/\/$/, "")}/v1/traces`,
    }),
    instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation()],
  });

  sdk.start();
  process.once("SIGTERM", () => {
    void sdk?.shutdown();
  });
  process.once("SIGINT", () => {
    void sdk?.shutdown();
  });
}

export async function shutdownTelemetry(): Promise<void> {
  await sdk?.shutdown();
}
