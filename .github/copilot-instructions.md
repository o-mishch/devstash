# DevStash — GitHub Copilot Instructions

Developer knowledge hub: one fast, searchable place for snippets, prompts, commands, notes, files, images, and links.

## Stack

- **Framework**: Next.js 16 / React 19 / TypeScript (strict)
- **Database**: Neon PostgreSQL + Prisma 7 ORM
- **Auth**: NextAuth v5 — email/password + GitHub + Google OAuth
- **Styling**: Tailwind CSS v4 (CSS-based config, no `tailwind.config.ts`) + shadcn/ui
- **Storage**: Cloudflare R2 (file uploads), Upstash Redis (rate limiting + auth tokens)
- **Email**: Resend SDK
- **Tests**: Vitest — server actions + utilities only, no component tests

## Item types (system, immutable)

`snippet` · `prompt` · `command` · `note` · `file` · `image` · `link`
Icons and colors are in `src/lib/utils/constants.ts`. File/Image are Pro-only.

## Route groups

- `/(app)` — protected: `/dashboard`, `/items/[type]`, `/collections/[id]`, `/favorites`, `/profile`, `/settings`
- `/(auth)` — public: `/sign-in`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/link-account`
- `/(marketing)` — public homepage at `/`

## Commands

```bash
npm run dev       # localhost:3000
npm run build     # production build
npm run lint      # ESLint
npm run test:run  # Vitest single run
```

## Neon Database

- Project: `devstash` (ID: `wandering-lab-34213896`)
- **Always use the `dev` branch** for all database operations — never the `production` branch
- Always use `prisma migrate dev` for schema changes — never `prisma db push`

---

## Workflow

For every feature/fix:
1. Document in `context/current-feature.md`
2. Create branch (`feature/[name]` or `fix/[name]`)
3. Implement
4. Verify in browser + run `npm run build && npm run test:run`
5. Commit only after build passes — ask before committing
6. Merge to main, delete branch

## Commits

- Conventional messages: `feat:`, `fix:`, `chore:`, etc.
- Never include AI attribution in commit messages
- One feature/fix per commit

## Code Changes

- Make minimal changes to accomplish the task
- Don't refactor unrelated code unless asked
- Don't add "nice to have" features
- Preserve existing patterns in the codebase

---

## TypeScript

- Strict mode — no `any`, use `unknown`
- Define interfaces for all props, API responses, and data models
- Never use `const enum` — use `as const` objects with string literal unions

## React

- Functional components only
- Always define an explicit named interface for component props — never inline prop types
- No nested ternary operators
- Never use `React.` namespace prefix — import named types/hooks directly
- Avoid `window.` and `document.` — prefer React/Next.js alternatives

## Next.js

- Server components by default; `'use client'` only when needed
- Use Server Actions for form submissions and mutations
- Use API routes for webhooks, file uploads, long-running ops, third-party integrations
- Fetch data directly in server components

## Tailwind CSS v4

- **No `tailwind.config.ts`** — CSS-based config only, using `@theme` directive in `globals.css`
- No inline styles

## File Organisation

- Components: `src/components/[feature]/ComponentName.tsx`
- Pages: `src/app/[route]/page.tsx`
- Server Actions: `src/actions/[feature].ts`
- Types: `src/types/[feature].ts`
- Lib/Utils: `src/lib/[utility].ts`
- DB helpers: `src/lib/db/` — all Prisma calls go here, not in actions directly

## Database

- All Prisma operations in `src/lib/db/`
- Always use `prisma migrate dev` for schema changes

## API Contract

- **REST-native Route Handlers**: Default for all client-driven reads/mutations. Bare Zod schemas validate input; success returns resource JSON directly, and errors return `{ message }` (+ optional `data`) with the appropriate HTTP status code (no envelope).
- **Server Actions**: Return a unified `ActionState<T>` object (`src/types/actions.ts`):
  ```ts
  type ActionState<T = null> = {
    success: boolean
    data?: T | null
    message?: string | null
  }
  ```
- **Frontend Calls**: Use the generated typed client `api` (`openapi-fetch`) or `$api` (`openapi-react-query`) for Route Handlers. Never use `fetch()` directly from client components.

## Security

- Every Prisma query on user data must scope by `userId` from the session — never from user input (IDOR prevention)
- Every server action must verify session: `const session = await auth(); if (!session?.user?.id) return { success: false, message: 'Not authenticated' }`
- Validate all external inputs with Zod
- Generate tokens with `generateSecureToken()` — never `Math.random()`
- Tokens must be single-use; enforce expiry server-side

## Testing

- Vitest only — server actions and utilities; no component tests
- Test files: `src/**/*.test.ts`
- Mock heavy dependencies (`prisma`, `next-auth`, `resend`) with `vi.mock()`
- Every feature with new/changed server actions or utils must ship with tests
