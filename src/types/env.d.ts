declare namespace NodeJS {
  interface ProcessEnv {
    DATABASE_URL: string;
    DIRECT_URL: string;

    AUTH_SECRET: string;
    AUTH_GITHUB_ID: string;
    AUTH_GITHUB_SECRET: string;
    AUTH_GOOGLE_ID: string;
    AUTH_GOOGLE_SECRET: string;
    NEXTAUTH_URL: string;

    RESEND_API_KEY: string;
    EMAIL_FROM?: string;
    DISABLE_EMAIL_VERIFICATION?: string;

    // Upstash Redis REST client — required on Vercel, optional on GKE/local where
    // REDIS_URL is set and node-redis is used instead (getRedis() checks REDIS_URL first).
    UPSTASH_REDIS_REST_URL?: string;
    UPSTASH_REDIS_REST_TOKEN?: string;

    // Native TCP Redis/Valkey (node-redis) — set ONLY on long-running deployments (GKE/
    // Memorystore for Valkey, local kind). When present, getRedis() uses node-redis instead
    // of the Upstash REST client. Unset on Vercel. REDIS_CA_CERT is the optional PEM to
    // verify Memorystore's server-authentication (in-transit TLS) cert. REDIS_IAM_AUTH is
    // set ("true") only in the GKE overlay: it makes the client authenticate with a
    // short-lived Google IAM access token (Valkey IAM auth) instead of connecting no-auth
    // (local kind). See src/lib/infra/redis-tcp.ts.
    REDIS_URL?: string;
    REDIS_CA_CERT?: string;
    REDIS_IAM_AUTH?: string;

    AWS_ACCESS_KEY_ID: string;
    AWS_SECRET_ACCESS_KEY: string;
    AWS_S3_BUCKET: string;
    AWS_REGION: string;

    // Self-hosted (GKE/Memorystore/Cloud SQL/GCS/local kind) path only — all unset on
    // Vercel, where the gated branches no-op. Each behavior keys off the connection
    // config it actually needs, so there is no separate "is this a cluster" flag:
    //   • DB_DRIVER='pg'        selects the node-postgres adapter (DB_POOL_MAX caps each
    //                           pod's pool). The one explicit flag — DATABASE_URL alone
    //                           can't tell Neon from Cloud SQL. Unset ⇒ Neon (Vercel).
    //   • AWS_ENDPOINT_URL_S3   set ⇒ path-style S3 (GCS interop on GKE, MinIO locally);
    //                           unset ⇒ real AWS S3 virtual-host (Vercel).
    //   • SMTP_HOST             set ⇒ SMTP mail sink (Mailpit, local only); unset ⇒ Resend
    //                           (Vercel AND GCP — GCP uses managed Resend, not SMTP).
    // See infra/docs/07-local-run.md.
    DB_DRIVER?: string;
    DB_POOL_MAX?: string;
    // Cloud SQL server CA (PEM) — when set, the node-postgres adapter verifies the
    // TLS chain (verify-CA; hostname skipped for the private-IP connection). Unset on
    // Vercel and on local kind (plain Postgres). Orthogonal to DB_DRIVER: this only
    // refines TLS behavior *within* the DB_DRIVER='pg' path. See src/lib/infra/db-local.ts.
    //
    // DECISION — do not collapse DB_DRIVER and DATABASE_CA_CERT into one var. Considered
    // and rejected: using DATABASE_CA_CERT alone (unset ⇒ Neon, set-but-empty ⇒ pg/no-TLS,
    // set-with-PEM ⇒ pg/TLS) would require selecting the adapter on `!== undefined` while
    // resolveDbSsl() (src/lib/utils/db-ssl.ts) treats '' and undefined as identical for TLS
    // purposes — two different falsy-checks on the same var, one wrong default away from
    // routing local kind through the Neon adapter. It also depends on "present but empty"
    // surviving every env-var path (k8s envFrom preserves it; dotenv/.env and some CI
    // secret injectors don't reliably). Twelve-Factor config favors explicit, orthogonal,
    // granular vars over inference (https://12factor.net/config) — keep these separate.
    //
    // DECISION — do not also fold in DB_POOL_MAX. Checked against node-postgres directly
    // (github.com/brianc/node-postgres, packages/pg/lib/connection-parameters.js): `max`
    // (pool size) is a Pool **constructor option only** — there is no `max=`/equivalent
    // connection-string param, so it cannot be derived from DATABASE_URL at all. And the
    // URL's sslrootcert/sslca map to libpq **file paths**, not inline PEM — folding
    // DATABASE_CA_CERT in would require switching delivery from inline PEM (current ESO/
    // Secret Manager sync) to a mounted cert file, a real infra change, not a cleanup.
    // DB_POOL_MAX is also deployment-specific tuning (GCP's db-f1-micro instance ceiling;
    // unset locally, falls back to DEFAULT_DB_POOL_MAX in db-local.ts) — independent from
    // both adapter selection and TLS policy. Keep all three separate.
    DATABASE_CA_CERT?: string;
    AWS_ENDPOINT_URL_S3?: string;
    SMTP_HOST?: string;
    SMTP_PORT?: string;

    STRIPE_WEBHOOK_SECRET: string;
    STRIPE_SECRET_KEY: string;
    STRIPE_PUBLISHABLE_KEY?: string;
    STRIPE_PRICE_ID_MONTHLY: string;
    STRIPE_PRICE_ID_YEARLY: string;
    OPENAI_API_KEY: string;
    SKIP_ENV_VALIDATION?: string;
    LOG_LEVEL?: string;

    // Set automatically by Vercel to "1" on its builds (independent of the "expose System
    // Environment Variables" toggle). Absent on GKE and local kind. next.config reads it at
    // build time to select each target's dependency-pruning set (see outputFileTracingExcludes).
    VERCEL?: string;
    // Build-time constant injected by next.config (`env`), derived from VERCEL: '1' on Vercel
    // builds, '' otherwise. Unlike VERCEL it is inlined into the CLIENT bundle, so client code
    // (root-provider-shell.tsx) can dead-code-eliminate Vercel-only packages (@vercel/analytics)
    // on self-hosted builds. Not user-configurable — never set it by hand.
    NEXT_PUBLIC_VERCEL?: string;
  }
}
