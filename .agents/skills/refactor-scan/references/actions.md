### `src/actions/` — Server Actions

Look for:
- **Repeated auth checks**: Multiple actions doing the same `getSession()` / `auth()` call and user validation pattern
- **Repeated Zod validation patterns**: Similar schema definitions or parse-then-return-error flows
- **Repeated try/catch error handling**: Same error response shape (`{ success, error }`) constructed repeatedly
- **Repeated rate limiting setup**: Same rate limiter initialization pattern across actions
- **Repeated Prisma query patterns**: Similar where clauses, select fields, or include patterns (also flag as P2 if Prisma is called directly in actions instead of via `src/lib/db/`)
- **Repeated Pro/feature gating checks**: Same isPro checks with similar error responses

Suggest: Shared action wrappers, validation helpers, error response builders, authenticated action factories.
