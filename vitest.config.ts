import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/actions/**', 'src/lib/**'],
      exclude: ['src/**/*.html', 'src/lib/db/**', 'src/lib/infra/prisma.ts', 'src/lib/infra/redis.ts', 'src/lib/infra/resend.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
