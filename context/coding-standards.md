# Coding Standards

## TypeScript

- Strict mode enabled
- No `any` types - use proper typing or `unknown`
- Define interfaces for all props, API responses, and data models
- Use type inference where obvious, explicit types where helpful

## React

- Functional components only (no class components)
- Use hooks for state and side effects
- Keep components focused - one job per component
- Extract reusable logic into custom hooks
- Always define an explicit named interface for component props — never inline prop types

```tsx
// ✅ correct
interface SidebarProps {
  onClose?: () => void
}
export function Sidebar({ onClose }: SidebarProps) { ... }

// ❌ wrong
export function Sidebar({ onClose }: { onClose?: () => void }) { ... }
```

## Next.js

- Server components by default
- Only use `'use client'` when needed (interactivity, hooks, browser APIs)
- Use Server Actions for form submissions and simple mutations
- Use API routes when you need:
  - Webhooks (Stripe, GitHub, etc.)
  - File uploads with progress tracking
  - Long-running operations
  - Specific HTTP status codes or headers
  - Endpoints for future mobile/CLI clients
  - Third-party integrations
- Otherwise, fetch data directly in server components
- Dynamic routes for item/collection pages

## Tailwind CSS v4

**CRITICAL**: We are using Tailwind CSS v4, which uses CSS-based configuration.

- **DO NOT** create `tailwind.config.ts` or `tailwind.config.js` files (those are for v3)
- All theme configuration must be done in CSS using the `@theme` directive in `src/app/globals.css`
- Use CSS custom properties for colors, spacing, etc.
- No JavaScript-based config allowed

Example v4 configuration:

```css
@import "tailwindcss";

@theme {
  --color-primary: oklch(50% 0.2 250);
}

## File Organization

- Components: `src/components/[feature]/ComponentName.tsx`
- Pages: `src/app/[route]/page.tsx`
- Server Actions: `src/actions/[feature].ts`
- Types: `src/types/[feature].ts`
- Lib/Utils: `src/lib/[utility].ts`

## Naming

- Components: PascalCase (`ItemCard.tsx`)
- Files: Match component name or kebab-case
- Functions: camelCase
- Constants: SCREAMING_SNAKE_CASE
- Types/Interfaces: PascalCase (no prefix)

## Styling

- Tailwind CSS for all styling
- Use shadcn/ui components where applicable
- No inline styles
- Dark mode first, light mode as option

## Database

- Use Prisma ORM for all database operations
- Always use `prisma migrate dev` for schema changes (not `db push`)
- Run `prisma migrate status` before committing to verify migrations are in sync
- Production deployments must run `prisma migrate deploy` before the app starts

## Data Fetching

- Server components fetch directly with Prisma
- Client components use Server Actions
- Validate all inputs with Zod

## API Contract

**Every response between FE and BE must use the `ApiBody<T>` shape — no exceptions.**

```ts
// src/types/api.ts — client-safe, import freely
type ApiBody<T = null> = {
  status: ApiStatus   // string status code, never null
  data: T | null      // null on error or when no payload
  message: string | null  // null on success or when no message
}
```

### API Routes

Wrap the handler with `apiRoute()` from `src/lib/api.ts`. This converts the plain `ApiBody` to a `NextResponse` and centralises error handling — no per-route try/catch needed.

```ts
// src/app/api/[route]/route.ts
import { ApiResponse, apiRoute } from '@/lib/api'

export const POST = apiRoute(async (request) => {
  const { email } = await request.json()
  if (!email) return ApiResponse.BAD_REQUEST('Email is required')
  // ...
  return ApiResponse.OK({ result })
})
```

### Server Actions

Return `ApiBody<T>` directly — same builders, plain object (not `NextResponse`).

```ts
// src/actions/[feature].ts
import { ApiResponse } from '@/lib/api'
import type { ApiBody } from '@/types/api'

export async function myAction(
  _prev: ApiBody<MyData | null> | null,
  formData: FormData
): Promise<ApiBody<MyData | null>> {
  if (!valid) return ApiResponse.BAD_REQUEST('Validation failed')
  return ApiResponse.OK({ result })
}
```

### Frontend

Client components use `apiFetch` from `@/lib/api-fetch` — never raw `fetch()`. It handles network/parse errors and always returns `ApiBody<T>`:

```ts
import { apiFetch } from '@/lib/api-fetch'

const data = await apiFetch<MyData>('/api/...', {
  method: 'POST',
  body: { key: value }, // plain object — serialized to JSON automatically
})
if (data.status !== 'ok') {
  toast.error(data.message ?? 'Something went wrong.')
  return
}
// data.data is MyData here
```

### Available Status Codes

| Status | HTTP | Meaning |
| --- | --- | --- |
| `ok` | 200 | Success |
| `created` | 201 | Resource created |
| `bad_request` | 400 | Validation / client error |
| `unauthorized` | 401 | Not authenticated |
| `forbidden` | 403 | Authenticated but not allowed |
| `not_found` | 404 | Resource not found |
| `conflict` | 409 | Duplicate / state conflict |
| `validation_error` | 422 | Schema / input validation |
| `too_many_requests` | 429 | Rate limited |
| `internal_error` | 500 | Server error |

### Rules

- **Never** return raw `NextResponse.json()` or custom response shapes from API routes
- **Never** return plain booleans, strings, or custom state types from Server Actions that communicate status to the FE
- **Never** call `fetch()` directly from client components — always use `apiFetch` from `@/lib/api-fetch`
- **Always** use named interfaces for response data types — no inline generics like `ApiBody<{ email: string }>`
- Server Actions that only redirect (OAuth, sign-out) are exempt

## Error Handling

- API routes: errors are caught by `apiRoute()` — no per-route try/catch needed
- Server Actions: use try/catch and return `ApiResponse.INTERNAL_ERROR()` on unexpected failures
- Display user-friendly error messages via toast

## Code Quality

- No commented-out code unless specified
- No unused imports or variables
- Keep functions under 50 lines when possible
```
