# DevStash

Developer knowledge hub — one fast, searchable place for snippets, prompts, commands, notes, files, images, and links.

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
- **Always use the `dev` branch** (ID: `br-dry-scene-al1ir5ie`) for all Neon MCP operations
- **Never touch the `production` branch** (`br-royal-poetry-ale2q4pb`) unless explicitly told to

## Current feature

@context/current-feature.md

## Rules

@.agents/rules/ai-interaction.md
@.agents/rules/coding-standards.md
@.agents/rules/security.md
@.agents/rules/testing.md
@.agents/rules/api-contract.md

<!-- stripe-projects-cli managed:claude-md:start -->
look at AGENTS.md for your rules
<!-- stripe-projects-cli managed:claude-md:end -->
