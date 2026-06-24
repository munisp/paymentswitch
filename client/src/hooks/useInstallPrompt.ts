/**
 * PWA install prompt management — native app-like install experience.
 * Handles beforeinstallprompt event, deferred prompts, and install tracking.
 */
import { useCallback, useEffect, useState } from "react";

interface InstallPromptState {
  canInstall: boolean;
  isInstalled: boolean;
  platform: 'ios' | 'android' | 'desktop' | 'unknown';
  showIOSInstructions: boolean;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function useInstallPrompt() {
  const [state, setState] = useState<InstallPromptState>({
    canInstall: false,
    isInstalled: false,
    platform: 'unknown',
    showIOSInstructions: false,
  });
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Detect if already installed
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true;

    const platform = detectPlatform();

    setState(s => ({
      ...s,
      isInstalled: isStandalone,
      platform,
      showIOSInstructions: platform === 'ios' && !isStandalone,
    }));

    // Listen for install prompt (Chrome/Edge/Samsung)
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setState(s => ({ ...s, canInstall: true }));
    };
    window.addEventListener('beforeinstallprompt', handler);

    // Track installation
    window.addEventListener('appinstalled', () => {
      setState(s => ({ ...s, isInstalled: true, canInstall: false }));
      setDeferredPrompt(null);
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
      setState(s => ({ ...s, canInstall: false }));
      return true;
    }
    return false;
  }, [deferredPrompt]);

  const dismissIOSInstructions = useCallback(() => {
    setState(s => ({ ...s, showIOSInstructions: false }));
    localStorage.setItem('pwa-ios-dismissed', 'true');
  }, []);

  return {
    ...state,
    promptInstall,
    dismissIOSInstructions,
  };
}

function detectPlatform(): 'ios' | 'android' | 'desktop' | 'unknown' {
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  if (/windows|macintosh|linux/.test(ua)) return 'desktop';
  return 'unknown';
}
