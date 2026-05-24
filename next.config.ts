import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: {
    position: 'bottom-right',
  },
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-neon', '@neondatabase/serverless'],
  turbopack: {
    rules: {
      '*.html': { loaders: ['raw-loader'], as: '*.js' },
    },
  },
};

export default nextConfig;
