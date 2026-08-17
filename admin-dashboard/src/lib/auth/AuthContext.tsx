'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createLogger } from '@/lib/logger';

const log = createLogger('AuthContext');

export interface User {
  id: string;
  username: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
  organizationId?: string;
  participantId?: string;
  twoFactorEnabled?: boolean;
  twoFactorVerified?: boolean;
}

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  /** Short-lived token held in React memory only; never persisted to local/session storage. */
  accessToken: string | null;
  error: string | null;
}

export interface AuthContextType extends AuthState {
  login: (returnTo?: string) => void;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  hasRole: (role: string) => boolean;
  hasPermission: (permission: string) => boolean;
  checkPermission: (permission: string, resource: string, resourceId: string) => Promise<boolean>;
  verify2FA: (code: string) => Promise<void>;
  requires2FA: boolean;
}

type SessionResponse = {
  authenticated: true;
  accessToken: string;
  expiresIn: number;
  user: User;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const AuthContext = createContext<AuthContextType | undefined>(undefined);

function isSessionResponse(value: unknown): value is SessionResponse {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<SessionResponse>;
  return session.authenticated === true && typeof session.accessToken === 'string' && typeof session.expiresIn === 'number' && !!session.user;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    user: null,
    accessToken: null,
    error: null,
  });
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = null;
  }, []);

  const clearAuth = useCallback(() => {
    clearRefreshTimer();
    setState({ isAuthenticated: false, isLoading: false, user: null, accessToken: null, error: null });
  }, [clearRefreshTimer]);

  const applySession = useCallback((session: SessionResponse) => {
    clearRefreshTimer();
    setState({
      isAuthenticated: true,
      isLoading: false,
      user: session.user,
      accessToken: session.accessToken,
      error: null,
    });
    // Refresh one minute before expiry, but never schedule a tight refresh loop.
    const refreshInMs = Math.max(session.expiresIn * 1000 - 60_000, 10_000);
    refreshTimer.current = setTimeout(() => {
      void refreshTokenInternal();
    }, refreshInMs);
  // refreshTokenInternal is declared below and is stable for the provider lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearRefreshTimer]);

  const refreshTokenInternal = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !isSessionResponse(body)) {
        clearAuth();
        return;
      }
      applySession(body);
    } catch (error) {
      log.warn('Silent token refresh failed', error);
      clearAuth();
    }
  }, [applySession, clearAuth]);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const response = await fetch('/api/auth/session', {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });
        const body: unknown = await response.json().catch(() => null);
        if (response.ok && isSessionResponse(body)) {
          applySession(body);
        } else {
          clearAuth();
        }
      } catch (error) {
        log.warn('Session bootstrap failed', error);
        clearAuth();
      }
    };
    void bootstrap();
    return clearRefreshTimer;
  }, [applySession, clearAuth, clearRefreshTimer]);

  const login = useCallback((returnTo = window.location.pathname) => {
    const target = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
    window.location.assign(`/api/auth/login?returnTo=${encodeURIComponent(target)}`);
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
      clearAuth();
    }
  }, [clearAuth]);

  const hasRole = useCallback((role: string) => state.user?.roles.includes(role) || false, [state.user]);
  const hasPermission = useCallback((permission: string) => state.user?.permissions.includes(permission) || false, [state.user]);

  const checkPermission = useCallback(async (permission: string, resource: string, resourceId: string): Promise<boolean> => {
    if (!state.user || !state.accessToken) return false;
    try {
      const response = await fetch(`${API_BASE}/api/v1/authz/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.accessToken}` },
        body: JSON.stringify({
          subject: { type: 'user', id: state.user.id },
          permission,
          resource: { type: resource, id: resourceId },
        }),
      });
      if (!response.ok) return false;
      const data: unknown = await response.json();
      return typeof data === 'object' && data !== null && (data as { allowed?: unknown }).allowed === true;
    } catch {
      return false;
    }
  }, [state.user, state.accessToken]);

  const verify2FA = useCallback(async (code: string) => {
    if (!state.user || !state.accessToken) throw new Error('Not authenticated');
    setState((previous) => ({ ...previous, isLoading: true, error: null }));
    try {
      const response = await fetch(`${API_BASE}/api/v1/auth/verify-2fa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.accessToken}` },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) throw new Error('Invalid 2FA code');
      setState((previous) => previous.user ? {
        ...previous,
        isLoading: false,
        user: { ...previous.user, twoFactorVerified: true },
        error: null,
      } : previous);
    } catch (error) {
      const message = error instanceof Error ? error.message : '2FA verification failed';
      setState((previous) => ({ ...previous, isLoading: false, error: message }));
      throw error;
    }
  }, [state.user, state.accessToken]);

  const value: AuthContextType = {
    ...state,
    login,
    logout,
    refreshToken: refreshTokenInternal,
    hasRole,
    hasPermission,
    checkPermission,
    verify2FA,
    requires2FA: state.user?.twoFactorEnabled === true && state.user?.twoFactorVerified !== true,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}

export const ROLES = {
  SUPER_ADMIN: 'super_admin', NOC_OPERATOR: 'noc_operator', COMPLIANCE_OFFICER: 'compliance_officer',
  KYC_REVIEWER: 'kyc_reviewer', KYB_REVIEWER: 'kyb_reviewer', SETTLEMENT_OFFICER: 'settlement_officer',
  FRAUD_ANALYST: 'fraud_analyst', DEVELOPER: 'developer', AUDITOR: 'auditor', PARTICIPANT_ADMIN: 'participant_admin',
} as const;

export const PERMISSIONS = {
  VIEW_KYC: 'view_kyc', REVIEW_KYC: 'review_kyc', APPROVE_KYC: 'approve_kyc', REJECT_KYC: 'reject_kyc',
  VIEW_KYB: 'view_kyb', REVIEW_KYB: 'review_kyb', APPROVE_KYB: 'approve_kyb', REJECT_KYB: 'reject_kyb',
  VIEW_ONBOARDING: 'view_onboarding', MANAGE_ONBOARDING: 'manage_onboarding',
  VIEW_SETTLEMENTS: 'view_settlements', APPROVE_SETTLEMENT: 'approve_settlement',
  VIEW_FRAUD_ALERTS: 'view_fraud_alerts', RESOLVE_FRAUD_ALERT: 'resolve_fraud_alert',
  MANAGE_USERS: 'manage_users', MANAGE_ROLES: 'manage_roles', VIEW_SYSTEM_METRICS: 'view_system_metrics',
} as const;
