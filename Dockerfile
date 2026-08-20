# syntax=docker/dockerfile:1.6

# ============================================================
# Stage 1 — deps
# ============================================================
FROM node:18-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install bun for faster, deterministic installs (lockfile lives in repo).
RUN npm install -g bun

# Copy lockfile + manifests first to maximise layer caching.
COPY package.json bun.lock* package-lock.json* ./
COPY prisma ./prisma

# Install with Bun (falls back to npm if no bun.lock present).
RUN if [ -f bun.lock ]; then bun install --frozen-lockfile; \
    else npm ci; fi

# ============================================================
# Stage 2 — builder
# ============================================================
FROM node:18-alpine AS builder
WORKDIR /app

RUN npm install -g bun

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js collects completely anonymous telemetry — disable it in the image.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Build the standalone output (see next.config.ts: output: "standalone").
# `next build` writes .next/standalone, .next/static, and we copy public/ in
# the runner stage so the standalone server can serve static assets + favicon.
RUN bun run build

# ============================================================
# Stage 3 — runner (final image)
# ============================================================
FROM node:18-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as non-root for safety.
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Copy the standalone server + static assets + public dir.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static    ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public           ./public

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
