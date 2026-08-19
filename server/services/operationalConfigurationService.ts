const configurationBaseUrl = process.env.OPERATIONAL_CONFIGURATION_URL?.replace(/\/$/, '');
const configurationToken = process.env.OPERATIONAL_CONFIGURATION_TOKEN;
const requestTimeoutMs = Number.parseInt(process.env.OPERATIONAL_CONFIGURATION_TIMEOUT_MS ?? '5000', 10);

export class OperationalConfigurationUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperationalConfigurationUnavailable';
  }
}

function configuredBaseUrl(): string {
  if (!configurationBaseUrl) {
    throw new OperationalConfigurationUnavailable('OPERATIONAL_CONFIGURATION_URL is not configured.');
  }
  return configurationBaseUrl;
}

async function request<T>(path: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET', body?: unknown): Promise<T> {
  const baseUrl = configuredBaseUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(configurationToken ? { Authorization: `Bearer ${configurationToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new OperationalConfigurationUnavailable(`Operational configuration service returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 512)}` : ''}.`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      throw new OperationalConfigurationUnavailable('Operational configuration service returned a non-JSON response.');
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof OperationalConfigurationUnavailable) throw error;
    const message = error instanceof Error ? error.message : 'Request failed';
    throw new OperationalConfigurationUnavailable(`Operational configuration service is unavailable: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function callOperationsService<T>(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body?: unknown,
): Promise<T> {
  return request<T>(path, method, body);
}

export const operationalConfigurationService = {
  listRails: () => request<any>('/v1/payment-rails'),
  listRailStatuses: () => request<any>('/v1/payment-rails/status'),
  listCorridorRoutes: () => request<any>('/v1/corridors'),
  listDfsps: () => request<any>('/v1/dfsps'),
  railsForCorridor: (corridorId: string) => request<any>(`/v1/corridors/${encodeURIComponent(corridorId)}/rails`),
  calculateCorridorFee: (corridorId: string, principalUsd: number) => request<any>(`/v1/corridors/${encodeURIComponent(corridorId)}/fee?principalUsd=${encodeURIComponent(String(principalUsd))}`),
  createRail: (input: unknown) => request<any>('/v1/payment-rails', 'POST', input),
  updateRail: (type: string, input: unknown) => request<any>(`/v1/payment-rails/${encodeURIComponent(type)}`, 'PATCH', input),
  deleteRail: (type: string) => request<any>(`/v1/payment-rails/${encodeURIComponent(type)}`, 'DELETE'),
  updateRailStatus: (rail: string, input: unknown) => request<any>(`/v1/payment-rails/${encodeURIComponent(rail)}/status`, 'PATCH', input),
  createCorridorRoute: (input: unknown) => request<any>('/v1/corridors', 'POST', input),
  updateCorridorRoute: (corridorId: string, input: unknown) => request<any>(`/v1/corridors/${encodeURIComponent(corridorId)}`, 'PATCH', input),
  deleteCorridorRoute: (corridorId: string) => request<any>(`/v1/corridors/${encodeURIComponent(corridorId)}`, 'DELETE'),
  createDfsp: (input: unknown) => request<any>('/v1/dfsps', 'POST', input),
  updateDfsp: (dfspId: string, input: unknown) => request<any>(`/v1/dfsps/${encodeURIComponent(dfspId)}`, 'PATCH', input),
  deleteDfsp: (dfspId: string) => request<any>(`/v1/dfsps/${encodeURIComponent(dfspId)}`, 'DELETE'),
};
