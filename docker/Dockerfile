# Floom Chat — production Docker image.
# Uses pre-built artifacts from the host (apps/server/dist, apps/web/dist).
# Build with: docker build -t floom-chat:latest -f docker/Dockerfile .
# The build context must be the repo root.

FROM node:20-slim AS runtime
WORKDIR /app

# System deps: ca-certs + curl (healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=3000

# Install pnpm
RUN npm install -g pnpm@9.0.0 2>&1 | tail -3

# Copy package manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY packages/detect/package.json ./packages/detect/
COPY packages/manifest/package.json ./packages/manifest/
COPY packages/runtime/package.json ./packages/runtime/
COPY packages/cli/package.json ./packages/cli/

# Install only production server dependencies.
RUN pnpm install --filter @floom/server --prod --ignore-scripts 2>&1 | grep -v "^[[:space:]]*WARN\|^[[:space:]]*notice" || true

# Rebuild better-sqlite3 native module against the container's Node ABI.
RUN cd apps/server && npm rebuild better-sqlite3 2>&1 | tail -5 || true

# Copy pre-built server and web artifacts.
COPY apps/server/dist ./apps/server/dist
COPY apps/web/dist ./apps/web/dist

WORKDIR /app/apps/server

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:${PORT}/api/health || exit 1

CMD ["node", "dist/index.js"]
