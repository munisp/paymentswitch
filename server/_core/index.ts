import "dotenv/config";
import "../telemetry";
import express from "express";
import compression from "compression";
import { createServer } from "http";
import net from "net";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../lib/logger";
import { securityHeaders } from "../middleware/security-headers";
import { corsMiddleware } from "../middleware/cors-config";
import { startRetryProcessor } from "../onboarding/retryScheduler";
import { startTestScheduler } from "../onboarding/testScheduler";
import { startRateAlertMonitor } from "../jobs/rateAlertMonitor";
import { startCleanupJob } from "../jobs/cleanupJob";
import { seedOutboundData } from "../services/outboundRemittanceDbService";
import {
  startTransferLifecycleWorker,
  stopTransferLifecycleWorker,
} from "../services/transferLifecycleWorker";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import {
  renderPrometheus,
  setMultipartAbandonedGauge,
} from "../observability/metrics";
import {
  generalRateLimiter,
  rateLimitErrorHandler,
} from "../middleware/rateLimitMiddleware";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { authenticateKeycloakPrincipal } from "../security/keycloakAuth";
import { evaluatePbac, OpaUnavailableError } from "../security/opaClient";
import { traceContextMiddleware } from "../middleware/trace-context";
import { createPaymentRestRouter } from "../api/paymentRestRoutes";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Trust proxy for proper protocol detection behind reverse proxies (nginx, APISIX, etc.)
  const trustProxy = process.env.TRUST_PROXY || "1";
  app.set(
    "trust proxy",
    trustProxy === "true" ? true : trustProxy === "false" ? false : trustProxy
  );

  // Security headers (CSP, HSTS, X-Frame-Options, etc.)
  app.use(securityHeaders);

  // CORS
  app.use(corsMiddleware);

  // Gzip/deflate compression for all responses
  app.use(compression({ level: 6, threshold: 1024 }));

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.use(traceContextMiddleware);

  // Prometheus scrape endpoint is intentionally outside API rate limiting.
  app.get("/metrics", async (_req, res) => {
    try {
      const { count, and, eq, lt } = await import("drizzle-orm");
      const { multipartUploadSessions } = await import("../../drizzle/schema");
      const database = await (await import("../db")).getDb();
      if (database) {
        const [row] = await database
          .select({ count: count() })
          .from(multipartUploadSessions)
          .where(
            and(
              eq(multipartUploadSessions.status, "active"),
              lt(multipartUploadSessions.expiresAt, new Date())
            )
          );
        setMultipartAbandonedGauge(Number(row?.count ?? 0));
      }
      res.type("text/plain; version=0.0.4").send(renderPrometheus());
    } catch (error) {
      logger.warn({ err: error }, "Prometheus database refresh failed");
      res.type("text/plain; version=0.0.4").send(renderPrometheus());
    }
  });

  // Apply general rate limiting to all API routes
  app.use("/api", generalRateLimiter);

  // Rate limit error handler
  app.use(rateLimitErrorHandler);
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // Fail-closed Permify authorization check for the admin dashboard and service clients.
  app.post("/api/v1/authz/check", async (req, res) => {
    try {
      const principal = await authenticateKeycloakPrincipal(req);
      if (!principal) {
        res
          .status(401)
          .json({ allowed: false, error: "Bearer authentication required" });
        return;
      }

      const body = req.body as {
        subject?: { type?: unknown; id?: unknown };
        permission?: unknown;
        resource?: { type?: unknown; id?: unknown };
        entity?: { type?: unknown; id?: unknown };
        tenant_id?: unknown;
      };
      const subject = body.subject;
      const resource = body.resource ?? body.entity;
      if (
        subject?.type !== "user" ||
        typeof subject.id !== "string" ||
        typeof body.permission !== "string" ||
        resource == null ||
        typeof resource.type !== "string" ||
        typeof resource.id !== "string"
      ) {
        res.status(400).json({
          allowed: false,
          error: "Invalid authorization check payload",
        });
        return;
      }

      if (
        subject.id !== principal.subject &&
        subject.id !== String(principal.user.id)
      ) {
        res.status(403).json({
          allowed: false,
          error: "Subject does not match authenticated user",
        });
        return;
      }

      const requestedTenant =
        typeof body.tenant_id === "string" ? body.tenant_id.trim() : "";
      if (!requestedTenant || requestedTenant !== principal.tenantId) {
        res.status(403).json({
          allowed: false,
          error: "Tenant does not match authenticated identity",
        });
        return;
      }

      let pbacAllowed: boolean;
      try {
        pbacAllowed = await evaluatePbac({
          subject: {
            id: subject.id,
            roles: principal.roles,
            tenantId: principal.tenantId,
            tenant_id: principal.tenantId,
            mfa_verified: principal.mfaVerified,
          },
          action: body.permission,
          resource: {
            type: resource.type,
            id: resource.id,
            tenantId: requestedTenant,
            tenant_id: requestedTenant,
          },
          tenantId: requestedTenant,
          source: "api",
        });
      } catch (error) {
        if (error instanceof OpaUnavailableError) {
          res.status(503).json({
            allowed: false,
            error: "Policy service unavailable",
          });
          return;
        }
        throw error;
      }
      if (!pbacAllowed) {
        res.status(403).json({ allowed: false, error: "Policy denied" });
        return;
      }

      const permifyUrl = process.env.PERMIFY_URL;
      const tenantId = process.env.PERMIFY_TENANT_ID;
      if (!permifyUrl || !tenantId) {
        res.status(503).json({
          allowed: false,
          error: "Authorization service is not configured",
        });
        return;
      }

      const response = await fetch(
        `${permifyUrl.replace(/\/$/, "")}/v1/tenants/${encodeURIComponent(tenantId)}/permissions/check`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            tenant_id: tenantId,
            entity: { type: resource.type, id: resource.id },
            permission: body.permission,
            subject: { type: "user", id: subject.id },
          }),
          signal: AbortSignal.timeout(5000),
        }
      );
      if (!response.ok) {
        res
          .status(503)
          .json({ allowed: false, error: "Authorization service unavailable" });
        return;
      }

      const result = (await response.json()) as { can?: unknown };
      const allowed =
        result.can === true || result.can === "CHECK_RESULT_ALLOWED";
      res.status(allowed ? 200 : 403).json({ allowed });
    } catch (error) {
      logger.warn({ err: error }, "Permify authorization check failed closed");
      res
        .status(503)
        .json({ allowed: false, error: "Authorization service unavailable" });
    }
  });

  app.use(createPaymentRestRouter());

  // tRPC API middleware
  const trpcMiddleware = createExpressMiddleware({
    router: appRouter,
    createContext,
  });

  // API versioning: v1 is the current version
  app.use("/api/v1/trpc", trpcMiddleware);
  // Backward-compatible unversioned route
  app.use("/api/trpc", trpcMiddleware);

  // API version info endpoint
  app.get("/api/version", (_req, res) => {
    res.json({
      current: "v1",
      supported: ["v1"],
      deprecated: [],
    });
  });

  // Health, liveness, and readiness probes for Kubernetes
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });
  app.get("/livez", (_req, res) => {
    res.status(200).json({ status: "alive", uptime: process.uptime() });
  });
  app.get("/readyz", async (_req, res) => {
    try {
      const db = await import("../db");
      const dbInstance = await db.getDb();
      if (dbInstance) {
        res.status(200).json({ status: "ready", db: "connected" });
      } else {
        res.status(503).json({ status: "not_ready", db: "no_pool" });
      }
    } catch (err) {
      console.error("Readiness check failed:", err);
      res.status(503).json({ status: "not_ready", db: "disconnected" });
    }
  });

  // Degradation status — reports which infrastructure services are live vs seed
  app.get("/api/status/degradation", async (_req, res) => {
    const {
      getKafkaLiveStatus,
      getRedisLiveStatus,
      getPostgresLiveStatus,
      getTigerBeetleLiveStatus,
    } = await import("../lib/infraClient");
    const checks = await Promise.allSettled([
      getKafkaLiveStatus(),
      getRedisLiveStatus(),
      getPostgresLiveStatus(),
      getTigerBeetleLiveStatus(),
    ]);
    const services = ["kafka", "redis", "postgresql", "tigerbeetle"];
    const statuses = services.map((name, i) => {
      const c = checks[i];
      return {
        service: name,
        status:
          c.status === "fulfilled" && c.value
            ? ("live" as const)
            : ("degraded" as const),
      };
    });
    const overallDegraded = statuses.some(s => s.status === "degraded");
    res.json({
      mode: overallDegraded ? "degraded" : "full",
      services: statuses,
      timestamp: new Date().toISOString(),
    });
  });

  // OpenAPI/Swagger documentation endpoint
  app.get("/api/docs", (_req, res) => {
    const html = `<!DOCTYPE html>
<html><head><title>Payment Switch API Docs</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
</head><body>
<div id="swagger-ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: '/api/docs/openapi.yaml', dom_id: '#swagger-ui' });</script>
</body></html>`;
    res.type("html").send(html);
  });

  // Serve the OpenAPI spec file
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  app.get("/api/docs/openapi.yaml", (_req, res) => {
    res.sendFile(path.resolve(__dirname, "../../docs/api/openapi.yaml"));
  });
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000", 10);
  const isProduction = process.env.NODE_ENV === "production";
  const port = isProduction
    ? preferredPort
    : await findAvailablePort(preferredPort);

  if (!isProduction && port !== preferredPort) {
    logger.warn({ preferredPort, port }, "Port busy, using alternative");
  }

  server.listen(port, async () => {
    logger.info({ port, env: process.env.NODE_ENV }, "Server started");

    // Start webhook retry processor
    startRetryProcessor();

    // Test scheduling is opt-in outside production and is never started in production.
    if (!isProduction && process.env.ENABLE_TEST_SCHEDULER === "true") {
      startTestScheduler();
    }

    // Start rate alert monitor
    startRateAlertMonitor();

    // Start cleanup job
    startCleanupJob();

    // Seed data is explicit, non-production-only test tooling. Production never
    // receives plausible seed rows when a live database is empty or unavailable.
    if (!isProduction && process.env.ENABLE_SEED_DATA === "true") {
      try {
        await seedOutboundData();
      } catch (err) {
        logger.warn({ err }, "Explicit non-production outbound seed failed");
      }
    }

    // Start transfer lifecycle background worker
    startTransferLifecycleWorker();
  });

  // Graceful shutdown handler
  let isShuttingDown = false;
  const SHUTDOWN_TIMEOUT_MS = parseInt(
    process.env.SHUTDOWN_TIMEOUT_MS || "15000",
    10
  );

  async function gracefulShutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, "Graceful shutdown initiated");

    // Stop accepting new connections
    server.close(() => {
      logger.info("HTTP server closed");
    });

    // Allow in-flight requests to complete
    const forceExit = setTimeout(() => {
      logger.warn("Shutdown timeout reached, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      // Stop background workers
      stopTransferLifecycleWorker();

      // Drain database pool
      const db = await import("../db");
      // getDb initializes pool; on shutdown we just log
      logger.info("Database connections will be closed by pool timeout");
    } catch (e) {
      logger.warn({ err: e }, "Error during shutdown cleanup");
    }

    logger.info("Graceful shutdown complete");
    process.exit(0);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

startServer().catch(err => {
  logger.fatal({ err }, "Server failed to start");
  process.exit(1);
});
