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

Project rules live in `.agents/rules/` and are auto-discovered by Claude Code through the `.claude/rules → ../.agents/rules` symlink (mirrors `.claude/skills`):

- **Always loaded:** `ai-interaction.md`, `coding-standards.md` (no `paths:` frontmatter).
- **Path-scoped** (load only when you touch matching files, via `paths:` frontmatter): `nextjs-architecture.md`, `database.md`, `security.md`, `testing.md`, `api-contract.md`.

Antigravity reads the same files natively via each file's `trigger`/`globs` frontmatter.

**Windows:** symlinks need Developer Mode or Administrator privileges. Without them git materializes `.claude/rules` as a plain file, the rules don't resolve, and Claude Code loads none of them — enable Developer Mode, or replace the symlink with real file copies in `.claude/rules/`. Mac/Linux need nothing extra.

<!-- Do NOT "fix" the Windows note by adding `@.agents/rules/*.md` imports here. Claude Code `@`-imports don't support globs and load each file IN FULL at launch — on Mac/Linux that double-loads the rules already picked up via the .claude/rules symlink AND forces the path-scoped ones to load every session, defeating the whole design. The only Windows-proof alternative that preserves path-scoping is committing real file copies under .claude/rules/ instead of the symlink. Dual frontmatter is intentional: Antigravity uses `trigger`/`globs`, Claude Code uses the mirrored `paths:` field. -->

<!-- stripe-projects-cli managed:claude-md:start -->
look at AGENTS.md for your rules
<!-- stripe-projects-cli managed:claude-md:end -->
