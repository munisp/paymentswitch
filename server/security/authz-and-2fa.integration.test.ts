import { describe, expect, it } from "vitest";
import { createClient } from "redis";

const runLive = process.env.RUN_AUTHZ_2FA_INTEGRATION === "true";
const baseUrl = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
const bearer = process.env.AUTHZ_BEARER_TOKEN;

describe.skipIf(!runLive)("Permify REST authorization endpoint", () => {
  it("rejects requests without a bearer token", async () => {
    const response = await fetch(`${baseUrl}/api/v1/authz/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject: { type: "user", id: "not-authenticated" },
        permission: "read",
        resource: { type: "merchant", id: "merchant-1" },
      }),
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ allowed: false });
  });

  it("enforces payload, subject, and Permify decisions", async () => {
    expect(bearer).toBeTruthy();
    const headers = {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
    };

    const invalid = await fetch(`${baseUrl}/api/v1/authz/check`, {
      method: "POST",
      headers,
      body: JSON.stringify({ permission: "read" }),
    });
    expect(invalid.status).toBe(400);

    const denied = await fetch(`${baseUrl}/api/v1/authz/check`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        subject: { type: "user", id: process.env.AUTHZ_SUBJECT_ID },
        permission: process.env.AUTHZ_DENIED_PERMISSION ?? "never-allow",
        resource: {
          type: "merchant",
          id: process.env.AUTHZ_RESOURCE_ID ?? "denied",
        },
      }),
    });
    expect([403, 503]).toContain(denied.status);
    const deniedBody = await denied.json();
    expect(deniedBody.allowed).toBe(false);

    const allowed = await fetch(`${baseUrl}/api/v1/authz/check`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        subject: { type: "user", id: process.env.AUTHZ_SUBJECT_ID },
        permission: process.env.AUTHZ_ALLOWED_PERMISSION ?? "read",
        resource: {
          type: "merchant",
          id: process.env.AUTHZ_RESOURCE_ID ?? "allowed",
        },
      }),
    });
    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toMatchObject({ allowed: true });
  });
});

describe.skipIf(!runLive)("Redis-backed distributed 2FA lockout", () => {
  it("shares attempts and fails closed when Redis is unavailable", async () => {
    const redisUrl = process.env.REDIS_URL;
    expect(redisUrl).toBeTruthy();
    const redis = createClient({ url: redisUrl });
    await redis.connect();
    const userId = Number(process.env.TWO_FACTOR_TEST_USER_ID ?? 900001);
    const key = `paymentswitch:2fa:attempts:${userId}`;
    await redis.del(key);
    await redis.quit();

    const service = await import("../services/twoFactorService");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await service.recordTwoFactorAttempt(userId, false);
    }
    const locked = await service.checkTwoFactorRateLimit(userId);
    expect(locked.allowed).toBe(false);
    expect(locked.remainingAttempts).toBe(0);

    const resetRedis = createClient({ url: redisUrl });
    await resetRedis.connect();
    await resetRedis.del(key);
    await resetRedis.quit();
  });

  it("resets the shared counter after a successful verification", async () => {
    const service = await import("../services/twoFactorService");
    const userId = Number(process.env.TWO_FACTOR_TEST_USER_ID ?? 900001);
    await service.recordTwoFactorAttempt(userId, false);
    await service.recordTwoFactorAttempt(userId, true);
    await expect(
      service.checkTwoFactorRateLimit(userId)
    ).resolves.toMatchObject({
      allowed: true,
      remainingAttempts: 5,
    });
  });
});
