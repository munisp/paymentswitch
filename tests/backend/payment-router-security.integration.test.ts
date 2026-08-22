import request from "supertest";
import { describe, expect, it } from "vitest";

const enabled = process.env.RUN_PAYMENT_ROUTER_INTEGRATION === "true";
const baseUrl =
  process.env.PAYMENT_ROUTER_BASE_URL ??
  process.env.TEST_BASE_URL ??
  "http://127.0.0.1:3000";
const api = request(baseUrl);
const tokenA = process.env.PAYMENT_ROUTER_TOKEN_A ?? "";
const tokenB = process.env.PAYMENT_ROUTER_TOKEN_B ?? "";
const tenantA = process.env.PAYMENT_ROUTER_TENANT_A ?? "tenant-a-test";
const tenantB = process.env.PAYMENT_ROUTER_TENANT_B ?? "tenant-b-test";
const resourceB = process.env.PAYMENT_ROUTER_RESOURCE_B ?? "payment-b-test";

function auth(token: string, tenant?: string) {
  return {
    Authorization: `Bearer ${token}`,
    ...(tenant ? { "X-Tenant-ID": tenant } : {}),
    "Content-Type": "application/json",
  };
}

describe.skipIf(!enabled)(
  "payment router tenant isolation and idempotency",
  () => {
    it("requires a real tenant-A token before exercising the route", () => {
      expect(tokenA).toBeTruthy();
      expect(tokenB).toBeTruthy();
      expect(tenantA).not.toBe(tenantB);
    });

    it("rejects tenant A reading a tenant B payment", async () => {
      const response = await api
        .get(`/api/v1/payments/${encodeURIComponent(resourceB)}`)
        .set(auth(tokenA, tenantA));
      expect([403, 404, 503]).toContain(response.status);
      expect(response.status).not.toBe(200);
      expect(response.body?.allowed).not.toBe(true);
    });

    it("does not trust a forged tenant header over the signed token context", async () => {
      const response = await api
        .get(`/api/v1/payments/${encodeURIComponent(resourceB)}`)
        .set(auth(tokenA, tenantB));
      expect([401, 403, 404, 503]).toContain(response.status);
      expect(response.status).not.toBe(200);
    });

    it("rejects malformed payment commands before any ledger effect", async () => {
      const response = await api
        .post("/api/v1/payments")
        .set(auth(tokenA, tenantA))
        .set("Idempotency-Key", `invalid-${Date.now()}`)
        .send({
          amount: -1,
          currency: "NOT-A-CURRENCY",
          sourceAccount: "",
          beneficiaryAccount: "",
        });
      expect([400, 401, 403, 422, 503]).toContain(response.status);
      expect(response.status).not.toBe(200);
    });

    it("allows at most one committed result for concurrent identical idempotency requests", async () => {
      const idempotencyKey = `payment-router-race-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const payload = {
        amount: 1000,
        currency: "NGN",
        sourceAccount:
          process.env.PAYMENT_ROUTER_SOURCE_ACCOUNT ?? "synthetic-source-a",
        beneficiaryAccount:
          process.env.PAYMENT_ROUTER_BENEFICIARY_ACCOUNT ??
          "synthetic-beneficiary-a",
        transferId: `payment-router-transfer-${Date.now()}`,
      };
      const responses = await Promise.all(
        Array.from({ length: 32 }, () =>
          api
            .post("/api/v1/payments")
            .set(auth(tokenA, tenantA))
            .set("Idempotency-Key", idempotencyKey)
            .send(payload)
        )
      );
      const successful = responses.filter(response =>
        [200, 201, 202].includes(response.status)
      );
      const committedIds = new Set(
        successful
          .map(
            response =>
              response.body?.transactionId ??
              response.body?.transaction_id ??
              response.body?.workflowId ??
              response.body?.paymentId
          )
          .filter(Boolean)
      );
      expect(successful.length).toBeGreaterThanOrEqual(1);
      expect(committedIds.size).toBeLessThanOrEqual(1);
      for (const response of responses) {
        expect([200, 201, 202, 400, 401, 403, 409, 429, 503]).toContain(
          response.status
        );
      }
    }, 30_000);
  }
);
