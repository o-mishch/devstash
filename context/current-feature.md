# Current Feature: UI Skins (dashboard + app-wide)

## Status
Phase 1 Complete — dashboard skins + `uiSkin` pref + settings picker shipped. Phase 2 (ambient
shell `data-skin` layer) and Phase 3 (auth/marketing/empty-state polish) remain deferred future scope.

## Summary
Let users pick one of **9 dashboard "skins"** (distinct layouts/visual treatments of the
same `/dashboard` data) from Settings, persisted per user. Mirrors the existing `appTheme`
color-preset mechanism, but a skin swaps the **layout/component tree**, not just CSS color
variables. Default skin is free; the bold/data-rich skins are Pro-gated.

Eight of the skins are prototyped and reviewed in `prototypes/dashboard/` (static HTML/CSS/JS +
`concept-*.png` screenshots + `README.md`), reusing the real app palette
(`themes.generated.css`) and system item-type colors (`constants.ts`). The 9th skin, `classic`,
is the **dashboard exactly as it ships today** — kept as the free default so existing users see
no forced change.

## Skins (kebab-case keys mirror `APP_THEMES`)

| Key | Name | Tier | Structure / extra data |
|-----|------|------|------------------------|
| `classic` | Classic | **Free (default)** | The current dashboard, as-is (stat cards + collections + pinned + recent). No new data. |
| `aurora` | Aurora Bento | **Free** | Glass bento, usage ring, type bars → needs per-type counts |
| `editorial` | Editorial | **Free** | Swiss/typographic, oversized numerals, type bars → per-type counts |
| `spatial` | Spatial Depth | **Pro** | visionOS frosted floating panels (CSS-only over shared layout) |
| `command-deck` | Command Deck | **Pro** | HUD/terminal, segmented type bar → per-type counts |
| `orbital` | Orbital Core | **Pro** | Item-type constellation → per-type counts |
| `mission-control` | Mission Control | **Pro** | Analytics cockpit: heatmap (per-day counts) + donut + sparklines |
| `neon-grid` | Neon Grid | **Pro** | Synthwave neon + grid horizon (CSS-heavy over shared layout) |
| `holographic` | Holographic | **Pro** | Iridescent animated foil borders (`@property` + `conic-gradient`) |

Free/Pro split is a starting proposal — adjustable. Rule: free users always get a clean,
fully-functional dashboard (`classic` default + `aurora` + `editorial`); Pro unlocks the
flashy/data-dense ones.

## Goals
- Add `uiSkin: UiSkin` to `EditorPreferences` (`src/types/editor-preferences.ts`)
  with a `UiSkin` union + `UI_SKINS` list + `UI_SKIN_OPTIONS` (label,
  tier, description) — mirroring `APP_THEMES` / `APP_THEME_OPTIONS`. Default `'classic'` (the
  current dashboard, so existing users are unchanged). Making a modern skin the default instead
  is a product decision — easy to flip the default constant later.
- Persist via the **existing** `editorPreferences` JSON column (`User.editorPreferences`) — **no
  Prisma migration**. Save through the existing `/api/profile/editor-preferences` route and
  Zustand store (`src/stores/editor-preferences.ts`); no new endpoint.
- Settings: add a **UI skin** picker to `editor-preferences-form.tsx` (visual swatch grid,
  same UX as the theme picker). Pro-only skins render a Crown/locked affordance for free users and
  route to the upgrade prompt instead of selecting.
- Read the skin **server-side** in `src/app/(app)/dashboard/page.tsx` (from the user's persisted
  `editorPreferences`, fetched via a `src/lib/db/` helper scoped to the session `userId`) so the
  correct layout renders on first paint — **no flash / no layout shift**, since the skin decides
  the server-rendered component tree. Enforce the Pro gate server-side: a free user whose stored
  skin is Pro-only falls back to the default skin (never trust the client).
