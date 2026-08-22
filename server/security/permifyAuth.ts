import { TRPCError } from "@trpc/server";

export class PermifyUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Permify authorization service is unavailable");
    this.name = "PermifyUnavailableError";
    this.cause = cause;
  }
  cause?: unknown;
}

export class PermifyDeniedError extends Error {
  constructor() {
    super("Permify denied this operation");
    this.name = "PermifyDeniedError";
  }
}

function permifyConfig() {
  return {
    url: process.env.PERMIFY_URL?.trim() ?? "",
    tenantId: process.env.PERMIFY_TENANT_ID?.trim() || "t1",
    schemaVersion: process.env.PERMIFY_SCHEMA_VERSION?.trim() ?? "",
    authToken: process.env.PERMIFY_AUTH_TOKEN?.trim() ?? "",
    required:
      process.env.PERMIFY_ENFORCEMENT_REQUIRED === "true" ||
      process.env.NODE_ENV === "production",
  };
}

function headers(authToken: string): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
  };
}

export interface PermifyPermissionInput {
  entityType: string;
  entityId: string;
  permission: string;
  subjectId: string;
}

export async function checkPermifyPermission(
  input: PermifyPermissionInput
): Promise<boolean> {
  const config = permifyConfig();
  if (!config.required) return false;
  if (!config.url || !config.tenantId || !config.schemaVersion) {
    throw new PermifyUnavailableError(
      "Permify URL, tenant, and schema version are required"
    );
  }
  try {
    const response = await fetch(
      `${config.url.replace(/\/$/, "")}/v1/tenants/${encodeURIComponent(config.tenantId)}/permissions/check`,
      {
        method: "POST",
        headers: headers(config.authToken),
        body: JSON.stringify({
          metadata: { schema_version: config.schemaVersion, depth: 20 },
          entity: { type: input.entityType, id: input.entityId },
          permission: input.permission,
          subject: { type: "user", id: input.subjectId, relation: "" },
        }),
        signal: AbortSignal.timeout(3_000),
      }
    );
    if (!response.ok)
      throw new Error(
        `Permify returned HTTP ${response.status} ${response.statusText}`
      );
    const result = (await response.json()) as { can?: unknown };
    if (typeof result.can !== "string")
      throw new Error("Permify response omitted a decision");
    return result.can === "CHECK_RESULT_ALLOWED";
  } catch (error) {
    if (error instanceof PermifyUnavailableError) throw error;
    throw new PermifyUnavailableError(error);
  }
}

export async function requireResourcePermission(
  input: PermifyPermissionInput
): Promise<void> {
  if (!(await checkPermifyPermission(input))) throw new PermifyDeniedError();
}

export interface PermifyRelationshipInput {
  entityType: string;
  entityId: string;
  relation: string;
  subjectType: string;
  subjectId: string;
}

export async function writePermifyRelationship(
  input: PermifyRelationshipInput
): Promise<void> {
  const config = permifyConfig();
  if (!config.required) return;
  if (!config.url || !config.tenantId || !config.schemaVersion) {
    throw new PermifyUnavailableError(
      "Permify URL, tenant, and schema version are required"
    );
  }
  try {
    const response = await fetch(
      `${config.url.replace(/\/$/, "")}/v1/tenants/${encodeURIComponent(config.tenantId)}/relationships/write`,
      {
        method: "POST",
        headers: headers(config.authToken),
        body: JSON.stringify({
          metadata: { schema_version: config.schemaVersion },
          tuples: [
            {
              entity: { type: input.entityType, id: input.entityId },
              relation: input.relation,
              subject: { type: input.subjectType, id: input.subjectId },
            },
          ],
        }),
        signal: AbortSignal.timeout(3_000),
      }
    );
    if (!response.ok)
      throw new Error(
        `Permify relationship write returned HTTP ${response.status}`
      );
  } catch (error) {
    throw new PermifyUnavailableError(error);
  }
}

type PlatformPermission = "view" | "admin";

/** Backward-compatible platform permission helper for tRPC procedures. */
export async function requirePlatformPermission(
  userId: number,
  permission: PlatformPermission
): Promise<void> {
  try {
    await requireResourcePermission({
      entityType: "platform",
      entityId: "default",
      permission,
      subjectId: String(userId),
    });
  } catch (error) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        error instanceof PermifyDeniedError
          ? error.message
          : `Permify authorization could not be verified: ${error instanceof Error ? error.message : "unknown error"}`,
    });
  }
}
