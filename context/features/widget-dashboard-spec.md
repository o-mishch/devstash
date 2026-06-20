# Widget-Based Dashboard — Specification

## Status
Proposed — not started. Supersedes the abandoned "9 preset skins" direction. This spec is written
**only against `main`** (the shipping dashboard); it ignores the in-flight `feature/ui-skins`
working tree and `context/current-feature.md`.

## Goal
Turn `/dashboard` into a **user-arrangeable widget board**: the same cards that ship today
(stats, collections, pinned, recent) become **widgets the user can drag to reposition and resize**,
with the arrangement **persisted per user** (DB, no localStorage). Content, data fetching, caching,
and IDOR scoping are unchanged — only *placement and size* become user-controlled.

Default arrangement reproduces the current dashboard, so existing users see no forced change.

## Non-goals / Out of scope
- Per-collection / per-page boards (dashboard only).
- Widgets that fetch their own data paths beyond the two optional aggregations in
  [§ Optional data widgets](#optional-data-widgets-harvested-from-prototypes).
- The 8 full-page "skin" mockups in `prototypes/dashboard/` as **layouts** (see
  [§ Prototype evaluation](#prototype-evaluation)).
- Animated/decorative chrome as the primary surface (see [§ Magic UI evaluation](#magic-ui-evaluation)).
- Cross-device layout sync beyond the responsive breakpoints RGL already handles.
- Sharing/exporting boards, multiple saved boards per user.

---

## Current state on `main` (what we're widgetizing)

`src/app/(app)/dashboard/page.tsx` (server component):
- Kicks off cached, `userId`-scoped promises: `getItemStats`, `getCollectionsPreview`,
  `getRecentItemsPage`, `getPinnedItems`, `getCollectionStats`. (The `recent` widget swaps
  `getRecentItemsPage` for a capped `getRecentItems` — see [§ recent widget](#recent-widget--drop-virtualization-fetch-only-what-the-widget-shows).)
- Renders an **empty state** when `stats.totalItems === 0`.
- Otherwise renders, top-to-bottom: `<DashboardStats>` (4 stat chips) then `<DashboardContent>`
  (3 stacked collapsible cards: Collections, Pinned, Recent).

Today each section card is a **collapsible** (`dashboard-collapsible-card.tsx`) whose open/closed
state is persisted via the `ds-layout` cookie + `editorPreferences.dashboardSections` +
`stores/dashboard-sections.ts`. **In a widget board this collapse mechanism is replaced** by
add/remove + resize, so that persistence is removed (see [§ Removals](#removals)).

The four widgetizable units:

| Widget key | Source component on `main` | Notes |
|---|---|---|
| `stats` | `dashboard-stats.tsx` → `stats-cards.tsx` | 4 stat chips; server component |
| `collections` | `dashboard-collections-card.tsx` → `collections-grid.tsx` | client |
| `pinned` | `dashboard-pinned-list.tsx` | client; renders `null` when empty |
| `recent` | `dashboard-recent-list.tsx` | client; **simplified to a capped `ItemRow` list** (see below — drops TanStack-Virtual + infinite scroll) |

---

## Library decision (Context7-verified)

**Use `react-grid-layout` (v2 line).** It is the only mature, React-only (no imperative DOM engine)
draggable **and** resizable grid, and its model is declarative React state that maps 1:1 onto our
existing `editorPreferences` JSON persistence.

Context7-confirmed v2 APIs we rely on:
- `useContainerWidth({ measureBeforeMount: true, initialWidth })` — SSR-friendly width measurement,
  avoids the width-0 first-paint flash. **Recommended** width source.
- `dragConfig={{ handle: '.widget-drag-handle', cancel: '.no-drag', bounded: true, threshold: 5 }}`
  — drag only by a widget's header grip; never start a drag from interactive content.
- `isDraggable` / `isResizable` toggles → power an **edit mode** (off by default = inert static board).
- `onLayoutChange(layout, layouts)` → persistence hook.
- `compactType` / `preventCollision` → packing behaviour.

### ⚠️ Version risk — must verify before building (first task)
`npm view react-grid-layout` resolves `latest = 2.2.3`, peer `react >= 16.3.0`. **But** `2.2.3`
still bundles `react-draggable@^4.4.6` + `react-resizable@^3.1.3` — the legacy stack — while the
hook APIs above come from the `master` TypeScript rewrite. Two things are therefore unproven from
metadata alone and **must be confirmed by a spike**:
1. The published tag actually exposes `useContainerWidth` / `dragConfig` / `useGridLayout`
   (if not, pin the exact rewrite release / prerelease that does).
2. It mounts under **React 19.2.7 + Next 16 Turbopack** without a `findDOMNode` crash
   (`findDOMNode` was removed in React 19; `react-draggable@4` only avoids it when RGL passes a
   `nodeRef`).

**Fallback if the spike fails: `gridstack.js`** — unconditionally React-19-safe, mature, with
`grid.save()`/`grid.load()` JSON persistence. It is imperative-DOM (less idiomatic, against our
"avoid direct `document.`" standard, allow per-file `eslint-disable` as third-party), but the
**persistence architecture and widget catalog below are identical** either way. Do not refactor the
app around the library choice; isolate it inside one client island.

Required CSS (import inside the client island, treated as vendor):
`react-grid-layout/css/styles.css` + `react-resizable/css/styles.css`.

---

## Architecture

### Widget model
A widget is `{ key, title, icon, render(data), defaultSize, minSize }`. Keys are stable strings
(`stats`, `collections`, `pinned`, `recent`, …). A central **registry**
(`src/components/dashboard/widget-catalog.tsx`) maps key → metadata + a render function that
receives the already-resolved data (or its promise). The grid never owns data — it positions
children whose content is the existing cards.

### Persistence (no Prisma migration — ride `editorPreferences`)
Layout lives in the existing `User.editorPreferences` JSON column, saved through the existing
`PATCH /api/profile/editor-preferences` route + `stores/editor-preferences.ts`. No new endpoint.

Add to `EditorPreferences` (`src/types/editor-preferences.ts`):

```ts
export interface DashboardWidget {
  i: string            // widget key (registry id)
  x: number; y: number // grid coords
  w: number; h: number // grid span
  hidden?: boolean     // removed-from-board but remembered
}

export type DashboardBreakpoint = 'lg' | 'md' | 'sm'

export interface DashboardLayout {
  // Per-breakpoint placement. Missing breakpoints are derived by RGL from `lg`.
  layouts: Partial<Record<DashboardBreakpoint, DashboardWidget[]>>
}
```

- Replace the `dashboardSections` field with `dashboardLayout: DashboardLayout`.
- Mirror the field into `editorPreferencesSchema` (Zod) in `src/lib/utils/validators.ts`, add
  `normalizeDashboardLayout()` in `src/lib/utils/editor-preferences.ts`, then `npm run openapi:gen`.
- **Backward compatible:** old blobs may carry `dashboardSections` (now unknown) — the existing
  `normalizeEditorPreferences` already ignores unknown keys; a missing/garbage `dashboardLayout`
  normalizes to the default board. Clamp: drop unknown widget keys, clamp coords/spans into bounds,
  fill missing known widgets at the end.

### Server / client boundary & no-flash
The grid is a **`'use client'` island** (`widget-dashboard.tsx`) — RGL needs client width
measurement, so it cannot be a pure server component. Follow the Context7-recommended SSR pattern:

1. `page.tsx` (server) reads `editorPreferences.dashboardLayout` for the session `userId` (extract
   the per-user value at request time, like the existing cookie read it replaces) and passes it as
   `initialLayout`, alongside the same data promises it already creates.
2. The island renders the widgets in a **plain stacked fallback** (current document order, full
   width) for SSR + first paint, so real content paints immediately, then mounts the grid via
   `useContainerWidth({ measureBeforeMount: true, initialWidth: 1200 })` and applies saved
   positions. The one-frame settle on hydrate is the accepted trade-off of a width-measured grid;
   document it. (`stats`/`collections`/`pinned`/`recent` keep their existing `<Suspense>` streaming
   inside their widget shells.)
3. `userId` from session only; widgets reuse the already-`userId`-scoped, `cacheTag`-keyed promises.
   No new data path, no IDOR surface.

### Edit mode (Zustand, not Context)
A new `stores/dashboard-layout.ts` holds `{ isEditing, toggleEditing }` (UI state → Zustand per
our rules; never `createContext`). Default `isEditing = false`:
- **View mode:** `isDraggable={false} isResizable={false}` — the board is visually identical to the
  current dashboard, zero drag overhead.
- **Edit mode:** drag (header grip only via `dragConfig.handle`) + resize handles on; an
  "Add widget" menu re-adds `hidden` widgets; per-widget remove (×) sets `hidden`. `onLayoutChange`
  persists through the editor-preferences store, **debounced** (~500 ms) so a drag isn't a PATCH
  storm. Toast on save failure (the store already rolls back + toasts).
- A "Reset layout" action writes the default board.

Cache-updater rule: any persistence call lives in the store/hook, never `useQueryClient()` in the
widget components.

---

## Widget catalog (Phase 1 — existing content only)

Each is a thin shell: a drag-grip header + the **unmodified** existing card as the body.

| Widget | Body (reused as-is) | Default `w×h` (12-col) | Empty behaviour |
|---|---|---|---|
| `stats` | `StatsCards` | 12×2 | always shown |
| `collections` | `CollectionsGrid` (in a card) | 12×4 | shown; lib empty state inside |
| `pinned` | `DashboardPinnedList` | 6×4 | auto-`hidden` when no pinned items |
| `recent` | `DashboardRecentList` (capped list) | 6×6 | auto-`hidden` when no recent items |

The empty-board state (`stats.totalItems === 0`) stays exactly as on `main` — the grid only renders
when there is content.

### `recent` widget — drop virtualization, fetch only what the widget shows
The `recent` widget is a **fixed, capped list** — not an infinitely-scrolling virtualized feed:
- **Delete** the `useInfiniteItems` + `TanStackVirtualGrid` (+ `singleColumn`) path from
  `dashboard-recent-list.tsx`. It renders a plain `items.map(<ItemRow>)`, exactly like
  `DashboardPinnedList`. No cursor, no `onLoadMore`, no virtualizer (so no `'use no memo'`).
- **Limit the fetch to the widget's capacity.** Replace the paginated `getRecentItemsPage(userId)`
  with a capped helper in `src/lib/db/items.ts` mirroring `getPinnedItems`:
  `getRecentItems(userId, limit = RECENT_LIMIT): Promise<LightItem[]>` (`'use cache'` +
  `cacheTag(itemGroup(userId))` + `cacheLife('max')`). `RECENT_LIMIT` is a small constant sized to
  fill the default widget height (~6–8 rows). `page.tsx` passes the capped array, not an `ItemsPage`.
- Net effect: one bounded query, no client pagination state, no virtualization — the widget fetches
  *only* the rows it displays. "View all" routes to the full items page for the rest.

---

## Magic UI evaluation

The working tree vendored several Magic UI components (`border-beam`, `orbiting-circles`,
`retro-grid`, `dot-pattern`, `animated-grid-pattern`, `number-ticker`, plus shadcn `chart`). Honest
assessment **for a rearrangeable productivity board** (most belonged to the rejected skin concept):

| Component | Verdict | Why |
|---|---|---|
| `NumberTicker` | **Use (optional, `motion-safe`)** | Subtle count-up for stat values in the `stats` widget. Real polish, cheap, reduced-motion aware. |
| shadcn `chart` (Recharts) | **Use only for optional data widgets** | Needed for a type donut / sparkline if we ship [§ optional data widgets](#optional-data-widgets-harvested-from-prototypes). Lazy-load (`next/dynamic`, `ssr:false`) inside a client widget so Recharts stays off the default bundle. |
| `DotPattern` / `AnimatedGridPattern` | **Avoid (optional ambient only)** | Background texture adds noise to a dense, editable board. At most a faint static backdrop behind the grid in view mode; not worth the weight. |
| `BorderBeam`, `OrbitingCircles`, `RetroGrid` | **Drop from this feature** | Pure decorative skin effects (constellation, neon horizon, foil borders). Not widget content; they fight readability and drag affordances. They belonged to the 9-skins concept this spec replaces. |

**Conclusion:** Magic UI contributes essentially **`NumberTicker`** (stat polish) and the
**shadcn `chart`** (only if data widgets ship). The heavy decorative components are not adopted.
Delete the unused vendored ones rather than carry dead, lint-suppressed third-party files.

## Prototype evaluation

`prototypes/dashboard/` holds 8 full-page mockups (Aurora, Command Deck, Orbital, Spatial, Mission
Control, Neon, Editorial, Holographic). **Do not adopt any as a layout** — a widget board makes
fixed full-page skins redundant. They are still useful as a source of **individual widget ideas**:

| Prototype | Harvest as a widget? | Decision |
|---|---|---|
| Mission Control | type **donut**, **activity heatmap**, **sparkline KPIs** | **Yes — strongest source.** Becomes optional data widgets (Phase 2). |
| Aurora | usage **ring** + **per-type bars** | **Yes (partial)** — a "Type distribution" widget (bars first; ring optional). |
| Editorial | oversized numerals | **No new widget** — covered by `NumberTicker` in `stats`. |
| Orbital / Spatial / Neon / Holographic | constellation, frosted depth, neon horizon, foil | **Drop** — aesthetic full-page treatments, not widgets. |

### Optional data widgets (harvested from prototypes)
Phase 2 only, each `hidden` by default and individually addable:

| Widget | Needs | DB helper to add (`src/lib/db/items.ts`, `'use cache'` + `cacheTag(userId)` + `cacheLife`) |
|---|---|---|
| `type-distribution` | per-type counts | `getItemTypeDistribution(userId)` — `groupBy: ['itemTypeId']` |
| `activity` | per-day creation counts (~12wk) | `getDashboardActivity(userId)` → `{date,count,level}[]` (feeds `react-activity-calendar`) |

Gate these fetches so they only run when the widget is on the board (don't fetch for everyone). Use
`SYSTEM_TYPE_COLORS` / `SYSTEM_TYPE_ICON_NAMES` for the viz. Keep the simple bars as plain
divs/`Progress` (no chart lib); use Recharts only for the donut/sparkline.

---

## Files

**Create**
- `src/components/dashboard/widget-dashboard.tsx` — `'use client'` grid island (RGL + `useContainerWidth` + edit mode + debounced persist + CSS imports).
- `src/components/dashboard/widget-catalog.tsx` — registry: key → `{ title, icon, defaultSize, minSize, render }`.
- `src/components/dashboard/widgets/widget-shell.tsx` — drag-grip header + remove (×) + body slot.
- `src/stores/dashboard-layout.ts` — Zustand `{ isEditing, toggleEditing }`.

**Modify**
- `src/app/(app)/dashboard/page.tsx` — read `dashboardLayout`; pass `initialLayout` + existing promises to the island; swap `getRecentItemsPage` → capped `getRecentItems`; drop the `ds-layout` cookie read + `normalizeDashboardSections`.
- `src/lib/db/items.ts` — add `getRecentItems(userId, limit = RECENT_LIMIT): Promise<LightItem[]>` (capped, cached) mirroring `getPinnedItems`; `getRecentItemsPage` stays for the full items page.
- `src/components/dashboard/dashboard-recent-list.tsx` — drop `useInfiniteItems` + `TanStackVirtualGrid` (+ `singleColumn`); render a plain `ItemRow` map like `DashboardPinnedList`.
- `src/components/dashboard/dashboard-content.tsx` — repurpose as the widget mount (or delete in favour of the island).
- `src/types/editor-preferences.ts` — add `DashboardWidget`/`DashboardLayout`; remove `DashboardSections` + `dashboardSections`.
- `src/lib/utils/editor-preferences.ts` — add default board + `normalizeDashboardLayout`; remove `normalizeDashboardSections`.
- `src/lib/utils/validators.ts` — swap `dashboardSectionsSchema` → `dashboardLayoutSchema` in `editorPreferencesSchema`; then `npm run openapi:gen`.
- `src/stores/editor-preferences.ts` — field swap in the explicit `EditorPreferences` extraction.

**Remove** <a id="removals"></a>
- `src/stores/dashboard-sections.ts` (collapse store).
- Collapse persistence in `dashboard-collapsible-card.tsx` — widgets don't collapse; either delete the card or strip it to a static header+body shell.
- `dashboardSections` plumbing (`defaultOpen`/`initialSections`) through `page.tsx` + `dashboard-content.tsx`.
- The dashboard-section parts of `ds-layout` (`src/lib/utils/layout-cookie.ts`) — **keep the `sidebar` mirror**, it is out of scope.
- Unused vendored Magic UI components (border-beam, orbiting-circles, retro-grid) if not used.

---

## Testing
Per the testing rule (utilities + server actions only, Vitest, no component tests):
- `editor-preferences.test.ts` — `normalizeDashboardLayout`: default board, unknown-key drop,
  coord/span clamping, missing-widget backfill, ignores legacy `dashboardSections`.
- If Phase 2 ships: DB-helper tests for `getItemTypeDistribution` / `getDashboardActivity`
  (`userId` scoping, shape).
- Lint + focused tests; no `npm run build` unless the spike touches bundling/config.

## Edge cases
- Legacy prefs blob with `dashboardSections` → normalizes to default board, no error.
- Widget whose data is empty (`pinned`/`recent`) → auto-`hidden`, addable later.
- Narrow viewport → RGL `sm` breakpoint; verify drag/resize work on touch (or lock editing to
  ≥`md` and keep a single-column read-only stack on mobile).
- Reduced motion → `NumberTicker` and any ambient effect behind `motion-safe:`.
- Save failure mid-drag → store rollback + toast (existing behaviour).

## Phasing
- **Phase 0 — spike (blocking):** install `react-grid-layout`, confirm v2 hook API + React 19 /
  Turbopack mount with one draggable/resizable card. Decide RGL vs gridstack. ~½ day.
- **Phase 1:** the 4 existing widgets, edit mode, persistence, removals, `NumberTicker` polish.
- **Phase 2 (optional):** harvested data widgets (`type-distribution`, `activity`) + the two DB
  aggregations + lazy Recharts/`react-activity-calendar`.

## Open questions
1. **Single board vs per-breakpoint layouts** — persist only `lg` and let RGL derive smaller, or
   store `lg`/`md`/`sm` explicitly? (Default recommendation: store `lg`, derive the rest; revisit if
   users want distinct mobile arrangements.)
2. **Mobile editing** — allow drag/resize on touch, or lock editing to ≥`md` with a read-only
   single-column stack on phones?
3. **Is any Pro gating wanted** for the optional data widgets, or are all widgets free?
