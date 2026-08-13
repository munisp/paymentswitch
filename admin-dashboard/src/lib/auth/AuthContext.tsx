'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { createLogger } from '@/lib/logger';
const log = createLogger('AuthContext');

// Types
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
  accessToken: string | null;
  error: string | null;
}

export interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  hasRole: (role: string) => boolean;
  hasPermission: (permission: string) => boolean;
  checkPermission: (permission: string, resource: string, resourceId: string) => Promise<boolean>;
  verify2FA: (code: string) => Promise<void>;
  requires2FA: boolean;
}

// Keycloak configuration
const KEYCLOAK_CONFIG = {
  baseUrl: process.env.NEXT_PUBLIC_KEYCLOAK_URL || 'http://localhost:8080',
  realm: process.env.NEXT_PUBLIC_KEYCLOAK_REALM || 'payment-switch',
  clientId: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID || 'admin-dashboard',
};

// Permify configuration
const PERMIFY_CONFIG = {
  baseUrl: process.env.NEXT_PUBLIC_PERMIFY_URL || 'http://localhost:3476',
  tenantId: process.env.NEXT_PUBLIC_PERMIFY_TENANT || 'payment-switch',
};

// API configuration
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Token storage keys
const ACCESS_TOKEN_KEY = 'ps_access_token';
const REFRESH_TOKEN_KEY = 'ps_refresh_token';
const USER_KEY = 'ps_user';

