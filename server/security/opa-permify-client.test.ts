import { afterEach, describe, expect, it, vi } from "vitest";
import { OpaUnavailableError, evaluatePbac } from "./opaClient";
import { requirePlatformPermission } from "./permifyAuth";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("OPA PBAC client", () => {
  it("fails closed when production has no OPA endpoint", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.OPA_URL;
    await expect(
      evaluatePbac({
        subject: { id: "user-a", roles: ["merchant"] },
        action: "read",
        resource: { type: "payment", id: "payment-a" },
        tenantId: "tenant-a",
        source: "api",
      })
    ).rejects.toBeInstanceOf(OpaUnavailableError);
  });

  it("does not permit a missing OPA endpoint to grant access in non-production", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.OPA_URL;
    await expect(
      evaluatePbac({
        subject: { id: "user-a", roles: [] },
        action: "read",
        resource: { type: "payment", id: "payment-a" },
        tenantId: "tenant-a",
        source: "api",
      })
    ).resolves.toBe(false);
  });

  it("returns false on a non-required OPA transport failure", async () => {
    process.env.NODE_ENV = "test";
    process.env.OPA_URL = "https://opa.test";
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("connection refused")
    );
    await expect(
      evaluatePbac({
        subject: { id: "user-a", roles: [] },
        action: "read",
        resource: { type: "payment", id: "payment-a" },
        tenantId: "tenant-a",
        source: "api",
      })
    ).resolves.toBe(false);
  });

  it("returns only an explicit boolean OPA result", async () => {
    process.env.NODE_ENV = "test";
    process.env.OPA_URL = "https://opa.test";
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ result: true }), { status: 200 })
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ result: "true" }), { status: 200 })
    );

    const input = {
      subject: { id: "user-a", roles: ["merchant"] },
      action: "read",
      resource: { type: "payment", id: "payment-a" },
      tenantId: "tenant-a",
      source: "api" as const,
    };
    await expect(evaluatePbac(input)).resolves.toBe(true);
    await expect(evaluatePbac(input)).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://opa.test/v1/data/paymentswitch/authz/allow",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("fails closed on OPA HTTP and transport failures when required", async () => {
    process.env.NODE_ENV = "production";
    process.env.OPA_URL = "https://opa.test";
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(new Response("denied", { status: 503 }));
    fetchMock.mockRejectedValueOnce(new Error("connection refused"));
    const input = {
      subject: { id: "user-a", roles: [] },
      action: "write",
      resource: { type: "payment", id: "payment-a" },
      tenantId: "tenant-a",
      source: "worker" as const,
    };
    await expect(evaluatePbac(input)).rejects.toBeInstanceOf(
      OpaUnavailableError
    );
    await expect(evaluatePbac(input)).rejects.toBeInstanceOf(
      OpaUnavailableError
    );
  });
});

describe("Permify platform authorization", () => {
  it("denies when enforcement is required but URL is absent", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.PERMIFY_URL;
    await expect(requirePlatformPermission(7, "view")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("sends typed tenant-scoped checks and accepts only CHECK_RESULT_ALLOWED", async () => {
    process.env.NODE_ENV = "test";
    process.env.PERMIFY_ENFORCEMENT_REQUIRED = "true";
    process.env.PERMIFY_URL = "https://permify.test/";
    process.env.PERMIFY_TENANT_ID = "paymentswitch";
    process.env.PERMIFY_SCHEMA_VERSION = "paymentswitch-v1";
    process.env.PERMIFY_AUTH_TOKEN = "test-token";
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ can: "CHECK_RESULT_ALLOWED" }), {
        status: 200,
      })
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ can: "CHECK_RESULT_DENIED" }), {
        status: 200,
      })
    );

    await expect(requirePlatformPermission(7, "view")).resolves.toBeUndefined();
    await expect(requirePlatformPermission(7, "admin")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://permify.test/v1/tenants/paymentswitch/permissions/check",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-token",
        }),
      })
    );
  });

  it("maps HTTP failures and malformed responses to explicit denial", async () => {
    process.env.NODE_ENV = "test";
    process.env.PERMIFY_ENFORCEMENT_REQUIRED = "true";
    process.env.PERMIFY_URL = "https://permify.test";
    process.env.PERMIFY_SCHEMA_VERSION = "paymentswitch-v1";
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(new Response("down", { status: 500 }));
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 })
    );
    await expect(requirePlatformPermission(7, "view")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(requirePlatformPermission(7, "view")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
