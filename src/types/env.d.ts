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

    UPSTASH_REDIS_REST_URL: string;
    UPSTASH_REDIS_REST_TOKEN: string;

    FILEBASE_KEY: string;
    FILEBASE_SECRET: string;
    FILEBASE_BUCKET: string;

    STRIPE_WEBHOOK_SECRET: string;
    STRIPE_SECRET_KEY: string;
    STRIPE_PUBLISHABLE_KEY?: string;
    STRIPE_PRICE_ID_MONTHLY: string;
    STRIPE_PRICE_ID_YEARLY: string;
    OPENAI_API_KEY: string;
    SKIP_ENV_VALIDATION?: string;
  }
}
