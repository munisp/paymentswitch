import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('operational configuration service', () => {
  const originalUrl = process.env.OPERATIONAL_CONFIGURATION_URL;
  const originalToken = process.env.OPERATIONAL_CONFIGURATION_TOKEN;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env.OPERATIONAL_CONFIGURATION_URL = 'https://operations.test.example';
    process.env.OPERATIONAL_CONFIGURATION_TOKEN = 'test-operations-token';
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.OPERATIONAL_CONFIGURATION_URL;
    else process.env.OPERATIONAL_CONFIGURATION_URL = originalUrl;
    if (originalToken === undefined) delete process.env.OPERATIONAL_CONFIGURATION_TOKEN;
    else process.env.OPERATIONAL_CONFIGURATION_TOKEN = originalToken;
  });

  it('forwards an authenticated authoritative rail request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ type: 'PAPSS' }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { operationalConfigurationService } = await import('./operationalConfigurationService');
    await expect(operationalConfigurationService.listRails()).resolves.toEqual([{ type: 'PAPSS' }]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://operations.test.example/v1/payment-rails',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer test-operations-token' }),
      }),
    );
  });

  it('fails closed when the authoritative service returns an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('upstream unavailable', { status: 503 })));
    const { operationalConfigurationService, OperationalConfigurationUnavailable } = await import('./operationalConfigurationService');
    await expect(operationalConfigurationService.listRails()).rejects.toBeInstanceOf(OperationalConfigurationUnavailable);
  });

  it('fails closed when the required endpoint is not configured', async () => {
    delete process.env.OPERATIONAL_CONFIGURATION_URL;
    const { operationalConfigurationService, OperationalConfigurationUnavailable } = await import('./operationalConfigurationService');
    await expect(operationalConfigurationService.listRails()).rejects.toBeInstanceOf(OperationalConfigurationUnavailable);
  });
});
