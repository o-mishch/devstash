import type { NextConfig } from "next";
import { validateStripeBillingEnv } from "./src/env/validate-billing-env";

if (process.env.SKIP_ENV_VALIDATION !== "true") {
  validateStripeBillingEnv();
}

const nextConfig: NextConfig = {
  // Emits a self-contained server bundle in `.next/standalone` (server.js + only the
  // node_modules actually traced as used). This is what makes the container image small
  // and lets the runtime stage copy a minimal tree instead of the whole repo + deps.
  // Safe for Vercel too — Vercel ignores it. See docs/devops/01-docker.md.
  output: 'standalone',
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
  //
  // Vercel boundary — the split is enforced at TWO levels:
  //   1. Runtime gate: self-hosted deps are only reached through `require()` guards
  //      (DB_LOCAL=1 in db-local.ts, REDIS_URL in redis.ts, SMTP_HOST in
  //      email-local.ts) that never fire on Vercel. The Neon/Upstash/Resend paths
  //      are the unconditional defaults; the GKE paths are conditional overrides.
  //   2. Bundle gate (this list): marking a package as external prevents Next.js
  //      from inlining it into the server bundle. This matters for the self-hosted
  //      deps below — they are never LOADED on Vercel (the gates above ensure that)
  //      but they must also never be BUNDLED (bundling a native .node binary fails).
  //
  // Vercel/Neon path (present on all deployments):
  //   @prisma/client, @prisma/adapter-neon, @neondatabase/serverless, @aws-sdk/client-s3
  // GKE/local path (gated by env vars — never loaded on Vercel, never bundled):
  //   @prisma/adapter-pg → node-postgres Prisma adapter (DB_LOCAL=1)
  //   pg                 → node-postgres driver (DB_LOCAL=1)
  //   ioredis            → native TCP Redis client (REDIS_URL set)
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
    // GKE/local path — runtime-gated, never loaded on Vercel
    '@prisma/adapter-pg',
    'pg',
    'ioredis',
    'nodemailer',
  ],
  turbopack: {
    rules: {
      '*.html': { loaders: ['raw-loader'], as: '*.js' },
      '*.svg': { loaders: ['raw-loader'], as: '*.js' },
    },
  },
};

export default nextConfig;
