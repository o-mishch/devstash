# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# DevStash production image — multi-stage build for Next.js standalone output.
# See infra/docs/01-docker.md for the full walkthrough.
#
# Stages:
#   deps    — install node_modules (cached unless lockfile changes)
#   builder — run `next build`, producing .next/standalone
#   runner  — minimal runtime: copies only the standalone server + static assets
# ---------------------------------------------------------------------------

# Pinned to an exact supported Node 22 patch and Alpine release. Node 22 remains in
# Maintenance LTS through April 2027; keep this current with Node security releases.
# For hardened production images, also pin the digest so a re-tag of the same
# version can't silently change the base:
#   node:22.23.1-alpine3.23@sha256:<digest>
# Fetch the digest for the current pinned version with:
#   docker pull node:22.23.1-alpine3.23 \
#     && docker inspect --format='{{index .RepoDigests 0}}' node:22.23.1-alpine3.23
# Or without pulling:
#   docker buildx imagetools inspect node:22.23.1-alpine3.23 \
#     --format '{{json .Manifest}}' | jq -r '.digest'
# When bumping NODE_VERSION: update the digest too so CI stays reproducible.
ARG NODE_VERSION=22.23.1-alpine3.23@sha256:8516dce0483394d5708d4b2ee6cacb79fb1d617ea4e2787c2120bcca92ce372e

# ---- deps: install dependencies only (best layer-cache hit rate) ----------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# libc6-compat: Prisma's query engine binary is a glibc-linked ELF; Alpine ships
# musl only. This shim satisfies the missing symbols so the engine starts.
# --no-cache skips storing the Alpine package index in a layer (saves ~8 MB).
RUN apk add --no-cache libc6-compat
# Copy only manifests first so this layer is reused whenever source — but not
# dependencies — changes. `postinstall` runs `prisma generate`, so the schema
# must be present before `npm ci`.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ---- builder: compile the app ---------------------------------------------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
# libc6-compat: `npx prisma generate` spawns the native query-engine binary to
# introspect the schema — same glibc-shim requirement as the deps stage.
# --no-cache skips storing the Alpine package index in a layer (saves ~8 MB).
RUN apk add --no-cache libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Regenerate the Prisma client into src/generated/prisma. The dir is gitignored,
# so it is NOT in the build context — and a clean CI checkout never runs `npm ci`
# in this job, so the deps-stage copy carries only node_modules. Without this,
# `next build` can't resolve `@/generated/prisma`. No DB needed (prisma.config.ts
# has a dummy URL fallback).
RUN npx prisma generate
# Skip billing/Redis env validation in next.config.ts — we build without real
# secrets. Telemetry off keeps build output clean and offline-friendly.
ENV NEXT_TELEMETRY_DISABLED=1
ENV SKIP_ENV_VALIDATION=true
RUN npm run build

# ---- migrator: one-shot DB migrations + system item-type seed -------------
# NOT the runtime image. The standalone `runner` below ships no Prisma CLI, tsx,
# or prisma/ dir, so it cannot run migrations. This stage keeps the full
# toolchain and is run as a GATED Kubernetes Job before the web rollout
# (infra/k8s/overlays/gcp/migrate-job.yaml). `prisma migrate deploy` reads
# DIRECT_URL via prisma.config.ts; the seed inserts the 7 system item_types
# (SEED_ITEM_TYPES_ONLY=1, idempotent) the app needs before it can create items.
# Kept ahead of `runner` so the default (last-stage) build still targets runner.
FROM node:${NODE_VERSION} AS migrator
WORKDIR /app
# libc6-compat: Prisma query-engine + Prisma CLI both require the glibc shim on Alpine.
RUN apk add --no-cache libc6-compat
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Full deps (Prisma CLI + tsx + adapter-pg) plus the files the CLI/seed read.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
# Regenerate the client into src/generated/prisma so the seed's relative import
# (`../src/generated/prisma/client`) resolves — the dir is gitignored, so it is
# never present in the build context.
RUN npx prisma generate
# Drop root for hardened (PodSecurity "restricted") clusters. Root-owned image files
# are intentionally only readable/executable by this user; the Pod mounts /tmp as its
# sole writable path. Do not recursively chown the 600 MB dependency tree: it adds
# about a minute and a full metadata layer without granting a capability the Job uses.
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 --ingroup nodejs nextjs
USER nextjs
# Apply pending migrations, then idempotently seed the system item types.
# DB_DRIVER=pg selects the node-postgres adapter — managed Cloud SQL speaks plain
# Postgres over TCP, not the Neon serverless protocol. The Job may override this CMD.
CMD ["sh", "-c", "npx prisma migrate deploy && DB_DRIVER=pg SEED_ITEM_TYPES_ONLY=1 npx tsx prisma/seed.ts"]

# ---- runner: minimal runtime image ----------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next listens on PORT; HOSTNAME 0.0.0.0 is required so the server is reachable
# from outside the container (default 127.0.0.1 only binds loopback).
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as a non-root user — a hard requirement for hardened K8s clusters
# (PodSecurity "restricted" rejects root containers).
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 --ingroup nodejs nextjs

# Standalone output bundles a minimal server.js + traced node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Static assets and public/ are NOT included in standalone — copy them explicitly.
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

# Image-level liveness check (K8s overrides this with its own probes; useful for
# `docker run` and Compose). server.js is the standalone entrypoint Next emits.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
