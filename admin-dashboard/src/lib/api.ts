/**
 * Lakehouse API Client
 * Connects admin dashboard to the lakehouse query service
 */

import { useState, useEffect, useCallback } from 'react';
import { logger } from './logger';
const API_BASE_URL = process.env.NEXT_PUBLIC_LAKEHOUSE_API_URL || 'http://localhost:8080';

export interface MetricCard {
  label: string;
  value: string | number;
  change?: number;
  change_label?: string;
  trend: 'up' | 'down' | 'neutral';
}

export interface ParticipantHealth {
  id: string;
  name: string;
  status: 'healthy' | 'degraded' | 'down';
  tps: number;
  success_rate: number;
  latency_ms: number;
}

export interface Transaction {
  id: string;
  payer: string;
  payee: string;
  amount: number;
  currency: string;
  status: string;
  latency_ms?: number;
  timestamp: string;
}

export interface FraudAlert {
  id: string;
  transaction_id: string;
  alert_type: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'OPEN' | 'INVESTIGATING' | 'ESCALATED' | 'RESOLVED';
  risk_score: number;
  ml_confidence: number;
  payer: string;
  payee: string;
  amount: number;
  timestamp: string;
}

export interface Settlement {
  id: string;
  window_id: string;
  status: string;
  total_transactions: number;
  total_amount: number;
  participants: number;
  approvals_received: number;
  approvals_required: number;
  opened_at: string;
  closed_at: string;
}

export interface KillSwitch {
  id: string;
  name: string;
  type: string;
  scope: string;
  active: boolean;
  activated_at?: string;
  activated_by?: string;
}

export interface NOCMetrics {
  tps: MetricCard;
  success_rate: MetricCard;
  avg_latency: MetricCard;
  daily_volume: MetricCard;
  participant_health: ParticipantHealth[];
  recent_transactions: Transaction[];
  kill_switches: KillSwitch[];
}

export interface FraudMetrics {
  open_alerts: MetricCard;
  critical_alerts: MetricCard;
  resolved_today: MetricCard;
  avg_resolution_time: MetricCard;
  alerts: FraudAlert[];
  alerts_over_time: { hour: string; count: number }[];
}

export interface SettlementMetrics {
  pending_settlements: MetricCard;
  pending_amount: MetricCard;
  settled_today: MetricCard;
  active_participants: MetricCard;
  settlements: Settlement[];
}

export interface Participant {
  id: string;
  name: string;
  code: string;
  type: string;
  status: string;
  kyc_status: string;
  net_debit_cap: number;
  current_position: number;
  position_usage: number;
}

export interface ParticipantMetrics {
  total: number;
  active: number;
  pending: number;
  suspended: number;
  participants: Participant[];
}

export interface Report {
  id: string;
  name: string;
  type: string;
  format: string;
  size?: string;
  status: string;
  generated_at?: string;
  scheduled_at?: string;
}

export interface ReportsMetrics {
  ready: number;
  pending: number;
  submitted: number;
  total: number;
  reports: Report[];
}

export interface APIKey {
  id: string;
  name: string;
  key: string;
  status: string;
  permissions: string[];
  rate_limit: number;
  usage: number;
  last_used?: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  status: string;
  success_rate: number;
  last_delivery?: string;
}

export interface DeveloperMetrics {
  total_requests: string;
  active_keys: number;
  webhook_success_rate: number;
  avg_response_time: number;
  api_usage: { date: string; requests: number }[];
  api_keys: APIKey[];
  webhooks: Webhook[];
}

class LakehouseAPIClient {
  private baseUrl: string;
  private ws: WebSocket | null = null;
  private wsListeners: Map<string, (data: any) => void> = new Map();

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // NOC Dashboard
  async getNOCMetrics(): Promise<NOCMetrics> {
    return this.fetch<NOCMetrics>('/api/v1/noc/metrics');
  }

  // Fraud Dashboard
  async getFraudMetrics(): Promise<FraudMetrics> {
    return this.fetch<FraudMetrics>('/api/v1/fraud/metrics');
  }

  async resolveFraudAlert(alertId: string, resolution: string): Promise<void> {
    await this.fetch(`/api/v1/fraud/alerts/${alertId}/resolve?resolution=${resolution}`, {
      method: 'POST',
    });
  }

  // Settlement Dashboard
  async getSettlementMetrics(): Promise<SettlementMetrics> {
    return this.fetch<SettlementMetrics>('/api/v1/settlements/metrics');
  }

  async approveSettlement(settlementId: string): Promise<void> {
    await this.fetch(`/api/v1/settlements/${settlementId}/approve`, {
      method: 'POST',
    });
  }

  async rejectSettlement(settlementId: string, reason: string): Promise<void> {
    await this.fetch(`/api/v1/settlements/${settlementId}/reject?reason=${encodeURIComponent(reason)}`, {
      method: 'POST',
    });
  }

  // Participant Management
  async getParticipantMetrics(): Promise<ParticipantMetrics> {
    return this.fetch<ParticipantMetrics>('/api/v1/participants/metrics');
  }

  // Reports
  async getReportsMetrics(): Promise<ReportsMetrics> {
    return this.fetch<ReportsMetrics>('/api/v1/reports/metrics');
  }

  // Developer Portal
  async getDeveloperMetrics(): Promise<DeveloperMetrics> {
    return this.fetch<DeveloperMetrics>('/api/v1/developer/metrics');
  }

  // Kill Switches
  async activateKillSwitch(switchId: string, reason: string): Promise<void> {
    await this.fetch(`/api/v1/killswitch/${switchId}/activate?reason=${encodeURIComponent(reason)}`, {
      method: 'POST',
    });
  }

  async deactivateKillSwitch(switchId: string): Promise<void> {
    await this.fetch(`/api/v1/killswitch/${switchId}/deactivate`, {
      method: 'POST',
    });
  }

  // Analytics
  async getTransactionAnalytics(startDate?: string, endDate?: string, participant?: string) {
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    if (participant) params.append('participant', participant);
    return this.fetch(`/api/v1/analytics/transactions?${params}`);
  }

  async getFraudAnalytics(startDate?: string, endDate?: string) {
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    return this.fetch(`/api/v1/analytics/fraud?${params}`);
  }

  async getSettlementAnalytics(startDate?: string, endDate?: string) {
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    return this.fetch(`/api/v1/analytics/settlements?${params}`);
  }

  // WebSocket for real-time updates
  connectWebSocket(onMessage: (data: any) => void): void {
    const wsUrl = this.baseUrl.replace('http', 'ws') + '/ws/realtime';
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.info('[api] WebSocket connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (e) {
        logger.error('[api] WebSocket message parse error:', e);
      }
    };

    this.ws.onerror = (error) => {
      logger.error('[api] WebSocket error:', error);
    };

    this.ws.onclose = () => {
      console.info('[api] WebSocket disconnected');
      // Reconnect after 5 seconds
      setTimeout(() => this.connectWebSocket(onMessage), 5000);
    };
  }

  disconnectWebSocket(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  sendWebSocketMessage(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }
}

// Singleton instance
export const lakehouseAPI = new LakehouseAPIClient();

// React hooks for data fetching
export function useLakehouseData<T>(
  fetcher: () => Promise<T>,
  refreshInterval: number = 30000
): { data: T | null; loading: boolean; error: Error | null; refetch: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const result = await fetcher();
      setData(result);
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchData, refreshInterval]);

  return { data, loading, error, refetch: fetchData };
}

