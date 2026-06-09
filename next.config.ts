import type { NextConfig } from "next";
import { validateStripeBillingEnv } from "./src/env/validate-billing-env";

if (process.env.SKIP_ENV_VALIDATION !== "true") {
  validateStripeBillingEnv();
}

const nextConfig: NextConfig = {
  devIndicators: {
    position: 'bottom-right',
  },
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-neon', '@neondatabase/serverless', '@aws-sdk/client-s3'],
  turbopack: {
    rules: {
      '*.html': { loaders: ['raw-loader'], as: '*.js' },
      '*.svg': { loaders: ['raw-loader'], as: '*.js' },
    },
  },
  experimental: {
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default nextConfig;