- **Remove the section-card expand/collapse persistence** from the dashboard. The `classic` skin
  (and any skin with collapsible section cards) renders sections with a fixed default state (open);
  open/closed is no longer saved or restored. Specifically: drop `dashboardSections` from
  `EditorPreferences`, remove the `ds-layout` cookie collapse read/write in `dashboard/page.tsx`,
  `normalizeDashboardSections` / `DashboardSections`, and the `defaultOpen` / `initialSections`
  plumbing through `DashboardContent` and the collapsible card. (Leave `sidebarCollapsed` — that is
  the sidebar, not the dashboard section cards, and is out of scope for this removal.)
- Extend the dashboard data fetch **once** for the widgets that need it:
  - `getItemTypeDistribution(userId)` — `groupBy: ['itemTypeId']` cached aggregation in
    `src/lib/db/items.ts` (`'use cache'` + `cacheTag` + `cacheLife`), returns per-type counts.
    Consumed by `aurora`, `editorial`, `command-deck`, `orbital`, `mission-control`.
  - `getDashboardActivity(userId)` — per-day item-creation counts for the last ~12 weeks
    (date-bucketed; raw SQL only if `groupBy` can't express it, with the required comment).
    Consumed by `mission-control` only; gate the fetch so it isn't run for other skins.
- Refactor `DashboardContent` into a skin dispatcher: a `DashboardSkinShell` that receives the
  resolved skin + all data promises and renders the matching layout component. Each skin lives in
  its own file under `src/components/dashboard/skins/<skin>.tsx`. Shared pieces (collections card,
  pinned/recent lists, type-distribution viz) stay as reusable components consumed by skins.
- Skins are CSS/structure only — **all data, fetching, caching, and IDOR scoping stay identical**
  across skins. No skin gets its own data path beyond the two shared additions above.

## Ready-made solutions (reduce custom code)
The mockups hand-roll every chart in SVG/CSS. For the real build, lean on libraries where they
earn their keep, and keep CSS-only where a library would just add weight. (Verified via Context7.)

**Stack compatibility — verified against this repo** (Next 16.2.9, React 19.2.7, react-dom 19.2.7,
Tailwind v4, TS 6; `next dev`/`next build` both run **Turbopack** by default in Next 16; React
Compiler is **not** enabled):
- Recharts, react-activity-calendar, and `motion` are plain ESM/React packages with no webpack-only
  loaders → **Turbopack-safe** for dev and build. Magic UI adds **no runtime dep** at all — its
  components are vendored source (copied into `src/components/ui/`) that compile like our own code.
- `cacheComponents: true` (Context7-checked): the page is **not** a `'use cache'` scope — it reads
  the session/prefs at request time, which is **dynamic**. Per Next.js best practice, use
  **extract-and-pass**: read the per-user value (session `userId`, skin) in a *non-cached* component
  (wrapped in `<Suspense>` so the static shell prerenders), then pass it into the `'use cache'` DB
  helpers, which are keyed by `userId` via `cacheTag`. Never read `cookies()`/session inside a plain
  `'use cache'` function (that would cache per-user data globally) — if a cached helper must read
  request data directly, it must be `'use cache: private'`. The skin-dependent layout streams inside
  a Suspense boundary; chart widgets are `'use client'` islands.
- `next.config.ts` maps `*.svg` → `raw-loader` (raw string, not SVGR). The chart libs render **inline
  SVG via JS** (no `.svg` file imports), so there is no clash — but skins must not
  `import X from './x.svg'` as a component; use `lucide-react` / inline JSX (already the repo norm).
- React Compiler off ⇒ **no `'use no memo'` needed** around the chart components.
- shadcn is configured for Tailwind v4 + RSC + lucide (`components.json`: `cssVariables: true`,
  `rsc: true`, `style: base-nova`), so `npx shadcn@latest add chart` slots in cleanly.

- **shadcn `chart` (Recharts v3)** — `npx shadcn@latest add chart` adds `src/components/ui/chart.tsx`
  (already have the `shadcn` CLI + Radix + CVA). **Recharts 3.8.1** declares
  `react: ^16.8 || ^17 || ^18 || ^19` → React 19.2.7 ✅. Themes through the existing CSS-variable
  system via `ChartConfig` (`color: 'var(--…)'` or the fixed `SYSTEM_TYPE_COLORS` hex directly), so
  charts inherit app theming for free. Use it for the genuinely fiddly widgets only:
  - **`mission-control` donut** ("by type") → Recharts `<Pie innerRadius>` instead of a hand-built
    `conic-gradient` + mask.
  - **`mission-control` KPI sparklines** → minimal Recharts `<Line>` / `<Area>`.
  - Chart components are `'use client'`; **lazy-load** them so Recharts ships only when the
    `mission-control` skin actually renders, keeping it off the default/classic path. Context7 note:
    `next/dynamic` with `ssr: false` is **only allowed inside a Client Component** — put the
    `dynamic(() => import(...), { ssr: false })` calls in the `mission-control` `'use client'` island,
    not in the Server Component dispatcher. (Even without `ssr:false`, a client island that imports
    Recharts is already code-split, so it never enters other skins' bundles.)
- **`react-activity-calendar`** (Context7 benchmark 97.5, actively maintained) — the
  `mission-control` contribution heatmap. Takes `data: {date,count,level}[]` (exactly what
  `getDashboardActivity` returns), `theme={{ light, dark }}` set to brand colors, `showTotalCount`/
  `showColorLegend` toggles, `blockSize`. Replaces the custom 12×7 grid. **v3.2.0 declares
  `react: ^18 || ^19` → React 19 ✅**; transitive deps `@floating-ui/react` (tooltips) + `date-fns@4`,
  both ESM/Turbopack-safe. (`'use client'` — render it in the same lazy `mission-control` island.)
- **`motion`** (Framer Motion v12 — *already installed*, `12.40.0`, peer `react: ^18 || ^19` ✅) —
  skin/section enter transitions and micro-interactions (hover lift on Spatial, orbit drift) instead
  of bespoke `@keyframes`. Zero new dependency.
- **Magic UI** (`/magicuidesign/magicui`) — **copy-paste shadcn-registry** components
  (`npx shadcn@latest add @magicui/<name>`); the code lands in our repo and uses only `motion/react`
  (installed `12.40.0`) + `cn` from `@/lib/utils` (present) — **no new runtime dependency**. Replaces
  much of the per-skin hand-rolled CSS:
  | Skin effect (hand-rolled in mockup) | Magic UI component |
  |---|---|
  | `orbital` constellation (custom transform math) | **`OrbitingCircles`** |
  | `neon-grid` perspective grid horizon | **`RetroGrid`** |
  | `holographic` iridescent `@property` foil border | **`BorderBeam`** / **`NeonGradientCard`** / **`ShineBorder`** |
  | `aurora` bento layout | **`BentoGrid`** / **`MagicCard`** (spotlight) |
  | background dot-grid / scanlines (`bg-fx`) | **`DotPattern`** (`glow`) / **`AnimatedGridPattern`** |
  | `command-deck` HUD shell | **`Terminal`** + **`AnimatedGridPattern`** |
  | animated stat counts (every skin) | **`NumberTicker`** |
  **Compatibility:** Magic UI's current registry targets **Tailwind v4 + React 19** and emits
  `'use client'` SVG/`motion` components — Turbopack-safe, same lazy-load story as the charts.
  Integration caveats to handle: (1) a few components ship `@keyframes` (e.g. `shine`) that must be
  added to `globals.css`/`@theme` under Tailwind v4 — we already import `tw-animate-css`, which
  covers several; (2) the `@magicui` namespace may need registering in `components.json`
  `registries`; (3) vendored components use `window`/`document` directly, which trips our
  `coding-standards` lint rule — keep them under a `src/components/ui/` vendored path and
  `eslint-disable` per file (treat as third-party, do not refactor); (4) gate them to the bold/Pro
  skins + `motion-safe` so the free `classic`/`aurora` path stays light and respects reduced-motion.
- **Optional — Aceternity UI** (`/websites/ui_aceternity`) — has a true **Aurora Background** if we
  want a richer `aurora` backdrop than Magic UI's patterns. Heavier/marketing-oriented (some
  components pull `three.js`); pull single components only, do not adopt wholesale.
- **Keep custom (no library earns its place):** the trivial type-distribution bars (plain
  divs/`Progress` beat any lib), the `spatial` frosted-glass depth (pure Tailwind v4
  `backdrop-filter` + shadows), and any final color/token tuning. Use Magic UI for the *animated*
  effects above; keep the static glass/gradient identity in CSS.
- **No new theming/persistence lib** — skin selection + persistence reuse the existing
  `editorPreferences` infrastructure (`next-themes` already covers color-mode). Do not add a
  theme-switcher package.

## App-wide consistency (skin beyond the dashboard)
Decision: the skin should give the **whole app** a coherent identity, not just `/dashboard`. But a
literal "animate every component" reskin is rejected as harmful in a dense productivity app
(perf, a11y, maintenance). Apply the skin as **two layers**:

1. **Token layer (already exists):** the 35 `appTheme` color presets already make every surface
   consistent. Unchanged — this stays the universal mechanism.
2. **Ambient identity layer (new, restrained):** the skin sets a single `data-skin="<skin>"`
   attribute on the app-shell root (same pattern as `.dark` / `data-mode`), and **only ambient,
   low-interaction, "delight" surfaces** read it — so the app *feels* on-theme without animating the
   work. Rename the pref accordingly: **`uiSkin`** (not `dashboardSkin`), since it now spans the app.

**Surfaces that adopt the skin (curated):**
- App-shell background / ambient chrome behind everything (`DotPattern` / `RetroGrid` / aurora glow).
- Sidebar active-item treatment + logo glow (`src/components/layout/sidebar/*`).
- Primary CTA + upgrade prompt — `ShimmerButton`/`ShinyButton` **on bold/Pro skins only**.
- Empty states, loading skeletons, auth (`src/components/auth/*`) and marketing pages.
- Pro / AI affordances (`AnimatedShinyText` for "✦ Optimize" / Crown hints), `NumberTicker` for stats.

**Surfaces that stay static (token-only — do NOT animate):** item cards (`item-card.tsx`,
`image-card.tsx`, virtualized `tanstack-virtual-grid.tsx`), grids, inputs/forms, dialogs, drawers,
settings forms, editors. Per-instance animation here fights virtualization perf and focused work.

**Magic UI catalog mapping (app-UI appropriateness):**
- **Use:** `NumberTicker` (stats), `AnimatedShinyText` (Pro/AI hints), `ShimmerButton`/`ShinyButton`
  (primary CTA, bold skins), plus the background/border FX already listed.
- **Avoid in app chrome:** `PulsatingButton` (per-instance `MutationObserver`+rAF — heavy),
  `AnimatedList` (built for streaming notifications, fights TanStack-Virtual grids), `RainbowButton`
  and sparkle/rotate text (marketing-grade, distracting in a work UI).

**Guardrails:** all motion `motion-safe:` only (honor `prefers-reduced-motion`); ambient animations
pause off-screen; bold animated chrome gated to Pro skins + lazy-loaded; never animate virtualized
list items; server-side Pro enforcement covers the shell, not just the dashboard.

**Scope/phasing:** this materially widens the feature. Phase it — **Phase 1:** dashboard skins +
`uiSkin` pref + settings picker (the current plan). **Phase 2:** ambient shell layer (`data-skin`
background + sidebar accent + CTA). **Phase 3:** auth/marketing/empty-state polish. Ship Phase 1
before committing to 2–3.

## Notes
- **Files to touch:**
  - `src/types/editor-preferences.ts` + a generated/auth source for `UiSkin`
    (follow how `theme-presets.generated.ts` is produced; do not hand-edit generated files).
  - `src/lib/utils/editor-preferences.ts` (+ `.test.ts`) — default + normalize/validate skin,
    like `normalizeDashboardSections`; clamp unknown/invalid skin → default.
  - `src/stores/editor-preferences.ts`, `src/components/settings/editor-preferences-form.tsx`.
  - `src/app/(app)/dashboard/page.tsx` (resolve skin + Pro gate + conditional activity fetch;
    remove `ds-layout` cookie / `initialSections` collapse handling).
  - `src/components/dashboard/dashboard-content.tsx` → skin dispatcher (drop `initialSections` /
    `defaultOpen` props).
  - `src/components/dashboard/skins/*.tsx` (9 layout components; `classic.tsx` = the current
    dashboard markup lifted out of `dashboard-content.tsx`, minus collapse persistence).
  - **Collapse-persistence removal:** `src/components/dashboard/dashboard-collapsible-card.tsx`
    (sections render default-open, no persisted state), `src/lib/utils/editor-preferences.ts`
    (drop `normalizeDashboardSections`), `src/types/editor-preferences.ts` (drop
    `DashboardSections` + the `dashboardSections` field), and the `ds-layout` collapse usage in
    `src/lib/utils/layout-cookie.ts` (keep the cookie only if `sidebarCollapsed` still needs it,
    otherwise prune the dashboard-section parts).
  - `src/lib/db/items.ts` (+ stats type in `src/types/item.ts`): `getItemTypeDistribution`,
    `getDashboardActivity` (shape `{ date, count, level }[]` to feed `react-activity-calendar`).
  - `src/components/ui/chart.tsx` (generated by `npx shadcn@latest add chart`; do not hand-author).
    New deps: `recharts` + `react-activity-calendar`. The `mission-control` skin imports its
    donut/sparkline/heatmap widgets via `next/dynamic` **inside a `'use client'` island** (ssr:false
    is client-only) so Recharts is not in the default bundle.
  - A `src/lib/db/` helper (or extend `loadAppSidebarData`/session prefs) to read the user's
    `editorPreferences` server-side for the skin resolution in `page.tsx`.
  - `src/app/api/profile/editor-preferences/route.ts` schema — add `uiSkin`, drop
    `dashboardSections` from the prefs Zod schema; regenerate OpenAPI types (`npm run openapi:gen`)
    if the prefs schema is part of the contract.
- **Utilities to reuse:** existing `editorPreferences` persistence + no-flash initializer
  (`theme-initializer.tsx`), `getItemStats` / `getCollectionsPreview` / `getRecentItemsPage` /
  `getPinnedItems` promises already kicked off in `page.tsx`, the upgrade-prompt store for the Pro
  gate, `SYSTEM_TYPE_COLORS` / `SYSTEM_TYPE_ICON_NAMES` for type viz.
- **Pro gating:** server-side is authoritative — a stored Pro skin for a non-Pro user renders the
  default. The settings picker shows locked Pro skins but routes to upgrade on click (never selects
  them client-side). Match the existing file/image Pro-gate pattern.
- **Out of scope:** per-collection or per-page skins (global only), animated skin transitions
  beyond the existing theme-transition, light-mode-specific skin art (skins must work in both modes
  via tokens — verify, don't fork), new color themes, mobile-only skins, exporting/sharing skins.
- **Constraints:**
  - DB-persisted as the single source of truth (no localStorage) — ride the existing JSON column.
  - `userId` from session only; type-distribution + activity queries scoped by `userId` (IDOR) and
    cached with `cacheTag`/`cacheLife` like every `src/lib/db/` helper.
  - No flash: skin resolved server-side (from DB `editorPreferences`) at request time and streamed in
    a `<Suspense>` boundary (the static shell prerenders) — the skin chooses the server-rendered
    layout, so there is no client-side swap to flash. (Extract-and-pass, per the `cacheComponents`
    note above; the per-user read is dynamic, not cached globally.)
  - Removing `dashboardSections` is a backward-compatible prefs change: old blobs may still carry
    the field — `normalize`/parse must ignore unknown keys, not error, so existing users load fine.
  - Tailwind v4 only (CSS-based) — mockup techniques (`conic-gradient`, `backdrop-filter`, masks,
    `@property`) port to component styles; no `tailwind.config.*`.
  - Tests: `editor-preferences.test.ts` covers skin default/normalize/Pro-fallback; add DB-helper
    coverage for the new aggregations if the testing rule's scope applies.
  - Each skin must stay responsive + accessible (the mockup proves desktop; real impl must pass the
    `touch`/narrow-viewport rules in `globals.css`).
