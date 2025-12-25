# ============================================================================
# Stage 1: Base image with pnpm enabled
# ============================================================================
FROM node:18.20-alpine AS base

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# ============================================================================
# Stage 2: Install dependencies
# ============================================================================
FROM base AS deps

# Copy workspace configuration files
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY package.json ./
COPY tsconfig.base.json ./

# Copy package.json files for all packages (needed for workspace resolution)
COPY packages/shared/package.json ./packages/shared/
COPY packages/agent/package.json ./packages/agent/

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# ============================================================================
# Stage 3: Build the application
# ============================================================================
FROM deps AS builder

# Copy source code
COPY packages/shared/ ./packages/shared/
COPY packages/agent/ ./packages/agent/

# Build shared package first, then agent
RUN pnpm --filter @reliable-server-agent/shared build && \
    pnpm --filter @reliable-server-agent/agent build

# ============================================================================
# Stage 4: Production runtime
# ============================================================================
FROM node:18.20-alpine AS runner

# Security: Create non-root user
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup appuser

WORKDIR /app

# Copy node_modules (agent has no native modules, so we can copy directly)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/agent/node_modules ./packages/agent/node_modules

# Copy workspace and package files
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/agent/package.json ./packages/agent/

# Copy compiled JavaScript
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/agent/dist ./packages/agent/dist

# Copy @reliable-server-agent/shared package to agent's node_modules
# pnpm creates symlinks that don't work after Docker COPY, so we replace them
RUN rm -rf /app/packages/agent/node_modules/@reliable-server-agent/shared && \
    mkdir -p /app/packages/agent/node_modules/@reliable-server-agent/shared && \
    cp /app/packages/shared/package.json /app/packages/agent/node_modules/@reliable-server-agent/shared/ && \
    cp -r /app/packages/shared/dist /app/packages/agent/node_modules/@reliable-server-agent/shared/ && \
    chmod -R a+r /app/packages/agent/node_modules/@reliable-server-agent/shared

# Create state directory for agent journal with correct ownership
RUN mkdir -p /app/.agent-state && chown -R appuser:appgroup /app/.agent-state

# Security: Switch to non-root user
USER appuser

# Environment variables
ENV NODE_ENV=production \
    SERVER_URL=http://localhost:3000 \
    AGENT_STATE_DIR=/app/.agent-state

# Start the agent using the CLI entry point
CMD ["node", "packages/agent/dist/cli.js"]
