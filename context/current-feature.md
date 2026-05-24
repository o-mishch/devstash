# Current Feature

## Status

Not Started

## Goals

## Notes

---

## History

- **Initial Setup** - Next.js 16, Tailwind CSS v4, TypeScript configured (Completed)
- **Dashboard UI Phase 1** - ShadCN UI init, `/dashboard` route, dark mode, top bar with search + buttons, sidebar/main placeholders (Completed)
- **Dashboard UI Phase 2** - Collapsible sidebar with icon-only mode, item type links, collections with favorites/recent, user area, mobile Sheet drawer, app icon in header (Completed)
- **Dashboard UI Phase 3** - Stats cards, recent collections grid, pinned/recent items list, shared types and constants, SSR layout with client component islands (Completed)
- **Prisma + Neon PostgreSQL Setup** - Prisma 7 ORM with Neon PostgreSQL, full schema with all models and NextAuth tables, initial migration, system item types seeded, test-db script, legacy types replaced with Prisma-generated types (Completed)
- **Seed Data** - Demo user (`demo@devstash.io`), all 7 system item types, and 5 collections with realistic items: React Patterns (3 snippets), AI Workflows (3 prompts), DevOps (1 snippet, 1 command, 2 links), Terminal Commands (4 commands), Design Resources (4 links). Added `bcryptjs` for password hashing (Completed)
- **Dashboard Collections - Live Data** - `src/lib/db/collections.ts` with `getRecentCollections` and `getCurrentUserId` (TODO: replace with NextAuth session), collection cards with dominant-type left border color, type icons, item count from real DB. Items section still uses mock data (Completed)
- **Dashboard Items - Live Data** - `src/lib/db/items.ts` with `getPinnedItems`, `getRecentItems`, `getItemStats`; `getItemIcon` dynamic Lucide resolver from DB icon name; item rows show title, description, type icon, tags, date; Pinned section with Pin icon header hidden when empty; seed updated with pinned items; removed `lib/constants/item-types.ts` (Completed)
- **Stats & Sidebar Live Data** - `getCollectionStats` and `getItemTypeCounts` added; `DashboardLayout` made async to fetch sidebar data (collections + type counts); sidebar item types show live per-type counts; sidebar collections sourced from DB with colored circles for recents; "View all collections" link added; stats cards use real totals; `src/lib/mock-data.ts` deleted (Completed)
- **Pro Badge in Sidebar** - Subtle outline `Badge` (ShadCN UI) with "PRO" label added inline next to the Files and Images item types in the expanded sidebar; `PRO_TYPE_NAMES` set used for clean gating with no DB changes required (Completed)
- **Code Quality & Performance Pass** - Static lucide icon map, leaner `COLLECTION_INCLUDE` select, 5 missing DB indexes via migration, `formatDate`/`clampLimit` helpers in utils, DB query limit validation, dashboard route split into `layout.tsx`/`page.tsx` with `loading.tsx` skeleton and `error.tsx` boundary (Completed)
- **Auth Setup - NextAuth + GitHub Provider** - `next-auth@beta` + `@auth/prisma-adapter` installed with npm overrides for Prisma 7; split config pattern (`auth.config.ts` edge-compatible, `auth.ts` with Prisma adapter + JWT); GitHub OAuth provider; `/dashboard` protected via `src/proxy.ts` (Next.js 16 proxy); `src/types/next-auth.d.ts` extends Session with `user.id`; default NextAuth sign-in page used (Completed)
- **Auth Credentials - Email/Password Provider** - Credentials provider added to NextAuth using split config pattern: edge-safe placeholder in `auth.config.ts`, real bcrypt validation in `auth.ts`; duplicate provider deduped by filtering `authConfig.providers`; `POST /api/auth/register` validates inputs, checks for existing email, hashes with bcryptjs (cost 12), creates user, returns `{ success, user }` (Completed)
- **Auth UI - Sign In, Register & Sign Out** - Custom `/sign-in` page (SSR + client island): email/password form with `useActionState`, discriminated union state (`idle | success | error`), Sign in/Sign up buttons side-by-side, GitHub OAuth at bottom; custom `/register` page: client-side validation, `toast.error` for all errors, `toast.success` before redirect; sidebar user area: real session data, `UserAvatar` (GitHub image or initials), dropdown with Profile + Sign out via `signOutAction`; Sonner toast notifications with `richColors` and `position="top-center"`; `auth.config.ts` explicit `AuthorizedParams` interface; `auth.ts` explicit types for jwt/session callbacks; `confirmPassword` removed from API (Completed)
