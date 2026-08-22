import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

// Optional development bypass. It is never enabled implicitly.
const DEV_MOCK_ADMIN =
  import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEV_AUTH === "true"
    ? {
        id: 1,
        name: "Dev Admin",
        email: "admin@dev.local",
        role: "admin" as const,
        loginMethod: "dev-bypass",
      }
    : null;

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = "/login" } =
    options ?? {};
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    enabled: !DEV_MOCK_ADMIN, // Skip query if using dev bypass
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        return;
      }
      throw error;
    } finally {
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
    }
  }, [logoutMutation, utils]);

  const state = useMemo(() => {
    // Use dev mock admin if bypass is enabled
    const userData = DEV_MOCK_ADMIN || meQuery.data;
    localStorage.setItem(
      "keycloak-runtime-user-info",
      JSON.stringify(userData)
    );
    return {
      user: userData ?? null,
      loading: DEV_MOCK_ADMIN
        ? false
        : meQuery.isLoading || logoutMutation.isPending,
      error: DEV_MOCK_ADMIN
        ? null
        : (meQuery.error ?? logoutMutation.error ?? null),
      isAuthenticated: Boolean(userData),
    };
  }, [
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  useEffect(() => {
    // Never redirect in dev mode when using mock admin
    if (DEV_MOCK_ADMIN) return;
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || logoutMutation.isPending) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (window.location.pathname === redirectPath) return;

    window.location.href = redirectPath;
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    meQuery.isLoading,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
