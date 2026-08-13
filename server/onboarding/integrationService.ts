import { getDb } from '../db';
import { sql } from 'drizzle-orm';
import crypto from 'crypto';

const TEST_TIMEOUT_MS = Number.parseInt(process.env.INTEGRATION_TEST_TIMEOUT_MS ?? '10000', 10);
const SANDBOX_BASE_URL = process.env.SANDBOX_BASE_URL;

function assertSafeIntegrationUrl(value: string, field: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be a valid absolute URL`);
  }

  if (url.protocol !== 'https:' && process.env.ALLOW_INSECURE_INTEGRATION_TESTS !== 'true') {
    throw new Error(`${field} must use HTTPS outside explicitly configured local testing`);
  }
  if (/^(localhost|127\.|0\.0\.0\.0|169\.254\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)$/i.test(url.hostname)) {
    throw new Error(`${field} cannot target a loopback, link-local, or private network address`);
  }
  return url;
}

function buildSandboxEndpoint(sandboxId: string): string {
  if (!SANDBOX_BASE_URL) {
    throw new Error('SANDBOX_BASE_URL must be configured before provisioning a sandbox environment');
  }
  const base = assertSafeIntegrationUrl(SANDBOX_BASE_URL, 'SANDBOX_BASE_URL');
  return new URL(`/api/v1/sandboxes/${sandboxId}`, base).toString();
}

async function requireApplicationOwner(applicationId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const result = await db.execute<{ user_id: number }>(sql`
    SELECT user_id FROM participant_applications WHERE id = ${applicationId} LIMIT 1
  `);
  const ownerId = Number(result.rows[0]?.user_id ?? 0);
  if (!ownerId) throw new Error(`Participant application ${applicationId} was not found`);
  return ownerId;
}

/** Provision a sandbox only when an actual gateway base URL is configured. */
export async function provisionSandboxEnvironment(applicationId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  await requireApplicationOwner(applicationId);
  const sandboxId = crypto.randomBytes(16).toString('hex');
  const apiEndpoint = buildSandboxEndpoint(sandboxId);
  const result = await db.execute<{ id: number }>(sql`
    INSERT INTO integration_environments (application_id, environment_type, api_endpoint, status, provisioned_at)
    VALUES (${applicationId}, 'sandbox', ${apiEndpoint}, 'provisioning', NOW())
    RETURNING id
  `);
  const environmentId = Number(result.rows[0]?.id ?? 0);
  if (!environmentId) throw new Error('Sandbox environment could not be persisted');

  const credentials = await generateApiCredentials(applicationId, environmentId);
  return { environmentId, apiEndpoint, credentials, status: 'provisioning' as const };
}

/** Generate an API secret once, store only a digest, and bind it to a real environment. */
export async function generateApiCredentials(applicationId: number, environmentId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const ownerId = await requireApplicationOwner(applicationId);

  const environment = await db.execute<{ id: number }>(sql`
    SELECT id FROM integration_environments
    WHERE id = ${environmentId} AND application_id = ${applicationId}
    LIMIT 1
  `);
  if (!environment.rows[0]) throw new Error('Integration environment does not belong to the application');

  const apiKey = `pk_${crypto.randomBytes(24).toString('hex')}`;
  const apiSecret = `sk_${crypto.randomBytes(32).toString('hex')}`;
  const secretDigest = crypto.createHash('sha256').update(apiSecret).digest('hex');

  await db.execute(sql`
    INSERT INTO api_credentials (environment_id, api_key, api_secret, key_version, is_active, created_by)
    VALUES (${environmentId}, ${apiKey}, ${secretDigest}, 1, true, ${ownerId})
  `);

  return { apiKey, apiSecret };
}

export async function getIntegrationEnvironment(applicationId: number, environmentType: string) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const result = await db.execute(sql`
    SELECT * FROM integration_environments
    WHERE application_id = ${applicationId} AND environment_type = ${environmentType}
    ORDER BY created_at DESC LIMIT 1
  `);
  return result.rows[0] ?? null;
}

export async function getApiCredentials(environmentId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const result = await db.execute(sql`
    SELECT api_key, key_version, created_at, last_used_at, expires_at
    FROM api_credentials
    WHERE environment_id = ${environmentId} AND is_active = true
    ORDER BY created_at DESC LIMIT 1
  `);
  return result.rows[0] ?? null;
}

export async function recordSdkDownload(applicationId: number, sdkType: string, version: string) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await requireApplicationOwner(applicationId);
  await db.execute(sql`
    INSERT INTO sdk_downloads (application_id, sdk_type, version)
    VALUES (${applicationId}, ${sdkType}, ${version})
  `);
  return { success: true };
}

type TestResult = {
  passed: boolean;
  duration: number;
  message: string;
  details: Record<string, unknown>;
};

type IntegrationTargets = {
  primaryEndpoint: string | null;
  webhookUrl: string | null;
};

async function resolveIntegrationTargets(applicationId: number): Promise<IntegrationTargets> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const result = await db.execute<{ primary_endpoint: string | null; webhook_url: string | null }>(sql`
    SELECT primary_endpoint, webhook_url
    FROM technical_configurations
    WHERE application_id = ${applicationId}
    ORDER BY updated_at DESC LIMIT 1
  `);
  return {
    primaryEndpoint: result.rows[0]?.primary_endpoint ?? null,
    webhookUrl: result.rows[0]?.webhook_url ?? null,
  };
}

async function request(url: URL, init: RequestInit): Promise<{ status: number; body: string; duration: number }> {
  const startedAt = Date.now();
  const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(TEST_TIMEOUT_MS) });
  return { status: response.status, body: await response.text(), duration: Date.now() - startedAt };
}

async function executeTest(applicationId: number, testType: string, testName: string): Promise<TestResult> {
  const targets = await resolveIntegrationTargets(applicationId);
  const unsupported = (reason: string): TestResult => ({
    passed: false,
    duration: 0,
    message: reason,
    details: { testType, testName, execution: 'not-performed' },
  });

  if (testType === 'api_connectivity' || testType === 'authentication' || testType === 'data_format' || testType === 'idempotency' || testType === 'rate_limiting') {
    if (!targets.primaryEndpoint) return unsupported('No primary endpoint is configured for this application');
    const endpoint = assertSafeIntegrationUrl(targets.primaryEndpoint, 'technical_configurations.primary_endpoint');

    if (testType === 'api_connectivity') {
      const result = await request(endpoint, { method: 'GET', headers: { Accept: 'application/json' } });
      return {
        passed: result.status >= 200 && result.status < 400,
        duration: result.duration,
        message: `Endpoint returned HTTP ${result.status}`,
        details: { testType, testName, endpoint: endpoint.origin, httpStatus: result.status },
      };
    }

    if (testType === 'authentication') {
      const result = await request(endpoint, { method: 'GET', headers: { Authorization: 'Bearer invalid-integration-test-token', Accept: 'application/json' } });
      return {
        passed: result.status === 401 || result.status === 403,
        duration: result.duration,
        message: result.status === 401 || result.status === 403 ? 'Endpoint rejected the invalid bearer token' : `Endpoint returned HTTP ${result.status}; expected 401 or 403`,
        details: { testType, testName, endpoint: endpoint.origin, httpStatus: result.status },
      };
    }

    if (testType === 'data_format') {
      const result = await request(endpoint, { method: 'GET', headers: { Accept: 'application/json' } });
      let validJson = false;
      try { JSON.parse(result.body); validJson = true; } catch { validJson = false; }
      return {
        passed: result.status >= 200 && result.status < 400 && validJson,
        duration: result.duration,
        message: validJson ? `Endpoint returned JSON with HTTP ${result.status}` : 'Endpoint did not return valid JSON',
        details: { testType, testName, endpoint: endpoint.origin, httpStatus: result.status, validJson },
      };
    }

    return unsupported(`${testType} requires a provider-specific scenario definition; it cannot be certified by a generic request without risking a real financial operation`);
  }

  if (testType === 'webhook_delivery') {
    if (!targets.webhookUrl) return unsupported('No webhook URL is configured for this application');
    const webhookUrl = assertSafeIntegrationUrl(targets.webhookUrl, 'technical_configurations.webhook_url');
    const testEvent = { event: 'integration.test', id: crypto.randomUUID(), occurredAt: new Date().toISOString() };
    const result = await request(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Payment-Switch-Test': 'true' },
      body: JSON.stringify(testEvent),
    });
    return {
      passed: result.status >= 200 && result.status < 300,
      duration: result.duration,
      message: `Webhook returned HTTP ${result.status}`,
      details: { testType, testName, endpoint: webhookUrl.origin, httpStatus: result.status, eventId: testEvent.id },
    };
  }

  return unsupported(`Unsupported integration test type: ${testType}`);
}

/** Run a bounded real integration test and persist its raw outcome. */
export async function runIntegrationTest(applicationId: number, testType: string, testName: string) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await requireApplicationOwner(applicationId);

  const inserted = await db.execute<{ id: number }>(sql`
    INSERT INTO integration_tests (application_id, test_type, test_name, status, started_at)
    VALUES (${applicationId}, ${testType}, ${testName}, 'running', NOW())
    RETURNING id
  `);
  const testId = Number(inserted.rows[0]?.id ?? 0);
  if (!testId) throw new Error('Integration test record could not be created');

  let result: TestResult;
  try {
    result = await executeTest(applicationId, testType, testName);
  } catch (error) {
    result = {
      passed: false,
      duration: 0,
      message: error instanceof Error ? error.message : 'Integration test execution failed',
      details: { testType, testName, execution: 'failed' },
    };
  }

  await db.execute(sql`
    UPDATE integration_tests
    SET status = ${result.passed ? 'passed' : 'failed'}, result_data = ${JSON.stringify(result)}::jsonb, executed_at = NOW(), completed_at = NOW()
    WHERE id = ${testId}
  `);
  return { testId, ...result };
}

export async function getIntegrationTests(applicationId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const result = await db.execute(sql`
    SELECT * FROM integration_tests WHERE application_id = ${applicationId} ORDER BY created_at DESC
  `);
  return result.rows;
}

export async function getSdkDownloads(applicationId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const result = await db.execute(sql`
    SELECT * FROM sdk_downloads WHERE application_id = ${applicationId} ORDER BY downloaded_at DESC
  `);
  return result.rows;
}
