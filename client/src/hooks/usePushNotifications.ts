import { useCallback, useEffect, useState } from "react";
import { createLogger } from '@/lib/logger';
const log = createLogger('usePushNotifications');

interface PushNotificationState {
  isSupported: boolean;
  isSubscribed: boolean;
  permission: NotificationPermission;
  subscription: PushSubscription | null;
}

interface UsePushNotificationsReturn extends PushNotificationState {
  subscribe: () => Promise<PushSubscription | null>;
  unsubscribe: () => Promise<boolean>;
  requestPermission: () => Promise<NotificationPermission>;
  showNotification: (title: string, options?: NotificationOptions) => Promise<void>;
}

// VAPID public key - in production, this should come from environment variables
const VAPID_PUBLIC_KEY = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotifications(): UsePushNotificationsReturn {
  const [state, setState] = useState<PushNotificationState>({
    isSupported: false,
    isSubscribed: false,
    permission: "default",
    subscription: null,
  });

  // Check support and existing subscription
  useEffect(() => {
    const checkSupport = async () => {
      const isSupported =
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;

      if (!isSupported) {
        log.info("[Push] Push notifications not supported");
        return;
      }

      setState((s) => ({
        ...s,
        isSupported: true,
        permission: Notification.permission,
      }));

      // Check for existing subscription
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        
        if (subscription) {
          setState((s) => ({
            ...s,
            isSubscribed: true,
            subscription,
          }));
        }
      } catch (error) {
        log.error("[Push] Error checking subscription:", error);
      }
    };

    checkSupport();
  }, []);

  // Request notification permission
  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (!state.isSupported) {
      return "denied";
    }

    try {
      const permission = await Notification.requestPermission();
      setState((s) => ({ ...s, permission }));
      return permission;
    } catch (error) {
      log.error("[Push] Error requesting permission:", error);
      return "denied";
    }
  }, [state.isSupported]);

  // Subscribe to push notifications
  const subscribe = useCallback(async (): Promise<PushSubscription | null> => {
    if (!state.isSupported) {
      log.info("[Push] Push not supported");
      return null;
    }

    // Request permission if not granted
    if (Notification.permission !== "granted") {
      const permission = await requestPermission();
      if (permission !== "granted") {
        log.info("[Push] Permission denied");
        return null;
      }
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });

      log.info("[Push] Subscribed:", subscription.endpoint);

      setState((s) => ({
        ...s,
        isSubscribed: true,
        subscription,
      }));

      // Send subscription to server
      await sendSubscriptionToServer(subscription);

      return subscription;
    } catch (error) {
      log.error("[Push] Subscription failed:", error);
      return null;
    }
  }, [state.isSupported, requestPermission]);

  // Unsubscribe from push notifications
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!state.subscription) {
      return true;
    }

    try {
      await state.subscription.unsubscribe();
      
      // Remove subscription from server
      await removeSubscriptionFromServer(state.subscription);

      setState((s) => ({
        ...s,
        isSubscribed: false,
        subscription: null,
      }));

      log.info("[Push] Unsubscribed");
      return true;
    } catch (error) {
      log.error("[Push] Unsubscribe failed:", error);
      return false;
    }
  }, [state.subscription]);

  // Show a notification directly (for testing or local notifications)
  const showNotification = useCallback(
    async (title: string, options?: NotificationOptions): Promise<void> => {
      if (!state.isSupported || Notification.permission !== "granted") {
        log.info("[Push] Cannot show notification - not permitted");
        return;
      }

      try {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(title, {
          icon: "/icons/icon-192x192.png",
          badge: "/icons/icon-72x72.png",
          ...options,
        } as NotificationOptions);
      } catch (error) {
        log.error("[Push] Error showing notification:", error);
      }
    },
    [state.isSupported]
  );

  return {
    ...state,
    subscribe,
    unsubscribe,
    requestPermission,
    showNotification,
  };
}

// Helper functions to sync subscription with server
async function sendSubscriptionToServer(subscription: PushSubscription): Promise<void> {
  try {
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
      }),
      credentials: "include",
    });
  } catch (error) {
    log.error("[Push] Failed to send subscription to server:", error);
  }
}

async function removeSubscriptionFromServer(subscription: PushSubscription): Promise<void> {
  try {
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
      }),
      credentials: "include",
    });
  } catch (error) {
    log.error("[Push] Failed to remove subscription from server:", error);
  }
}

export default usePushNotifications;
