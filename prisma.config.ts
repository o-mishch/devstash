import 'dotenv/config'
import { defineConfig, env } from '@prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // DIRECT_URL is required for migrations but not for `prisma generate`.
    // We use process.env to avoid PrismaConfigEnvError when variables are missing during Vercel build.
    url: process.env.DIRECT_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL || 'postgresql://dummy:dummy@localhost/dummy',
  },
})
