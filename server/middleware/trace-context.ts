import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export const TRACEPARENT_HEADER = "traceparent";
export const TRACESTATE_HEADER = "tracestate";
export const REQUEST_ID_HEADER = "x-request-id";
export const AUTHZ_DECISION_ID_HEADER = "x-authorization-decision-id";

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;
const ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;

export type TraceContext = {
  traceparent: string;
  tracestate?: string;
  traceId: string;
  parentSpanId: string;
  sampled: boolean;
  requestId: string;
};

function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export function parseTraceparent(value: unknown): TraceContext | undefined {
  if (typeof value !== "string") return undefined;
  const match = TRACEPARENT_RE.exec(value.trim());
  if (!match) return undefined;
  const [, traceId, parentSpanId, flags] = match;
  if (/^0+$/.test(traceId) || /^0+$/.test(parentSpanId)) return undefined;
  const flagByte = Number.parseInt(flags, 16);
  if ((flagByte & 0x02) !== 0) return undefined; // reserved bit must be zero
  return {
    traceparent: `00-${traceId.toLowerCase()}-${parentSpanId.toLowerCase()}-${flags.toLowerCase()}`,
    traceId: traceId.toLowerCase(),
    parentSpanId: parentSpanId.toLowerCase(),
    sampled: (flagByte & 0x01) === 1,
    requestId: traceId.toLowerCase(),
  };
}

export function createTraceContext(
  inbound: Record<string, unknown>
): TraceContext {
  const parsed = parseTraceparent(inbound[TRACEPARENT_HEADER]);
  if (parsed) {
    return {
      ...parsed,
      tracestate:
        typeof inbound[TRACESTATE_HEADER] === "string"
          ? inbound[TRACESTATE_HEADER].slice(0, 512)
          : undefined,
    };
  }

  const traceId = randomHex(16);
  const spanId = randomHex(8);
  return {
    traceparent: `00-${traceId}-${spanId}-01`,
    traceId,
    parentSpanId: spanId,
    sampled: true,
    requestId: traceId,
  };
}

export function traceHeaders(
  context: TraceContext,
  extra: Record<string, string> = {}
): Record<string, string> {
  return {
    [TRACEPARENT_HEADER]: context.traceparent,
    ...(context.tracestate ? { [TRACESTATE_HEADER]: context.tracestate } : {}),
    [REQUEST_ID_HEADER]: context.requestId,
    ...extra,
  };
}

export function authorizationHeaders(
  context: TraceContext,
  decisionId: string
): Record<string, string> {
  if (!ID_RE.test(decisionId))
    throw new Error("invalid authorization decision ID");
  return traceHeaders(context, {
    [AUTHZ_DECISION_ID_HEADER]: decisionId,
  });
}

export function securityAuditFields(
  context: TraceContext,
  fields: Record<string, unknown>
): Record<string, unknown> {
  const forbidden =
    /authorization|cookie|token|secret|password|signature|presign|credential|body|payload/i;
  const safe: Record<string, unknown> = {
    trace_id: context.traceId,
    request_id: context.requestId,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (!forbidden.test(key)) safe[key] = value;
  }
  return safe;
}

export function traceContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const context = createTraceContext(req.headers as Record<string, unknown>);
  res.locals.traceContext = context;
  res.setHeader(TRACEPARENT_HEADER, context.traceparent);
  res.setHeader(REQUEST_ID_HEADER, context.requestId);
  if (context.tracestate) res.setHeader(TRACESTATE_HEADER, context.tracestate);
  next();
}

export function getTraceContext(res: Response): TraceContext {
  const context = res.locals.traceContext as TraceContext | undefined;
  if (!context)
    throw new Error("traceContextMiddleware must run before getTraceContext");
  return context;
}
