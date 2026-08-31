# ─── Stage 1: Build Stage ──────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package manifests and install all dependencies
COPY package*.json ./
RUN npm ci

# Copy project configuration and source files
COPY tsconfig*.json vite.config.ts index.html postcss.config.js tailwind.config.js ./
COPY src/ ./src/
COPY server/ ./server/
COPY mcp-server/ ./mcp-server/
COPY scripts/ ./scripts/
COPY public/ ./public/
COPY api/ ./api/

# Build static assets (compiled into dist/)
RUN npm run build

# ─── Stage 2: Production Runner Stage ──────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Create unprivileged system group and user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

# Copy package manifests and install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled frontend from builder and necessary server files
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --chown=nodejs:nodejs server/ ./server/
COPY --chown=nodejs:nodejs src/ ./src/
COPY --chown=nodejs:nodejs tsconfig*.json ./

# Switch to non-root user
USER nodejs

# Expose documented server port
EXPOSE 3001

# Container healthcheck probing the live /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3001) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Start the Express server
CMD ["node_modules/.bin/tsx", "server/index.ts"]
