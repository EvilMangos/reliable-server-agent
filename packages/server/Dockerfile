# ============================================================================
# Stage 1: Base image with pnpm enabled
# ============================================================================
FROM node:18.20-alpine AS base

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# ============================================================================
# Stage 2: Install dependencies (including native module build tools)
# ============================================================================
FROM base AS deps

# Install build tools required for better-sqlite3 native module compilation
RUN apk add --no-cache python3 make g++

# Copy workspace configuration files
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY package.json ./
COPY tsconfig.base.json ./

# Copy package.json files for all packages (needed for workspace resolution)
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# ============================================================================
# Stage 3: Build the application
# ============================================================================
FROM deps AS builder

# Copy source code
COPY packages/shared/ ./packages/shared/
COPY packages/server/ ./packages/server/

# Build shared package first, then server
RUN pnpm --filter @reliable-server-agent/shared build && \
    pnpm --filter @reliable-server-agent/server build

# ============================================================================
# Stage 4: Production runtime
# ============================================================================
FROM node:18.20-alpine AS runner

# Security: Create non-root user
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup appuser

WORKDIR /app

# Copy built artifacts and production dependencies
# Note: We need the native module from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/server/node_modules ./packages/server/node_modules

# Copy workspace and package files
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/server/package.json ./packages/server/

# Copy compiled JavaScript
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/server/dist ./packages/server/dist

# Copy @reliable-server-agent/shared package to server's node_modules
# pnpm creates symlinks that don't work after Docker COPY, so we replace them
RUN rm -rf /app/packages/server/node_modules/@reliable-server-agent/shared && \
    mkdir -p /app/packages/server/node_modules/@reliable-server-agent/shared && \
    cp /app/packages/shared/package.json /app/packages/server/node_modules/@reliable-server-agent/shared/ && \
    cp -r /app/packages/shared/dist /app/packages/server/node_modules/@reliable-server-agent/shared/ && \
    chmod -R a+r /app/packages/server/node_modules/@reliable-server-agent/shared

# Create data directory for SQLite database with correct ownership
RUN mkdir -p /app/data && chown -R appuser:appgroup /app/data

# Security: Switch to non-root user
USER appuser

# Environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/app/data/commands.db

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the server
CMD ["node", "packages/server/dist/index.js"]
