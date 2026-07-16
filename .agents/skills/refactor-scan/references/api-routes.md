### `src/app/api/` — API Routes

Look for:
- **Repeated auth verification**: Same session check pattern across routes
- **Repeated request parsing**: Same body/params extraction and validation
- **Repeated response patterns**: Same NextResponse.json() shapes for success/error
- **Repeated error handling**: Same try/catch with similar error responses
- **Repeated CORS/header setup**: Same headers applied across routes
- **Repeated rate limiting**: Same rate limit initialization
- **Direct Prisma calls**: DB queries must go through `src/lib/db/` — calling Prisma directly in an API route is a P2 violation

Suggest: API middleware helpers, response builders, authenticated route wrappers, shared validators.
