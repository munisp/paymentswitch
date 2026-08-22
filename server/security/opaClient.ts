export class OpaUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("OPA policy service is unavailable");
    this.name = "OpaUnavailableError";
    this.cause = cause;
  }
  cause?: unknown;
}

export interface PbacInput {
  subject: {
    id: string;
    roles: string[];
    tenantId: string;
    tenant_id: string;
    mfa_verified: boolean;
  };
  action: string;
  resource: {
    type: string;
    id: string;
    tenantId: string;
    tenant_id: string;
  };
  tenantId: string;
  source: "api" | "worker" | "admin";
}

export async function evaluatePbac(input: PbacInput): Promise<boolean> {
  const required =
    process.env.NODE_ENV === "production" ||
    process.env.OPA_REQUIRED === "true";
  const endpoint = process.env.OPA_URL;
  if (!endpoint) {
    if (required) throw new OpaUnavailableError("OPA_URL is missing");
    return false;
  }

  try {
    const response = await fetch(
      `${endpoint.replace(/\/$/, "")}/v1/data/paymentswitch/authz/allow`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input }),
        signal: AbortSignal.timeout(2000),
      }
    );
    if (!response.ok) throw new Error(`OPA returned HTTP ${response.status}`);
    const result = (await response.json()) as { result?: unknown };
    return result.result === true;
  } catch (error) {
    if (required) throw new OpaUnavailableError(error);
    return false;
  }
}
