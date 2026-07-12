# DevStash — Agent Instructions

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

- Project: `devstash` (ID: `<NEON_PROJECT_ID>`)
- **Always use the `dev` branch** (ID: `<NEON_DEV_BRANCH_ID>`) for all database operations
- **Never touch the `production` branch** (`<NEON_PROD_BRANCH_ID>`) unless explicitly told to
- Always use `prisma migrate dev` for schema changes — never `prisma db push`

## Current feature

See `context/current-feature.md`.

## Rules

Read the following files for detailed rules before making any changes. Each carries YAML frontmatter (`trigger: always_on | glob` + `globs:`) that Antigravity uses for activation; Claude Code loads them in full via the `@`-imports in `CLAUDE.md`.

- `.agents/rules/ai-interaction.md` — workflow, branching, commits, verification, builds (always on)
- `.agents/rules/coding-standards.md` — TypeScript, React, Tailwind v4, naming, errors, logging (always on)
- `.agents/rules/nextjs-architecture.md` — where each mutation/fetch goes, server/client boundary, file organisation, Zod validation (glob: `src/**`)
- `.agents/rules/database.md` — Prisma-only data access, `'use cache'` pattern, migrations (glob: `src/lib/db/**`, `prisma/**`)
- `.agents/rules/security.md` — IDOR prevention, auth patterns, input validation, token handling (glob: API/actions/auth/db)
- `.agents/rules/testing.md` — Vitest conventions, what to test, mocking patterns (glob: test files)
- `.agents/rules/api-contract.md` — client↔server OpenAPI 3.1 contract, route wrappers (`authedRoute`/`publicRoute`), openapi-fetch client (`api`/`$api`), and Server Actions (`ActionState`) (glob: API/actions/`src/lib/api`)
- `.agents/rules/go-coding-standards.md` — Go iteration style: use Go 1.23+ iterators (`iter.Seq`/`iter.Seq2`, `slices`, `maps`) and channels instead of classic `for` loops (glob: `backend/**/*.go`)

<!-- stripe-projects-cli managed:agents-md:start -->
## Stripe Projects CLI

This repository is initialized for the Stripe project "devstash".

## Tools used

- [Stripe CLI](https://docs.stripe.com/stripe-cli) with the `projects` plugin to manage third-party services, credentials, and deployments for this project. Use the stripe-projects-cli to manage deploying and access to third party services.
<!-- stripe-projects-cli managed:agents-md:end -->