// Parse JWT token
function parseJwt(token: string): Record<string, unknown> | null {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

// Check if token is expired
function isTokenExpired(token: string): boolean {
  // A demo token is only accepted when explicitly enabled in a development build.
  if (token === 'demo-token') {
    return !(process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === 'true');
  }
  
  const payload = parseJwt(token);
  if (!payload || typeof payload.exp !== 'number') return true;
  return Date.now() >= payload.exp * 1000;
}

// Extract user from JWT claims
function extractUserFromToken(token: string): User | null {
  const claims = parseJwt(token);
  if (!claims) return null;

  const realmAccess = claims.realm_access as { roles?: string[] } | undefined;
  const resourceAccess = claims.resource_access as Record<string, { roles?: string[] }> | undefined;

  // Combine realm and resource roles
  const roles: string[] = [
    ...(realmAccess?.roles || []),
    ...(resourceAccess?.[KEYCLOAK_CONFIG.clientId]?.roles || []),
  ];

  return {
    id: claims.sub as string,
    username: claims.preferred_username as string || '',
    email: claims.email as string || '',
    name: claims.name as string || claims.preferred_username as string || '',
    roles,
    permissions: claims.permissions as string[] || [],
    organizationId: claims.organization_id as string | undefined,
    participantId: claims.participant_id as string | undefined,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    user: null,
    accessToken: null,
    error: null,
  });

  // Initialize auth state from storage
  useEffect(() => {
    const initAuth = async () => {
      try {
        const storedToken = localStorage.getItem(ACCESS_TOKEN_KEY);
        const storedUser = localStorage.getItem(USER_KEY);

        if (storedToken && !isTokenExpired(storedToken)) {
          const user = storedUser ? JSON.parse(storedUser) : extractUserFromToken(storedToken);
          setState({
            isAuthenticated: true,
            isLoading: false,
            user,
            accessToken: storedToken,
            error: null,
          });
        } else if (storedToken) {
          // Token expired, try to refresh
          const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
          if (refreshToken) {
            await refreshTokenInternal(refreshToken);
          } else {
            clearAuth();
          }
        } else {
          setState((prev) => ({ ...prev, isLoading: false }));
        }
      } catch (error) {
        log.error('Auth initialization error:', error);
        clearAuth();
      }
    };

    initAuth();
  }, []);

  const clearAuth = () => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setState({
      isAuthenticated: false,
      isLoading: false,
      user: null,
      accessToken: null,
      error: null,
    });
  };

  const refreshTokenInternal = async (refreshToken: string) => {
    try {
      const response = await fetch(
        `${KEYCLOAK_CONFIG.baseUrl}/realms/${KEYCLOAK_CONFIG.realm}/protocol/openid-connect/token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: KEYCLOAK_CONFIG.clientId,
            refresh_token: refreshToken,
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Token refresh failed');
      }

      const data = await response.json();
      const user = extractUserFromToken(data.access_token);

      localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
      localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
      if (user) {
        localStorage.setItem(USER_KEY, JSON.stringify(user));
      }

      setState({
        isAuthenticated: true,
        isLoading: false,
        user,
        accessToken: data.access_token,
        error: null,
      });
    } catch (error) {
      log.error('Token refresh error:', error);
      clearAuth();
    }
  };

    const login = useCallback(async (username: string, password: string) => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        // Demo credentials require an explicit development-only feature flag.
        const isDemoMode = process.env.NODE_ENV === 'development' &&
          process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === 'true';
        if (isDemoMode && username === 'demo' && password === 'demo') {
          const demoUser: User = {
            id: 'demo-user-001',
            username: 'demo',
            email: 'demo@payment-switch.com',
            name: 'Admin User',
            roles: ['super_admin', 'kyc_reviewer', 'kyb_reviewer', 'compliance_officer'],
            permissions: ['view_kyc', 'review_kyc', 'approve_kyc', 'view_kyb', 'review_kyb', 'approve_kyb'],
            organizationId: 'demo-org',
            participantId: 'demo-participant',
          };
          localStorage.setItem(USER_KEY, JSON.stringify(demoUser));
          localStorage.setItem(ACCESS_TOKEN_KEY, 'demo-token');
          setState({
            isAuthenticated: true,
            isLoading: false,
            user: demoUser,
            accessToken: 'demo-token',
            error: null,
          });
          return;
        }

        // Keycloak authentication (primary — production mode)
        const response = await fetch(
          `${KEYCLOAK_CONFIG.baseUrl}/realms/${KEYCLOAK_CONFIG.realm}/protocol/openid-connect/token`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              grant_type: 'password',
              client_id: KEYCLOAK_CONFIG.clientId,
              username,
              password,
              scope: 'openid profile email',
            }),
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error_description || 'Login failed');
        }

        const data = await response.json();
        const user = extractUserFromToken(data.access_token);

        localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
        localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
        if (user) {
          localStorage.setItem(USER_KEY, JSON.stringify(user));
        }

        setState({
          isAuthenticated: true,
          isLoading: false,
          user,
          accessToken: data.access_token,
          error: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Login failed';
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: message,
        }));
        throw error;
      }
    }, []);

  const logout = useCallback(async () => {
    try {
      const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
      if (refreshToken) {
        // Logout from Keycloak
        await fetch(
          `${KEYCLOAK_CONFIG.baseUrl}/realms/${KEYCLOAK_CONFIG.realm}/protocol/openid-connect/logout`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              client_id: KEYCLOAK_CONFIG.clientId,
              refresh_token: refreshToken,
            }),
          }
        ).catch(() => {
          // Ignore logout errors
        });
      }
    } finally {
      clearAuth();
    }
  }, []);

  const refreshToken = useCallback(async () => {
    const storedRefreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (storedRefreshToken) {
      await refreshTokenInternal(storedRefreshToken);
    }
  }, []);

  const hasRole = useCallback(
    (role: string): boolean => {
      return state.user?.roles.includes(role) || false;
    },
    [state.user]
  );

  const hasPermission = useCallback(
    (permission: string): boolean => {
      return state.user?.permissions.includes(permission) || false;
    },
    [state.user]
  );

  // Check permission via Permify
  const checkPermission = useCallback(
    async (permission: string, resource: string, resourceId: string): Promise<boolean> => {
      if (!state.user || !state.accessToken) return false;

      try {
        const response = await fetch(`${API_BASE}/api/v1/authz/check`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${state.accessToken}`,
          },
          body: JSON.stringify({
            subject: {
              type: 'user',
              id: state.user.id,
            },
            permission,
            resource: {
              type: resource,
              id: resourceId,
            },
          }),
        });

        if (!response.ok) return false;

        const data = await response.json();
        return data.allowed === true;
      } catch {
        return false;
      }
    },
    [state.user, state.accessToken]
  );

  // 2FA verification
  const verify2FA = useCallback(async (code: string) => {
    if (!state.user || !state.accessToken) {
      throw new Error('Not authenticated');
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const response = await fetch(`${API_BASE}/api/v1/auth/verify-2fa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${state.accessToken}`,
        },
        body: JSON.stringify({ code }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Invalid 2FA code');
      }

      // Update user state to mark 2FA as verified
      const updatedUser = { ...state.user, twoFactorVerified: true };
      localStorage.setItem(USER_KEY, JSON.stringify(updatedUser));

      setState((prev) => ({
        ...prev,
        isLoading: false,
        user: updatedUser,
        error: null,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : '2FA verification failed';
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: message,
      }));
      throw error;
    }
  }, [state.user, state.accessToken]);

  // Check if 2FA is required but not yet verified
  const requires2FA = state.user?.twoFactorEnabled === true && state.user?.twoFactorVerified !== true;

  // Set up token refresh interval
  useEffect(() => {
    if (!state.isAuthenticated || !state.accessToken) return;

    // Refresh token 1 minute before expiry
    const payload = parseJwt(state.accessToken);
    if (!payload || typeof payload.exp !== 'number') return;

    const expiresIn = payload.exp * 1000 - Date.now();
    const refreshIn = Math.max(expiresIn - 60000, 10000); // At least 10 seconds

    const timeoutId = setTimeout(() => {
      refreshToken();
    }, refreshIn);

    return () => clearTimeout(timeoutId);
  }, [state.isAuthenticated, state.accessToken, refreshToken]);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        logout,
        refreshToken,
        hasRole,
        hasPermission,
        checkPermission,
        verify2FA,
        requires2FA,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Role constants
