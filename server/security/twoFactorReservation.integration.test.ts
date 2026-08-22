import { describe, expect, it } from "vitest";
import { createClient } from "redis";

const enabled = process.env.RUN_2FA_RESERVATION_INTEGRATION === "true";

describe.skipIf(!enabled)("atomic distributed 2FA reservation", () => {
  it("admits at most five reservations under 100 concurrent requests", async () => {
    expect(process.env.REDIS_URL).toBeTruthy();
    const redis = createClient({ url: process.env.REDIS_URL });
    await redis.connect();
    const userId = Number(process.env.TWO_FACTOR_TEST_USER_ID ?? 910001);
    const key = `paymentswitch:2fa:attempts:${userId}`;
    await redis.del(key);
    await redis.quit();

    const service = await import("../services/twoFactorService");
    const results = await Promise.all(
      Array.from({ length: 100 }, () => service.reserveTwoFactorAttempt(userId))
    );

    expect(results.filter(result => result.allowed)).toHaveLength(5);
    expect(results.filter(result => !result.allowed)).toHaveLength(95);

    const verifyRedis = createClient({ url: process.env.REDIS_URL });
    await verifyRedis.connect();
    await expect(verifyRedis.get(key)).resolves.toBe("5");
    await verifyRedis.del(key);
    await verifyRedis.quit();
  });

  it("releases exactly one reservation after a successful verification", async () => {
    const service = await import("../services/twoFactorService");
    const userId = Number(process.env.TWO_FACTOR_TEST_USER_ID ?? 910002);
    const first = await service.reserveTwoFactorAttempt(userId);
    expect(first.allowed).toBe(true);
    await service.releaseTwoFactorAttempt(userId);

    const redis = createClient({ url: process.env.REDIS_URL });
    await redis.connect();
    await expect(
      redis.get(`paymentswitch:2fa:attempts:${userId}`)
    ).resolves.toBeNull();
    await redis.quit();
  });
});
