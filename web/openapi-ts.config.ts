import { defineConfig } from '@hey-api/openapi-ts'

// Regenerating the client is a REVIEWED event, not a routine build step
// (Hey API is pre-1.0 with frequent breaking changes). Run `npm run openapi:gen`
// after re-emitting web/openapi.json from the Go backend, then eyeball the diff —
// especially unions and nullable fields against the real Huma 3.1 spec.
export default defineConfig({
  input: './openapi.json',
  output: {
    path: './src/client',
    // Hey API's built-in post-processor is Prettier; oxfmt (the workspace formatter) isn't a
    // supported option here. This runs only on the generated client, which is lint-exempt
    // (web/.oxlintrc.json ignores src/client/**), so it doesn't contradict the oxfmt policy.
    postProcess: ['prettier'],
  },
  plugins: [
    {
      name: '@hey-api/client-fetch',
      // Runtime config (baseUrl, credentials) lives in a hand-written file so the
      // generated output stays purely declarative.
      runtimeConfigPath: './src/lib/api/config.ts',
    },
    {
      name: '@tanstack/react-query',
      queryOptions: true,
    },
  ],
})
