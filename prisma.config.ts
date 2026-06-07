import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // DIRECT_URL is required for migrations but not for `prisma generate`.
    // Falling back to empty string lets generate work without a .env file.
    url: process.env.DIRECT_URL ?? process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL ?? '',
  },
})
