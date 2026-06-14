import "dotenv/config";
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
import { startTransferLifecycleWorker, stopTransferLifecycleWorker } from "../services/transferLifecycleWorker";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { generalRateLimiter, rateLimitErrorHandler } from "../middleware/rateLimitMiddleware";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
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
  const trustProxy = process.env.TRUST_PROXY || '1';
  app.set('trust proxy', trustProxy === 'true' ? true : trustProxy === 'false' ? false : trustProxy);

  // Security headers (CSP, HSTS, X-Frame-Options, etc.)
  app.use(securityHeaders);

  // CORS
  app.use(corsMiddleware);
  
  // Gzip/deflate compression for all responses
  app.use(compression({ level: 6, threshold: 1024 }));

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  
  // Apply general rate limiting to all API routes
  app.use('/api', generalRateLimiter);
  
  // Rate limit error handler
  app.use(rateLimitErrorHandler);
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

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
      console.error('Readiness check failed:', err);
      res.status(503).json({ status: "not_ready", db: "disconnected" });
    }
  });

  // Degradation status — reports which infrastructure services are live vs seed
  app.get("/api/status/degradation", async (_req, res) => {
    const { getKafkaLiveStatus, getRedisLiveStatus, getPostgresLiveStatus, getTigerBeetleLiveStatus } = await import("../lib/infraClient");
    const checks = await Promise.allSettled([
      getKafkaLiveStatus(),
      getRedisLiveStatus(),
      getPostgresLiveStatus(),
      getTigerBeetleLiveStatus(),
    ]);
    const services = ['kafka', 'redis', 'postgresql', 'tigerbeetle'];
    const statuses = services.map((name, i) => {
      const c = checks[i];
      return {
        service: name,
        status: c.status === 'fulfilled' && c.value ? 'live' as const : 'degraded' as const,
      };
    });
    const overallDegraded = statuses.some(s => s.status === 'degraded');
    res.json({
      mode: overallDegraded ? 'degraded' : 'full',
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
    res.type('html').send(html);
  });

  // Serve the OpenAPI spec file
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  app.get("/api/docs/openapi.yaml", (_req, res) => {
    res.sendFile(path.resolve(__dirname, '../../docs/api/openapi.yaml'));
  });
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    logger.warn({ preferredPort, port }, 'Port busy, using alternative');
  }

  server.listen(port, async () => {
    logger.info({ port, env: process.env.NODE_ENV }, 'Server started');
    
    // Start webhook retry processor
    startRetryProcessor();
    
    // Start test scheduler
    startTestScheduler();
    
    // Start rate alert monitor
    startRateAlertMonitor();
    
    // Start cleanup job
    startCleanupJob();
    
    // Seed outbound remittance data (idempotent — only runs if tables are empty)
    try {
      await seedOutboundData();
    } catch (err) {
      logger.warn({ err }, 'Outbound remittance seeding skipped');
    }
    
    // Start transfer lifecycle background worker
    startTransferLifecycleWorker();
  });

  // Graceful shutdown handler
  let isShuttingDown = false;
  const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS || '15000', 10);

  async function gracefulShutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown initiated');

    // Stop accepting new connections
    server.close(() => {
      logger.info('HTTP server closed');
    });

    // Allow in-flight requests to complete
    const forceExit = setTimeout(() => {
      logger.warn('Shutdown timeout reached, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      // Stop background workers
      stopTransferLifecycleWorker();
      
      // Drain database pool
      const db = await import("../db");
      // getDb initializes pool; on shutdown we just log
      logger.info('Database connections will be closed by pool timeout');
    } catch (e) {
      logger.warn({ err: e }, 'Error during shutdown cleanup');
    }

    logger.info('Graceful shutdown complete');
    process.exit(0);
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

startServer().catch((err) => {
  logger.fatal({ err }, 'Server failed to start');
  process.exit(1);
});