export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  NOC_OPERATOR: 'noc_operator',
  COMPLIANCE_OFFICER: 'compliance_officer',
  KYC_REVIEWER: 'kyc_reviewer',
  KYB_REVIEWER: 'kyb_reviewer',
  SETTLEMENT_OFFICER: 'settlement_officer',
  FRAUD_ANALYST: 'fraud_analyst',
  DEVELOPER: 'developer',
  AUDITOR: 'auditor',
  PARTICIPANT_ADMIN: 'participant_admin',
} as const;

// Permission constants (matching Permify schema)
export const PERMISSIONS = {
  // KYC
  VIEW_KYC: 'view_kyc',
  REVIEW_KYC: 'review_kyc',
  APPROVE_KYC: 'approve_kyc',
  REJECT_KYC: 'reject_kyc',
  
  // KYB
  VIEW_KYB: 'view_kyb',
  REVIEW_KYB: 'review_kyb',
  APPROVE_KYB: 'approve_kyb',
  REJECT_KYB: 'reject_kyb',
  
  // Onboarding
  VIEW_ONBOARDING: 'view_onboarding',
  MANAGE_ONBOARDING: 'manage_onboarding',
  
  // Settlements
  VIEW_SETTLEMENTS: 'view_settlements',
  APPROVE_SETTLEMENT: 'approve_settlement',
  
  // Fraud
  VIEW_FRAUD_ALERTS: 'view_fraud_alerts',
  RESOLVE_FRAUD_ALERT: 'resolve_fraud_alert',
  
  // Admin
  MANAGE_USERS: 'manage_users',
  MANAGE_ROLES: 'manage_roles',
  VIEW_SYSTEM_METRICS: 'view_system_metrics',
} as const;
