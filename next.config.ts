import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
  devIndicators: {
    position: 'bottom-right',
  },
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-neon', '@neondatabase/serverless'],
  turbopack: {
    rules: {
      '*.html': { loaders: ['raw-loader'], as: '*.js' },
      '*.svg': { loaders: ['@svgr/webpack'], as: '*.js' },
    },
  },
};

export default nextConfig;
