import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const shouldRun =
  process.env.RUN_REDIS_RATE_LIMIT_INTEGRATION === "true" &&
  Boolean(
    process.env.DOCKER_HOST || process.env.CI || process.env.DATABASE_URL
  );

describe.skipIf(!shouldRun)("distributed multipart rate limiter", () => {
  let container: StartedTestContainer;
  let closeLimiter: () => Promise<void>;
  let enforce: (params: { userId: number; clientIp?: string }) => Promise<void>;

  beforeAll(async () => {
    container = await new GenericContainer("redis:7.4-alpine")
      .withExposedPorts(6379)
      .start();

    process.env.REDIS_URL = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
    process.env.MULTIPART_RATE_REDIS_REQUIRED = "true";
    process.env.MULTIPART_RATE_MAX_REQUESTS = "5";
    process.env.MULTIPART_RATE_WINDOW_SECONDS = "60";
    process.env.MULTIPART_RATE_KEY_PREFIX = `test:multipart:${Date.now()}:`;

    const module = await import("./distributedMultipartRateLimiter");
    enforce = module.enforceMultipartInitiationRateLimit;
    closeLimiter = module.closeMultipartRateLimiter;
  }, 30_000);

  afterAll(async () => {
    await closeLimiter?.();
    await container?.stop();
  });

  it("admits at most five concurrent requests for one user and IP", async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        enforce({ userId: 901, clientIp: "203.0.113.10" })
      )
    );

    const allowed = attempts.filter(result => result.status === "fulfilled");
    const rejected = attempts.filter(
      result =>
        result.status === "rejected" &&
        (result.reason as { code?: string })?.code === "TOO_MANY_REQUESTS"
    );

    expect(allowed).toHaveLength(5);
    expect(rejected).toHaveLength(15);
  });

  it("keeps user/IP buckets independent while sharing Redis state", async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) =>
        enforce({ userId: 902 + (index % 2), clientIp: "203.0.113.11" })
      )
    );

    expect(attempts.every(result => result.status === "fulfilled")).toBe(true);
  });

  it("fails closed when Redis is unavailable in production mode", async () => {
    await container.stop();
    await closeLimiter();

    process.env.REDIS_URL = "redis://127.0.0.1:1";
    process.env.MULTIPART_RATE_REDIS_REQUIRED = "true";

    const module = await import("./distributedMultipartRateLimiter");
    await expect(
      module.enforceMultipartInitiationRateLimit({
        userId: 999,
        clientIp: "203.0.113.12",
      })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  }, 15_000);
});
