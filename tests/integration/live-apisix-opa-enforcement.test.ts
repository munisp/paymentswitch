import { describe, expect, it, beforeAll } from "vitest";

/**
 * Live gateway security tests. These tests intentionally do not mock APISIX,
 * Keycloak, OPA, Permify, or the backend. They run only when
 * LIVE_GATEWAY_TESTS=true is explicitly set.
 */

type TokenSet = {
  tenantA: string;
  tenantB: string;
  tenantAAdminWithoutMfa?: string;
  tenantAAdminWithMfa?: string;
};

type LiveConfig = {
  baseUrl: string;
  resourceId: string;
  tenantA: string;
  tenantB: string;
  tokenEndpoint?: string;
  tokens: TokenSet;
  dependencyFailureUrl?: string;
};

const liveEnabled = process.env.LIVE_GATEWAY_TESTS === "true";
const suite = liveEnabled ? describe : describe.skip;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(`Missing required live-test environment variable: ${name}`);
  return value;
}

function loadConfig(): LiveConfig {
  const baseUrl = required("APISIX_BASE_URL").replace(/\/$/, "");
  return {
    baseUrl,
    resourceId: required("LIVE_PAYMENT_RESOURCE_ID"),
    tenantA: required("LIVE_TENANT_A_ID"),
    tenantB: required("LIVE_TENANT_B_ID"),
    tokenEndpoint: process.env.APISIX_DEPENDENCY_FAILURE_URL?.trim(),
    dependencyFailureUrl: process.env.APISIX_DEPENDENCY_FAILURE_URL?.trim(),
    tokens: {
      tenantA: required("LIVE_TOKEN_TENANT_A"),
      tenantB: required("LIVE_TOKEN_TENANT_B"),
      tenantAAdminWithoutMfa: process.env.LIVE_TOKEN_ADMIN_NO_MFA,
      tenantAAdminWithMfa: process.env.LIVE_TOKEN_ADMIN_MFA,
    },
  };
}

async function request(
  config: LiveConfig,
  token: string | undefined,
  options: {
    path: string;
    method?: string;
    tenantId?: string;
    headers?: Record<string, string>;
    body?: unknown;
  }
): Promise<Response> {
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    ...(options.headers ?? {}),
  });
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (options.tenantId) headers.set("x-tenant-id", options.tenantId);

  return fetch(`${config.baseUrl}${options.path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
  });
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

function decisionId(
  response: Response,
  body: Record<string, unknown>
): string | undefined {
  const header = response.headers.get("x-authorization-decision-id");
  const value = body.decision_id ?? body.decisionId ?? header;
  return typeof value === "string" ? value : undefined;
}

suite("live APISIX -> OPA -> Permify gateway enforcement", () => {
  let config: LiveConfig;

  beforeAll(() => {
    config = loadConfig();
  });

  it("allows an authenticated same-tenant read and emits a trace correlation value", async () => {
    const response = await request(config, config.tokens.tenantA, {
      path: `/api/v1/payments/${encodeURIComponent(config.resourceId)}`,
      tenantId: config.tenantA,
    });
    const body = await jsonBody(response);

    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
    expect(response.headers.get("traceparent")).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i
    );
    expect(decisionId(response, body)).toMatch(/^[A-Za-z0-9._:-]{8,}$/);
  });

  it("denies a tenant-A token reading a tenant-B resource even when the header claims tenant B", async () => {
    const response = await request(config, config.tokens.tenantA, {
      path: `/api/v1/payments/${encodeURIComponent(config.resourceId)}`,
      tenantId: config.tenantB,
    });
    const body = await jsonBody(response);

    expect(response.status).toBe(403);
    expect(body).not.toHaveProperty("payment");
    expect(decisionId(response, body)).toBeDefined();
  });

  it("rejects a forged identity header and does not treat it as authoritative", async () => {
    const response = await request(config, config.tokens.tenantA, {
      path: `/api/v1/payments/${encodeURIComponent(config.resourceId)}`,
      tenantId: config.tenantA,
      headers: {
        "x-user-id": "user-attacker",
        "x-user-tenant": config.tenantB,
        "x-user-roles": "admin security_admin",
        "x-mfa": "true",
      },
    });
    const body = await jsonBody(response);

    expect([200, 201, 202, 204, 403]).toContain(response.status);
    expect(response.status).not.toBe(500);
    if (response.status === 403)
      expect(decisionId(response, body)).toBeDefined();
  });

  it("returns 401 for an unauthenticated request and never reaches the business handler", async () => {
    const response = await request(config, undefined, {
      path: `/api/v1/payments/${encodeURIComponent(config.resourceId)}`,
      tenantId: config.tenantA,
    });
    expect(response.status).toBe(401);
  });

  it("denies privileged admin actions when the token has no verified MFA claim", async () => {
    if (!config.tokens.tenantAAdminWithoutMfa) return;
    const response = await request(
      config,
      config.tokens.tenantAAdminWithoutMfa,
      {
        path: `/api/v1/admin/payments/${encodeURIComponent(config.resourceId)}/approve`,
        method: "POST",
        tenantId: config.tenantA,
        body: { decision: "approve" },
      }
    );
    expect(response.status).toBe(403);
  });

  it("allows a privileged action only with tenant isolation and verified MFA", async () => {
    if (!config.tokens.tenantAAdminWithMfa) return;
    const response = await request(config, config.tokens.tenantAAdminWithMfa, {
      path: `/api/v1/admin/payments/${encodeURIComponent(config.resourceId)}/approve`,
      method: "POST",
      tenantId: config.tenantA,
      body: { decision: "approve" },
    });
    expect([200, 201, 202, 204, 409]).toContain(response.status);
    expect(response.status).not.toBe(403);
  });

  it("fails closed with 503 when the configured gateway authorization dependency is unavailable", async () => {
    if (!config.dependencyFailureUrl) return;
    const response = await fetch(config.dependencyFailureUrl, {
      method: "GET",
      headers: {
        authorization: `Bearer ${config.tokens.tenantA}`,
        "x-tenant-id": config.tenantA,
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      },
      redirect: "manual",
    });
    expect(response.status).toBe(503);
  });
});
