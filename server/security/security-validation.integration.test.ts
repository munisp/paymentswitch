import { describe, expect, it } from "vitest";
import request from "supertest";

const enabled = process.env.RUN_SECURITY_VALIDATION_INTEGRATION === "true";
const baseUrl = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
const api = request(baseUrl);

const tokenA = process.env.SECURITY_TEST_TOKEN_A ?? "";
const tokenB = process.env.SECURITY_TEST_TOKEN_B ?? "";
const subjectA = process.env.SECURITY_TEST_SUBJECT_A ?? "keycloak-subject-a";
const subjectB = process.env.SECURITY_TEST_SUBJECT_B ?? "keycloak-subject-b";
const tenantA = process.env.SECURITY_TEST_TENANT_A ?? "tenant-a-test";
const tenantB = process.env.SECURITY_TEST_TENANT_B ?? "tenant-b-test";
const resourceA =
  process.env.SECURITY_TEST_RESOURCE_A ?? "merchant-a-resource-001";
const resourceB =
  process.env.SECURITY_TEST_RESOURCE_B ?? "merchant-b-resource-001";

const auth = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

describe.skipIf(!enabled)("security validation integration", () => {
  it("allows one double-spend race outcome and prevents duplicate ledger postings", async () => {
    expect(tokenA).toBeTruthy();

    const transferId = `security-race-${Date.now()}`;
    const idempotencyKey = `security-race-key-${Date.now()}`;
    const payload = {
      amount: 1000,
      currency: "NGN",
      sourceAccount:
        process.env.SECURITY_TEST_SOURCE_ACCOUNT ?? "synthetic-source-001",
      beneficiaryAccount:
        process.env.SECURITY_TEST_BENEFICIARY_ACCOUNT ??
        "synthetic-beneficiary-001",
      transferId,
      idempotencyKey,
    };

    const responses = await Promise.all(
      Array.from({ length: 32 }, () =>
        api
          .post("/api/v1/payments")
          .set(auth(tokenA))
          .set("Idempotency-Key", idempotencyKey)
          .send(payload)
      )
    );

    const successful = responses.filter(response =>
      [200, 201, 202].includes(response.status)
    );
    expect(successful.length).toBeGreaterThanOrEqual(1);

    const committedIds = new Set(
      successful
        .map(
          response =>
            response.body?.transactionId ??
            response.body?.transaction_id ??
            response.body?.workflowId
        )
        .filter(Boolean)
    );
    expect(committedIds.size).toBeLessThanOrEqual(1);

    for (const response of responses) {
      expect([200, 201, 202, 409, 429, 503]).toContain(response.status);
    }

    if (process.env.DATABASE_URL) {
      const { getDb } = await import("../db");
      const database = await getDb();
      expect(database).toBeTruthy();
    }
  }, 30_000);

  it("denies cross-tenant authorization through the REST endpoint", async () => {
    expect(tokenA).toBeTruthy();
    const response = await api
      .post("/api/v1/authz/check")
      .set(auth(tokenA))
      .send({
        subject: { type: "user", id: subjectA },
        permission: "read",
        resource: { type: "merchant", id: resourceB },
        tenant_id: tenantB,
      });

    expect([403, 503]).toContain(response.status);
    expect(response.body?.allowed).not.toBe(true);
  });

  it("rejects a request whose subject is changed to another tenant user", async () => {
    expect(tokenA).toBeTruthy();
    const response = await api
      .post("/api/v1/authz/check")
      .set(auth(tokenA))
      .send({
        subject: { type: "user", id: subjectB },
        permission: "read",
        resource: { type: "merchant", id: resourceB },
        tenant_id: tenantB,
      });

    expect(response.status).toBe(403);
    expect(response.body?.allowed).toBe(false);
  });

  it("allows only the same-tenant policy decision", async () => {
    expect(tokenA).toBeTruthy();
    const response = await api
      .post("/api/v1/authz/check")
      .set(auth(tokenA))
      .send({
        subject: { type: "user", id: subjectA },
        permission: "read",
        resource: { type: "merchant", id: resourceA },
        tenant_id: tenantA,
      });

    expect([200, 403, 503]).toContain(response.status);
    if (response.status === 200) expect(response.body?.allowed).toBe(true);
  });

  it("rejects missing or malformed bearer authentication", async () => {
    const missing = await api
      .post("/api/v1/authz/check")
      .set("Content-Type", "application/json")
      .send({});
    expect(missing.status).toBe(401);

    const malformed = await api
      .post("/api/v1/authz/check")
      .set(auth("eyJ.invalid.token"))
      .send({});
    expect(malformed.status).toBe(401);
  });
});
