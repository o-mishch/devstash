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

# Pinned to an exact supported Node 24 patch and Alpine release. Node 24 is the current
# Active LTS (Krypton) — keep this in sync with .nvmrc (the repo-wide Node version) and
# bump with Node security releases. For hardened production images, also pin the digest so
# a re-tag of the same version can't silently change the base:
#   node:24.18.0-alpine3.23@sha256:<digest>
# Fetch the digest for the current pinned version with:
#   docker pull node:24.18.0-alpine3.23 \
#     && docker inspect --format='{{index .RepoDigests 0}}' node:24.18.0-alpine3.23
# Or without pulling:
#   docker buildx imagetools inspect node:24.18.0-alpine3.23 \
#     --format '{{json .Manifest}}' | jq -r '.digest'
# When bumping NODE_VERSION: update .nvmrc and the digest too so CI stays reproducible.
ARG NODE_VERSION=24.18.0-alpine3.23@sha256:595398b0081eacda8e1c4c5b97b76cd1020e4d58a8ebcb4843b9bca1e79e7436

# ---- deps: install dependencies only (best layer-cache hit rate) ----------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
ENV NO_UPDATE_NOTIFIER=true
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
ENV NO_UPDATE_NOTIFIER=true
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

# ---- migrator-build: install the lean migration toolchain + generate client ---
# NOT the runtime image. The standalone `runner` below ships no Prisma CLI, tsx,
# or prisma/ dir, so it cannot run migrations. The migrator (built in TWO stages —
# this installer + the minimal `migrator` runtime below) is run as a GATED Kubernetes
# Job before the web rollout (infra/k8s/overlays/gcp/migrate-job.yaml). `prisma migrate
# deploy` reads DIRECT_URL via prisma.config.ts; the seed inserts the 7 system item_types
# (SEED_ITEM_TYPES_ONLY=1, idempotent) the app needs before it can create items.
#
# LEAN SUBSET INSTALL (not `COPY --from=deps node_modules`). The old copy dragged in web's
# entire dependency tree — next, @next/swc (native, ~100 MB+), react, tailwind and the
# rest — none of which the migrate/seed runtime touches. Crucially those are *production*
# deps, so `--omit=dev` would NOT drop them; the migrator needs a genuine SUBSET, not a
# pruned copy. So this stage installs ONLY the six packages the migrate + seed actually
# use, pinned to their exact package-lock versions (read at build time → zero drift from
# the app). --legacy-peer-deps mirrors the app's own resolution (adapter-pg 7.8.0 pairs
# with the 7.9.0-dev client). --ignore-scripts skips prisma's postinstall generate
# (deferred until prisma/ + src/ are present). Runtime deps: @prisma/client (WASM), the
# pg driver adapter and pg (the seed's DB_DRIVER=pg path), plus dotenv + bcryptjs (the
# seed's other top-level imports); build tools: prisma (CLI + schema-engine) and tsx
# (runs prisma/seed.ts). This set is the seed's + migrate's full runtime import closure —
# if prisma/seed.ts gains a top-level import of a new package, add it here.
#
# NO @prisma/adapter-neon: this is the GCP overlay image. `prisma migrate deploy` uses the
# native schema-engine over DIRECT_URL (no adapter), and the seed's CMD pins DB_DRIVER=pg
# so only the @prisma/adapter-pg branch is dynamically imported — the neon branch is dead
# code here. (Consequence: this image can only seed a pg target; overriding DB_DRIVER off
# `pg` would make the seed's `import('@prisma/adapter-neon')` fail — intended for GCP.)
FROM node:${NODE_VERSION} AS migrator-build
WORKDIR /app
ENV NO_UPDATE_NOTIFIER=true
# The lockfile lives at /tmp, NOT in the install cwd: with a package-lock.json present in
# the working dir, `npm install <pkgs>` reconciles against the whole lockfile and pulls the
# entire app tree (chart.js, hono, radix, …) — defeating the subset. Reading versions from
# /tmp and installing into an empty /app makes it a true subset (only these + real transitive
# deps of prisma/tsx/pg/etc.).
COPY package-lock.json /tmp/lock.json
RUN V() { node -p "require('/tmp/lock.json').packages['node_modules/'+process.argv[1]].version" "$1"; }; \
    npm install --no-save --no-audit --no-fund --legacy-peer-deps --ignore-scripts \
      "@prisma/client@$(V @prisma/client)" \
      "@prisma/adapter-pg@$(V @prisma/adapter-pg)" \
      "pg@$(V pg)" \
      "dotenv@$(V dotenv)" \
      "bcryptjs@$(V bcryptjs)" \
      "prisma@$(V prisma)" \
      "tsx@$(V tsx)" \
 && rm -f /tmp/lock.json
COPY package.json tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
# Regenerate the client into src/generated/prisma so the seed's relative import
# (`../src/generated/prisma/client`) resolves — the dir is gitignored, so it is
# never present in the build context.
RUN npx prisma generate

# ---- migrator: minimal one-shot migrator runtime --------------------------
# Fresh base + COPY only the resolved artifacts from migrator-build. WHY a second stage:
# the install layer bakes npm's on-disk cache (~200 MB) into itself; copying just the
# final node_modules/src into a clean image drops that cache and every other install-time
# temp from the shipped layers. Kept ahead of `runner` so the default (last-stage) build
# still targets runner.
FROM node:${NODE_VERSION} AS migrator
WORKDIR /app
# libc6-compat: `prisma migrate deploy` spawns the native glibc schema-engine binary.
RUN apk add --no-cache libc6-compat
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NO_UPDATE_NOTIFIER=true
COPY --from=migrator-build /app/node_modules ./node_modules
COPY --from=migrator-build /app/package.json /app/tsconfig.json /app/prisma.config.ts ./
COPY --from=migrator-build /app/prisma ./prisma
COPY --from=migrator-build /app/src ./src
# Drop root for hardened (PodSecurity "restricted") clusters. Root-owned image files
# are intentionally only readable/executable by this user; the Pod mounts /tmp as its
# sole writable path. Do not recursively chown the dependency tree: it adds a full
# metadata layer without granting a capability the Job uses.
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
ENV NO_UPDATE_NOTIFIER=true
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
