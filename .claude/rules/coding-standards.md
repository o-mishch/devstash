---
description: TypeScript, React, Next.js, Tailwind v4, database, and code quality standards for DevStash. Loaded at every session start. API contract rules load when editing api/actions files; testing rules load when editing test files.
---

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
- No nested ternary operators — extract to a variable, early return, or a small focused component instead
- Never use `React.` namespace prefix — import named types/hooks directly (e.g. `MouseEvent` not `React.MouseEvent`)
- Avoid `window.` access — prefer DOM APIs, Next.js router, or React patterns. Only use `window` when there is no framework-level alternative and the browser global is genuinely required (e.g. `window.location` for hard redirects outside React). Always justify the usage in a comment if it is not self-evident.
- Avoid direct `document.` manipulation — prefer React refs (`useRef`), event handlers, or library abstractions. Only use `document.` when no React or Next.js alternative exists (e.g. programmatically triggering a file download via a temporary anchor). Always justify the usage in a comment if it is not self-evident.

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
```

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
- All `<button>` and `[role="button"]` elements get `cursor: pointer` via the global base layer — do not add `cursor-pointer` on individual components

## Database

- Use Prisma ORM for all database operations
- All Prisma operations (`prisma.*`) must be placed in `src/lib/db/` to maintain SOLID principles (separation of concerns). Server Actions and Services should import from `src/lib/db/` rather than calling Prisma directly.
- Always use `prisma migrate dev` for schema changes (not `db push`)
- Run `prisma migrate status` before committing to verify migrations are in sync
- Production deployments must run `prisma migrate deploy` before the app starts

## Data Fetching

- Server components fetch directly with Prisma
- Client components use Server Actions
- Validate all inputs with Zod

## Code Quality

- No commented-out code unless specified
- No unused imports or variables
- Keep functions under 50 lines when possible
- Avoid over-decomposition: do not extract a function, component, or file that is only used in one place and adds indirection without benefit. A single-use 3-line helper, a pass-through wrapper component, or a one-export file whose only caller is adjacent are signs of over-decomposition. Inline it instead.
