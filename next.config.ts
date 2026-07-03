import type { NextConfig } from "next";
import { validateStripeBillingEnv } from "./src/env/validate-billing-env";

if (process.env.SKIP_ENV_VALIDATION !== "true") {
  validateStripeBillingEnv();
}

// Build-time deployment-target discriminator. `VERCEL` is a base system env var Vercel
// always sets on its builds (independent of the "expose System Environment Variables"
// toggle). Everything non-Vercel — the GKE container image AND the local kind image, both
// built from the same Dockerfile — is treated as the self-hosted target. Used below to
// physically drop each target's unused dependencies from the build output.
const isVercel = Boolean(process.env.VERCEL);

const nextConfig: NextConfig = {
  // Emits a self-contained server bundle in `.next/standalone` (server.js + only the
  // node_modules actually traced as used). This is what makes the container image small
  // and lets the runtime stage copy a minimal tree instead of the whole repo + deps.
  // Safe for Vercel too — Vercel ignores it. See docs/devops/01-docker.md.
  output: 'standalone',
  // Inlined into BOTH server and client bundles at build time. Lets client components
  // (root-provider-shell.tsx) dead-code-eliminate Vercel-only packages like
  // @vercel/analytics on self-hosted builds — a client asset can't be dropped via
  // outputFileTracingExcludes (that only prunes traced server deps), so it must be gated
  // behind a build-time constant so the bundler removes the dynamic import outright.
  env: {
    NEXT_PUBLIC_VERCEL: isVercel ? '1' : '',
  },
  devIndicators: {
    position: 'bottom-right',
  },
  experimental: {
    staleTimes: {
      dynamic: 300,
    },
  },
  cacheComponents: true,
  // Keep server/native deps out of the bundle so they resolve via native `require` and
  // are copied into `.next/standalone/node_modules` (required for the runner image).
  // Being external is ALSO the precondition for per-target pruning below: a bundled
  // package lives inside `.next/server` chunks and can't be trace-excluded, whereas an
  // external one lives in node_modules and CAN be dropped per target.
  //
  // Vercel boundary — the split is enforced at TWO levels:
  //   1. Runtime gate: self-hosted deps are only reached through `require()` guards
  //      (DB_DRIVER=pg in db-local.ts, REDIS_URL in redis.ts, SMTP_HOST in
  //      email-local.ts) that never fire on Vercel. The Neon/Upstash/Resend paths
  //      are the unconditional defaults; the GKE paths are conditional overrides.
  //   2. Bundle gate (this list): marking a package as external prevents Next.js
  //      from inlining it into the server bundle. This matters for the self-hosted
  //      deps below — they are never LOADED on Vercel (the gates above ensure that)
  //      but they must also never be BUNDLED (bundling a native .node binary fails).
  //
  // Vercel/Neon path (present on all deployments):
  //   @prisma/client, @prisma/adapter-neon, @neondatabase/serverless, @aws-sdk/client-s3
  //   @upstash/redis, @upstash/ratelimit → REST cache + rate limiter; external so the
  //     self-hosted build (which never loads them — redis.ts/rate-limit.ts gate them
  //     behind !isTcpRedis()) can trace-exclude them below.
  // GKE/local path (gated by env vars — never loaded on Vercel, never bundled):
  //   @prisma/adapter-pg → node-postgres Prisma adapter (DB_DRIVER=pg)
  //   pg                 → node-postgres driver (DB_DRIVER=pg)
  //   redis, @redis/client → node-redis: native TCP Redis/Valkey client (REDIS_URL set)
  //   rate-limiter-flexible → rate limiting over the node-redis connection (the persistent-
  //                        connection counterpart to @upstash/ratelimit; see rate-limit-tcp.ts)
  //   google-auth-library → Valkey IAM token minting (REDIS_IAM_AUTH=true; pure JS,
  //                        but optional + gated, so kept external to avoid an
  //                        --omit=optional Vercel build inlining an absent dep)
  //   nodemailer         → SMTP email transport (SMTP_HOST set)
  //
  // DO NOT remove self-hosted packages from this list — they are real native deps
  // that would break the GKE container image build if not externalized.
  // DO NOT add self-hosted deps that are not runtime-gated — they would be bundled
  // into the Vercel deployment and may fail at native module resolution.
  serverExternalPackages: [
    // Vercel/Neon path
    '@prisma/client',
    '@prisma/adapter-neon',
    '@neondatabase/serverless',
    '@aws-sdk/client-s3',
    '@upstash/redis',
    '@upstash/ratelimit',
    // GKE/local path — runtime-gated, never loaded on Vercel
    '@prisma/adapter-pg',
    'pg',
    'redis',
    '@redis/client',
    'rate-limiter-flexible',
    'google-auth-library',
    'nodemailer',
  ],
  // Per-target dependency pruning. `output: 'standalone'` traces every package a route can
  // reach and copies it into the standalone tree; a package can be dropped only if the
  // target never LOADS it (else runtime MODULE_NOT_FOUND). `'/**'` matches all routes at
  // every depth. Client-only packages (e.g. @vercel/analytics) aren't traced deps and are
  // instead DCE'd via the NEXT_PUBLIC_VERCEL constant above.
  outputFileTracingExcludes: isVercel
    ? {
        // Vercel never sets REDIS_URL, so the node-redis TCP backend (redis-tcp.ts) and its
        // rate-limiter-flexible limiters are never loaded — drop them from the serverless functions.
        '/**': [
          'node_modules/redis/**/*',
          'node_modules/@redis/**/*',
          'node_modules/rate-limiter-flexible/**/*',
        ],
      }
    : {
        // Self-hosted uses node-redis + the TCP rate-limit backend, so the Upstash REST
        // client and Upstash ratelimit are never loaded — drop them from the image.
        '/**': ['node_modules/@upstash/redis/**/*', 'node_modules/@upstash/ratelimit/**/*'],
      },
  turbopack: {
    rules: {
      '*.html': { loaders: ['raw-loader'], as: '*.js' },
      '*.svg': { loaders: ['raw-loader'], as: '*.js' },
    },
  },
};

export default nextConfig;
