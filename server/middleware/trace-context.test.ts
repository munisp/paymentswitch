import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { getTraceContext, traceContextMiddleware } from "./trace-context";
import {
  authorizationHeaders,
  createTraceContext,
  parseTraceparent,
  securityAuditFields,
  traceHeaders,
} from "./trace-context";

describe("trace-context", () => {
  it("accepts a valid W3C traceparent and preserves only safe context", () => {
    const context = parseTraceparent(
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    );
    expect(context?.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(context?.parentSpanId).toBe("00f067aa0ba902b7");
    expect(context?.sampled).toBe(true);
  });

  it("rejects malformed and reserved-bit traceparents", () => {
    expect(parseTraceparent("not-a-traceparent")).toBeUndefined();
    expect(
      parseTraceparent(
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-02"
      )
    ).toBeUndefined();
    expect(
      parseTraceparent(
        "00-00000000000000000000000000000000-00f067aa0ba902b7-01"
      )
    ).toBeUndefined();
  });

  it("preserves bounded tracestate when inbound context is valid", () => {
    const context = createTraceContext({
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      tracestate: "vendor=value",
    });
    expect(context.tracestate).toBe("vendor=value");
  });

  it("creates a new safe context when inbound context is absent", () => {
    const context = createTraceContext({});
    expect(context.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(context.requestId).toBe(context.traceId);
  });

  it("propagates W3C context and authorization decision ID without credentials", () => {
    const context = createTraceContext({
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    });
    expect(traceHeaders(context)).toMatchObject({
      traceparent: context.traceparent,
      "x-request-id": context.requestId,
    });
    expect(authorizationHeaders(context, "decision-123")).toMatchObject({
      "x-authorization-decision-id": "decision-123",
    });
  });

  it("sets response correlation headers and exposes the request context", () => {
    const headers = new Map<string, string>();
    const res = {
      locals: {},
      setHeader: vi.fn((name: string, value: string) =>
        headers.set(name, value)
      ),
    } as unknown as Response;
    const next = vi.fn();
    traceContextMiddleware({ headers: {} } as unknown as Request, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(headers.get("traceparent")).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/
    );
    expect(headers.get("x-request-id")).toMatch(/^[0-9a-f]{32}$/);
    expect(getTraceContext(res).traceId).toBe(headers.get("x-request-id"));
  });

  it("fails if a response context is requested before middleware", () => {
    expect(() => getTraceContext({ locals: {} } as Response)).toThrow(
      "traceContextMiddleware must run before getTraceContext"
    );
  });

  it("rejects decision IDs that could carry unsafe audit data", () => {
    const context = createTraceContext({});
    expect(() => authorizationHeaders(context, "Bearer secret")).toThrow(
      "invalid authorization decision ID"
    );
  });

  it("removes secrets, credentials, presigned values, and payloads from audit fields", () => {
    const context = createTraceContext({});
    const safe = securityAuditFields(context, {
      tenant_id: "tenant-a",
      action: "read",
      authorization: "Bearer secret",
      presigned_url: "https://storage.invalid/signed",
      request_payload: { card_number: "4111111111111111" },
    });
    expect(safe).toMatchObject({ tenant_id: "tenant-a", action: "read" });
    expect(safe).not.toHaveProperty("authorization");
    expect(safe).not.toHaveProperty("presigned_url");
    expect(safe).not.toHaveProperty("request_payload");
  });
});
