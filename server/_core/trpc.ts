import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { requirePlatformPermission } from '../security/permifyAuth';

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const UNVERIFIED_DATA_ROUTER_NAMESPACES = new Set([
  'outboundRemittance',
  'inboundRemittance',
  'domesticPayments',
  'governmentPayments',
  'openBanking',
  'cardProcessing',
  'tradePayments',
]);

/**
 * These domains contain legacy seed/simulation branches that have not yet been
 * replaced end-to-end with authoritative providers and persisted data. They are
 * unavailable by default rather than returning plausible-looking financial,
 * compliance, or operational information. Demo behavior can only be enabled
 * deliberately in a non-production environment.
 */
const requireAuthoritativeRouter = t.middleware(async ({ path, next }) => {
  const namespace = path.split('.')[0];
  const demoOverride = process.env.NODE_ENV !== 'production' && process.env.ENABLE_UNVERIFIED_DEMO_ROUTES === 'true';
  if (UNVERIFIED_DATA_ROUTER_NAMESPACES.has(namespace) && !demoOverride) {
    throw new TRPCError({
      code: 'SERVICE_UNAVAILABLE',
      message: `The ${namespace} domain is unavailable until its authoritative data integrations are configured.`,
    });
  }
  return next();
});

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  await requirePlatformPermission(ctx.user.id, 'view');

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser).use(requireAuthoritativeRouter);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    await requirePlatformPermission(ctx.user.id, 'admin');

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
