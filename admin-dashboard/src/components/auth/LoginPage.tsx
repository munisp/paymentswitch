'use client';

import React, { useState } from 'react';
import { AlertCircle, Building2, Fingerprint, KeyRound, Loader2, Lock, Shield } from 'lucide-react';
import { useAuth } from '@/lib/auth';

interface LoginPageProps {
  onLoginSuccess?: () => void;
}

export function LoginPage({ onLoginSuccess: _onLoginSuccess }: LoginPageProps) {
  const { login, isLoading, error } = useAuth();
  const [startingLogin, setStartingLogin] = useState(false);

  const beginLogin = () => {
    setStartingLogin(true);
    login(window.location.pathname);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl" />
      </div>

      <main className="relative w-full max-w-md">
        <header className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-600 rounded-2xl mb-4">
            <Shield className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white"><span className="text-primary-400">Payment</span>Switch</h1>
          <p className="text-gray-400 mt-2">Admin Dashboard</p>
        </header>

        <section className="bg-gray-800/50 backdrop-blur-xl border border-gray-700 rounded-2xl p-8 shadow-2xl" aria-labelledby="sign-in-title">
          <div className="text-center mb-6">
            <h2 id="sign-in-title" className="text-xl font-semibold text-white">Sign in securely</h2>
            <p className="text-gray-400 text-sm mt-1">You will be redirected to Keycloak. This dashboard never receives or stores your password or refresh token.</p>
          </div>

          <div className="flex items-center justify-center space-x-4 mb-6 text-xs text-gray-500">
            <span className="flex items-center"><Lock className="h-3 w-3 mr-1" />Keycloak Authorization Code + PKCE</span>
            <span className="flex items-center"><Fingerprint className="h-3 w-3 mr-1" />Permify RBAC</span>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start" role="alert">
              <AlertCircle className="h-5 w-5 text-red-400 mr-2 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          <button
            type="button"
            onClick={beginLogin}
            disabled={isLoading || startingLogin}
            className="w-full py-3 px-4 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-600/50 text-white font-medium rounded-lg transition-colors flex items-center justify-center"
          >
            {isLoading || startingLogin ? <><Loader2 className="h-5 w-5 mr-2 animate-spin" />Redirecting to Keycloak…</> : <><KeyRound className="h-5 w-5 mr-2" />Continue with Keycloak</>}
          </button>

          <div className="mt-6 pt-6 border-t border-gray-700 text-center text-sm text-gray-400">
            <Building2 className="inline h-4 w-4 mr-1" /> Enterprise federation and multi-factor authentication are managed by your identity provider.
          </div>
        </section>

        <footer className="mt-6 text-center">
          <p className="text-xs text-gray-500">Protected by APISIX Gateway • OpenAppSec WAF • Keycloak IAM</p>
        </footer>
      </main>
    </div>
  );
}

export default LoginPage;
