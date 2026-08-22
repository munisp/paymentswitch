import { describe, expect, it } from "vitest";
import { merchants } from "../../drizzle/schema";
import {
  PaymentRepository,
  PaymentSessionNotFoundError,
} from "../../server/repositories/paymentRepository";
import {
  integrationEnabled,
  withPostgresRollback,
} from "./fixtures/postgresRollback";

describe.skipIf(!integrationEnabled())(
  "PaymentRepository PostgreSQL integration",
  () => {
    it("rolls back all fixture rows after the test transaction", async () => {
      const result = await withPostgresRollback(async tx => {
        const [merchant] = await tx
          .insert(merchants)
          .values({
            userId: 1,
            businessName: "Rollback Merchant",
            businessType: "ecommerce",
            apiKey: `rollback-${Date.now()}`,
            apiSecret: "integration-secret",
          })
          .returning();
        expect(merchant).toBeDefined();
        return merchant.id;
      });
      expect(result).toBeTypeOf("number");
    });

    it("enforces merchant scoping for reads and lists", async () => {
      await withPostgresRollback(async tx => {
        const [merchantA, merchantB] = await tx
          .insert(merchants)
          .values([
            {
              userId: 1,
              businessName: "Merchant A",
              businessType: "ecommerce",
              apiKey: `a-${Date.now()}`,
              apiSecret: "secret-a",
            },
            {
              userId: 2,
              businessName: "Merchant B",
              businessType: "ecommerce",
              apiKey: `b-${Date.now()}`,
              apiSecret: "secret-b",
            },
          ])
          .returning();
        const repository = new PaymentRepository(tx);
        const expiry = new Date(Date.now() + 3600_000);
        await repository.insert({
          sessionId: `session-a-${Date.now()}`,
          merchantId: merchantA.id,
          amount: 1000,
          currency: "USD",
          expiresAt: expiry,
        });
        const sessionB = await repository.insert({
          sessionId: `session-b-${Date.now()}`,
          merchantId: merchantB.id,
          amount: 2000,
          currency: "USD",
          expiresAt: expiry,
        });

        expect(
          await repository.findForMerchant(merchantA.id, sessionB.sessionId)
        ).toBeUndefined();
        expect(await repository.listForMerchant(merchantA.id)).toHaveLength(1);
      });
    });

    it("updates only the tenant-owned row and rejects missing rows", async () => {
      await withPostgresRollback(async tx => {
        const [merchant] = await tx
          .insert(merchants)
          .values({
            userId: 3,
            businessName: "Update Merchant",
            businessType: "ecommerce",
            apiKey: `update-${Date.now()}`,
            apiSecret: "update-secret",
          })
          .returning();
        const repository = new PaymentRepository(tx);
        const session = await repository.insert({
          sessionId: `session-update-${Date.now()}`,
          merchantId: merchant.id,
          amount: 1000,
          currency: "USD",
          expiresAt: new Date(Date.now() + 3600_000),
        });
        const updated = await repository.updateForMerchant(
          merchant.id,
          session.sessionId,
          { amount: 2500, status: "approved" }
        );
        expect(updated.amount).toBe(2500);
        expect(updated.status).toBe("approved");
        await expect(
          repository.requireForMerchant(merchant.id, "missing-session")
        ).rejects.toBeInstanceOf(PaymentSessionNotFoundError);
        await expect(
          repository.listForMerchant(merchant.id, 0)
        ).rejects.toThrow(RangeError);
        await expect(
          repository.listForMerchant(merchant.id, 101)
        ).rejects.toThrow(RangeError);
      });
    });
  }
);
