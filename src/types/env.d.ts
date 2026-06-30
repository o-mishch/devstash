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
    // REDIS_URL is set and ioredis is used instead (getRedis() checks REDIS_URL first).
    UPSTASH_REDIS_REST_URL?: string;
    UPSTASH_REDIS_REST_TOKEN?: string;

    // Native TCP Redis (ioredis) — set ONLY on long-running deployments (GKE/
    // Memorystore, local kind). When present, getRedis() uses ioredis instead of
    // the Upstash REST client. Unset on Vercel. REDIS_CA_CERT is the optional PEM
    // to verify Memorystore's server-authentication (in-transit TLS) cert.
    REDIS_URL?: string;
    REDIS_CA_CERT?: string;

    AWS_ACCESS_KEY_ID: string;
    AWS_SECRET_ACCESS_KEY: string;
    AWS_S3_BUCKET: string;
    AWS_REGION: string;

    // Self-hosted (GKE/Memorystore/Cloud SQL/GCS/local kind) path only — all unset on
    // Vercel, where the gated branches no-op. Each behavior keys off the connection
    // config it actually needs, so there is no separate "is this a cluster" flag:
    //   • DB_LOCAL=1            selects the node-postgres adapter (DB_POOL_MAX caps each
    //                           pod's pool). The one explicit flag — DATABASE_URL alone
    //                           can't tell Neon from Cloud SQL.
    //   • AWS_ENDPOINT_URL_S3   set ⇒ path-style S3 (GCS interop on GKE, MinIO locally);
    //                           unset ⇒ real AWS S3 virtual-host (Vercel).
    //   • SMTP_HOST             set ⇒ SMTP mail sink (Mailpit, local only); unset ⇒ Resend
    //                           (Vercel AND GCP — GCP uses managed Resend, not SMTP).
    // See infra/docs/07-local-run.md.
    DB_LOCAL?: string;
    DB_POOL_MAX?: string;
    // Cloud SQL server CA (PEM) — when set, the node-postgres adapter verifies the
    // TLS chain (verify-CA; hostname skipped for the private-IP connection). Unset on
    // Vercel and on local kind (plain Postgres). See src/lib/infra/db-local.ts.
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

    // Set automatically by Vercel to "1". Absent on GKE and local kind, so the
    // Analytics component is conditionally rendered only on Vercel.
    VERCEL?: string;
  }
}
