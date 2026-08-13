import { TRPCError } from '@trpc/server';

const PERMIFY_URL = process.env.PERMIFY_URL;
const PERMIFY_TENANT_ID = process.env.PERMIFY_TENANT_ID ?? 't1';
const PERMIFY_SCHEMA_VERSION = process.env.PERMIFY_SCHEMA_VERSION ?? '';
const PERMIFY_AUTH_TOKEN = process.env.PERMIFY_AUTH_TOKEN;
const enforcePermify = process.env.PERMIFY_ENFORCEMENT_REQUIRED === 'true' || process.env.NODE_ENV === 'production';

type Permission = 'view' | 'admin';

/**
 * Checks a platform-level permission in Permify. In production (or when the
 * explicit enforcement flag is set), unavailable configuration, transport
 * failures, unspecified outcomes, and explicit denials all deny access.
 */
export async function requirePlatformPermission(userId: number, permission: Permission): Promise<void> {
  if (!enforcePermify) return;
  if (!PERMIFY_URL) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Permify enforcement is required but PERMIFY_URL is not configured' });
  }

  const endpoint = `${PERMIFY_URL.replace(/\/$/, '')}/v1/tenants/${encodeURIComponent(PERMIFY_TENANT_ID)}/permissions/check`;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(PERMIFY_AUTH_TOKEN ? { Authorization: `Bearer ${PERMIFY_AUTH_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        metadata: { schema_version: PERMIFY_SCHEMA_VERSION, depth: 20 },
        entity: { type: 'platform', id: 'default' },
        permission,
        subject: { type: 'user', id: String(userId), relation: '' },
      }),
      signal: AbortSignal.timeout(3_000),
    });

    if (!response.ok) {
      throw new Error(`Permify returned HTTP ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as { can?: string };
    if (result.can !== 'CHECK_RESULT_ALLOWED') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Permify denied this operation' });
    }
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Permify authorization could not be verified: ${error instanceof Error ? error.message : 'unknown error'}`,
    });
  }
}
