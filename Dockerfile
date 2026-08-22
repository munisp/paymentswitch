# Multi-stage Dockerfile for Payment Switch Platform

# Stage 1: Build application (frontend + backend)
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files and patches
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches

# Install pnpm (exact version matching packageManager field) and dependencies
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate
RUN pnpm install

# Copy all source
COPY client ./client
COPY server ./server
COPY shared ./shared
COPY drizzle ./drizzle
COPY tsconfig.json vite.config.ts ./

# Build frontend (vite) + backend (esbuild)
RUN pnpm run build

# Stage 2: Production image
FROM node:22-alpine

WORKDIR /app

# Install the XSD validator required for fail-closed ISO 20022 certification checks,
# then install pnpm and production dependencies only.
RUN apk add --no-cache libxml2-utils && \
    corepack enable && corepack prepare pnpm@10.4.1 --activate
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --prod

# Copy built assets from builder (dist/ contains both server bundle and public/ frontend)
COPY --from=builder /app/dist ./dist

# Copy shared and drizzle
COPY shared ./shared
COPY drizzle ./drizzle

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); })"

# Start application
CMD ["node", "dist/index.js"]
