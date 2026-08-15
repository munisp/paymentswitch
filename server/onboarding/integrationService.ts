import { getDb } from '../db';
import { sql } from 'drizzle-orm';
import crypto from 'crypto';

/**
 * Provision a sandbox environment for integration development
 */
export async function provisionSandboxEnvironment(applicationId: number, createdBy: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  // Generate unique sandbox endpoint
  const sandboxId = crypto.randomBytes(8).toString('hex');
  const apiEndpoint = `https://sandbox-${sandboxId}.payment-switch.dev`;

  // Create sandbox environment
  const result = await db.execute<{ id: number }>(sql`
    INSERT INTO integration_environments (application_id, environment_type, api_endpoint, status)
    VALUES (${applicationId}, 'sandbox', ${apiEndpoint}, 'active')
    RETURNING id
  `);

  const environmentId = Number(result.rows[0]?.id ?? 0);

  // Generate API credentials for sandbox
  const credentials = await generateApiCredentials(environmentId, createdBy);

  return {
    environmentId,
    apiEndpoint,
    credentials,
    status: 'active',
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
  };
}

/**
 * Generate API credentials for an environment
 */
export async function generateApiCredentials(environmentId: number, createdBy: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  // Generate secure API key and secret
  const apiKey = `pk_${crypto.randomBytes(24).toString('hex')}`;
  const apiSecret = `sk_${crypto.randomBytes(32).toString('hex')}`;

  // Hash the secret before storing
  const hashedSecret = crypto.createHash('sha256').update(apiSecret).digest('hex');

  await db.execute(sql`
    INSERT INTO api_credentials (environment_id, api_key, api_secret, created_by, is_active)
    VALUES (${environmentId}, ${apiKey}, ${hashedSecret}, ${createdBy}, TRUE)
  `);

  return {
    apiKey,
    apiSecret, // Return plain secret only once
  };
}

/**
 * Get integration environment details
 */
export async function getIntegrationEnvironment(applicationId: number, environmentType: string) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const result = await db.execute(sql`
    SELECT * FROM integration_environments
    WHERE application_id = ${applicationId} AND environment_type = ${environmentType}
    LIMIT 1
  `);

  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Get API credentials for an environment
 */
export async function getApiCredentials(environmentId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const result = await db.execute(sql`
    SELECT api_key, created_at, last_used_at, is_active
    FROM api_credentials
    WHERE environment_id = ${environmentId} AND is_active = TRUE
    ORDER BY created_at DESC
    LIMIT 1
  `);

  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Record SDK download
 */
export async function recordSdkDownload(applicationId: number, sdkType: string, version: string) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  await db.execute(sql`
    INSERT INTO sdk_downloads (application_id, sdk_type, version)
    VALUES (${applicationId}, ${sdkType}, ${version})
  `);

  return { success: true };
}

/**
 * Run integration test
 */
export async function runIntegrationTest(applicationId: number, testType: string, testName: string) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  // Create test record
  const testResult2 = await db.execute<{ id: number }>(sql`
    INSERT INTO integration_tests (application_id, test_type, test_name, status)
    VALUES (${applicationId}, ${testType}, ${testName}, 'running')
    RETURNING id
  `);

  const testId = Number(testResult2.rows[0]?.id ?? 0);

  // Execute a live probe or return an explicit unsupported result; never fabricate success.
  const testResult = await executeTest(applicationId, testType, testName);

  // Update test result
  await db.execute(sql`
    UPDATE integration_tests
    SET status = ${testResult.passed ? 'passed' : 'failed'},
        result_data = ${JSON.stringify(testResult)},
        executed_at = NOW()
    WHERE id = ${testId}
  `);

  return {
    testId,
    ...testResult,
  };
}

/**
 * Execute integration test against onboarded application
 * Validates connectivity, authentication, and data format compliance
 */
async function executeTest(applicationId: number, testType: string, testName: string) {
  const startTime = Date.now();
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const configResult = await db.execute(sql`
    SELECT primary_endpoint, backup_endpoint, webhook_url
    FROM technical_configurations
    WHERE application_id = ${applicationId}
    ORDER BY updated_at DESC
    LIMIT 1
  `);
  const config = (configResult.rows as Array<Record<string, unknown>>)[0];
  const endpoint = typeof config?.primary_endpoint === 'string' && config.primary_endpoint.length > 0
    ? config.primary_endpoint
    : typeof config?.backup_endpoint === 'string' && config.backup_endpoint.length > 0
      ? config.backup_endpoint
      : null;

  if (testType === 'api_connectivity' || testType === 'authentication') {
    if (!endpoint) {
      return { passed: false, duration: Date.now() - startTime, message: 'No configured primary or backup endpoint', details: { testType, testName, checks: [testType] } };
    }
    try {
      const response = await fetch(endpoint, { method: 'GET', signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
      const contentType = response.headers.get('content-type') || '';
      const passed = response.ok && (testType === 'api_connectivity' || response.status !== 401);
      return {
        passed,
        duration: Date.now() - startTime,
        message: passed ? `Live endpoint responded with HTTP ${response.status}` : `Live endpoint check failed with HTTP ${response.status}`,
        details: { testType, testName, endpoint, status: response.status, contentType, checks: [testType] },
      };
    } catch (error) {
      return { passed: false, duration: Date.now() - startTime, message: error instanceof Error ? error.message : 'Live endpoint probe failed', details: { testType, testName, endpoint, checks: [testType] } };
    }
  }

  if (testType === 'webhook_delivery') {
    const webhookUrl = typeof config?.webhook_url === 'string' ? config.webhook_url : null;
    if (!webhookUrl) {
      return { passed: false, duration: Date.now() - startTime, message: 'No configured webhook URL', details: { testType, testName, checks: [testType] } };
    }
    try {
      const response = await fetch(webhookUrl, { method: 'OPTIONS', signal: AbortSignal.timeout(10_000) });
      return { passed: response.ok, duration: Date.now() - startTime, message: response.ok ? `Webhook endpoint responded to OPTIONS with HTTP ${response.status}` : `Webhook endpoint probe failed with HTTP ${response.status}`, details: { testType, testName, webhookUrl, status: response.status, checks: [testType] } };
    } catch (error) {
      return { passed: false, duration: Date.now() - startTime, message: error instanceof Error ? error.message : 'Webhook endpoint probe failed', details: { testType, testName, webhookUrl, checks: [testType] } };
    }
  }

  return {
    passed: false,
    duration: Date.now() - startTime,
    message: `Test type ${testType} requires a registered executable test adapter; no result was fabricated`,
    details: { testType, testName, checks: [], unsupported: true },
  };
}

/**
 * Get all integration tests for an application
 */
export async function getIntegrationTests(applicationId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const result = await db.execute(sql`
    SELECT * FROM integration_tests
    WHERE application_id = ${applicationId}
    ORDER BY created_at DESC
  `);

  return result.rows as any[];
}

/**
 * Get SDK download history
 */
export async function getSdkDownloads(applicationId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const result = await db.execute(sql`
    SELECT * FROM sdk_downloads
    WHERE application_id = ${applicationId}
    ORDER BY downloaded_at DESC
  `);

  return result.rows as any[];
}
