# UX/UI Improvements Spec

> UX review + recommendations for DevStash's main pages and dialogs. Findings come from a
> **live Playwright walkthrough** of the running app (signed-in, seeded data) at desktop
> (1280px) and mobile (375px), cross-checked against the component source and consolidated
> with **Context7 / shadcn-ui** best practices. No code is changed yet — each fix is scoped
> and gated on the open decisions at the end.

## Status
Research complete — implementation not started

## Method
- Live review with Playwright at 1280px and 375px. Screenshots saved under
  `.playwright-mcp/screenshots/review-*.png` (dashboard, collections, collection detail,
  items, favorites, settings, profile, create dialog, item drawer, search).
- Source cross-check of the components behind each surface.
- Best practices pulled from Context7 `/websites/ui_shadcn` (responsive dialog↔drawer,
  sticky footer, responsive field orientation).

## Severity legend
**P1** = hurts usability / looks unpolished on a primary surface · **P2** = noticeable,
worth fixing · **P3** = minor polish.

---

## Findings summary (prioritized)

| # | Severity | Surface | Problem | Section |
|---|----------|---------|---------|---------|
| 1 | **P1** | Create Item dialog | 500px single column scrolls; on desktop only Type/Title/Language + top of Content fit — Description/Tags/Collections are below the fold, while ~380px on each side sits empty | [§1](#1-create-item-dialog--desktop-redesign) |
| 2 | **P1** | Item cards (grid) | Titles truncate to ~8 chars (`[bulk] Co…`) because pin+star+date share the title row; affects items pages, collection detail, dashboard pinned/recent | [§3](#3-item-card-title-truncation-grid) |
| 3 | **P1** | Dashboard | Four oversized, **non-clickable** stat cards eat the above-the-fold band; "Favorite Collections" label wraps to 2 lines; heavy internal whitespace | [§2](#2-dashboard--rethink-the-stat-cards) |
| 4 | **P2** | Collection card | Favorited star sits in a persistent dark `bg-background/50` pill (visible on hover/mobile) — looks heavy; persistent star+more buttons squeeze the title on mobile | [§4](#4-collection-card--favorite-icon--overflow) |
| 5 | **P2** | Collection detail | Header is sparse — no description, no item count, no type summary; inconsistent with the rich collection cards elsewhere | [§5](#5-collection-detail-header) |
| 6 | **P2** | Items vs Favorites | Favorites uses a clean **list** (full titles, type badges, grouped) while items pages use cramped grid cards — inconsistent and the list is objectively more readable | [§6](#6-gridlist-consistency) |
| 7 | **P3** | Create dialog (mobile) | Centered modal on mobile; shadcn recommends a bottom **Drawer** on small screens for a reachable, native feel | [§1](#1-create-item-dialog--desktop-redesign) |

### Surfaces that are already good (leave alone)
- **Item drawer (read/edit view)** — full title, type + tag badges, syntax-highlighted code
  viewer with minimap, clear action bar (Star/Pin/Copy/Edit/Delete). Strong surface.
- **Settings** — well-structured cards (Billing & Usage, theme picker).
- **Profile** — avatar/identity card + Sign-in Methods rows with Link/Unlink, Usage.
- **Global search dropdown** (`⌘K`) — clean autocomplete with icon + title + description.
- **Sidebar** — type counts + favorite/recent collections; functional and clear.

> Note: the rainbow "Rendering…" pill at bottom-right in screenshots is the **Next.js Dev
> Tools** overlay (dev only) — not a product issue.

---

## 1. Create Item dialog — desktop redesign

`src/components/items/item-create-dialog.tsx` · `src/components/items/item-form-fields.tsx`

### Live confirmation
At 1280×900, opening **New Item** (snippet) shows Type → Title → Language → and only the
**top edge** of the Content editor. Description, Tags, and Collections are entirely below the
fold and require scrolling. Meanwhile the 500px dialog leaves ~380px of empty space on each
side. Worst case (snippet) stacks 7 fields including a 256px code editor.

### Problem
The dialog mixes one **dominant input** (content editor / file dropzone) with several
**short metadata fields** in a single narrow column → guaranteed scroll on desktop, and the
content↔metadata relationship is never visible at once.

### Research (Context7 / shadcn + industry)
- shadcn's **responsive dialog** pattern renders a `Dialog` on desktop and a `Drawer` on
  mobile via `useMediaQuery("(min-width: 768px)")`, sharing one form component. The project
  already ships a Drawer (used by the item view/edit) — reuse it.
- shadcn **sticky footer**: keep `DialogFooter` outside the scroll container (already done).
- shadcn **`Field orientation="responsive"`** auto-switches stacked↔side-by-side — validates
  a responsive two-column metadata layout.
- Single-column-form guidance (Baymard/NN-g) targets **linear** flows (checkout); it does not
  mean a content+metadata editor should be one tall scroll. Linear (issue create), GitHub,
  Notion, Raycast all use a **two-pane** create layout: large input left, metadata rail right.

### Proposed design
Desktop (`sm+`): widen and split into two columns. Mobile: single column (or Drawer, see P3).

- `DialogContent`: `sm:max-w-[860px]` (from 500px).
- **Full-width header row:** **Type** + **Title** side by side (`sm:grid-cols-2`).
- **Two columns below** (`sm:grid-cols-[1.4fr_1fr]`, `gap-6`):
  - **Left = primary input** (fills height): snippet/command → Language + Content; prompt/note
    → Content; link → URL; image/file → File upload.
  - **Right = metadata rail:** Description → Tags → Collections.
- Result: content editor (~256px) and the metadata stack sit **side by side**; combined height
  ≈ `max(left, right)` instead of their sum → fits in `~90dvh` with **no desktop scroll** for
  the common types.

### Edge cases
- **link** (URL only on the left) → keep the grid; the right rail balances it. Optionally let
  the left column narrow for no-content types.
- **image/file** → left = dropzone, right = metadata.
- Footer (Cancel / Create) stays full-width, pinned, outside the scroll area.
- The Edit **drawer** (`variant="drawer"`) already has its own content-dominant layout — out
  of scope. Only `variant="dialog"` changes.

### P3 — mobile Drawer (optional, decision below)
Adopt shadcn's Dialog↔Drawer split so the create form is a bottom sheet on `<768px`. Higher
polish but more refactor; the simple path keeps the current centered modal on mobile.

### Implementation notes
- Layout lives in `item-create-dialog.tsx` (the scroll-area `<div>` grid) and the
  `ItemFormFields` dialog branch; `ItemFormFields` already takes a `variant` prop, so the
  column split can be driven from the dialog and keep the component reusable.
- Verify: `npm run lint` + Playwright over each type (snippet, link, image, note) at desktop
  (no scroll, correct placement) and mobile (single-column/Drawer fallback).

---

## 2. Dashboard — rethink the stat cards

`src/components/dashboard/stats-cards.tsx` · `src/app/(app)/dashboard/page.tsx`

### Live confirmation
The four cards (Total Items, Collections, Favorite Items, Favorite Collections) render ~150px
tall with large empty interiors, are **not clickable**, and push Collections/Pinned/Recent
below the fold. "Favorite Collections" wraps to two lines. On mobile they form a 2×2 grid
(acceptable) but still lead with vanity counts.

### Problem
A knowledge-hub dashboard should optimize **capture** (create), **retrieve** (search/recent/
pinned), **navigate** (collections/types). Four non-interactive counters serve none and burn
the most valuable space.

### Proposed direction (recommended)
**A. Compact + clickable stats.** Collapse the four hero cards into a slim strip (smaller
number + icon + label), each a `Link`: Total Items → `/items`, Collections → `/collections`,
Favorite Items → `/favorites`, Favorite Collections → `/favorites` (collections tab).
Consider **merging the two favorite counts** into one "Favorites" to drop the weakest card.

**B. Add an action/retrieval zone** above the content: prominent Create + Search entry, then
the existing Pinned → Recent → Collections sections move up.

### Alternatives (for the decision)
- **Quick-nav by item type:** replace generic counters with the 7 item types, each showing its
  count and linking to `/items/[type]` — doubles as navigation (the sidebar already proves the
  pattern with type counts).
- **Keep four cards but make them clickable** — smallest change, still large.

### Implementation notes
- `StatsCards` → strip; wrap each in `next/link` (`prefetch={false}` to match dashboard links).
- Verify: `npm run lint` + Playwright (each stat routes correctly; mobile layout).
- No server-action/util change expected → no Vitest additions unless data shape changes.

---

## 3. Item card title truncation (grid)

`src/components/dashboard/item-row.tsx` (and the item grid card used on `/items/[type]`,
collection detail, dashboard pinned/recent)

### Live confirmation
On `/items/snippet` (3-col grid) every title truncates to ~8 chars: `[bulk] Co…`, `[bulk]
Tas…`, `[bulk] JW…`. The title shares its row with a pin icon, a favorite star, and a fixed
`Jun 9` date, which together consume ~half the card width. Same harsh truncation on the
collection detail item (`[bulk] Ch…`).

### Problem
The metadata badges (pin/star/date) compete with the title on a single line, so the **most
important element — the title — loses**. By contrast the item **drawer** and the **favorites
list** both show full titles, proving the data isn't the issue, the layout is.

### Proposed design
- Give the title its own line at full card width (`truncate` or `line-clamp-1`), and move the
  date to the meta row (with type/tags) instead of the title row.
- Keep pin/star as small inline indicators but let the title claim the row first (title
  `min-w-0 flex-1`, badges `shrink-0`), or move star/pin to a hover/`touch` action cluster
  like the collection card.
- Target: a typical title (~24–30 chars) is fully visible in a 3-col card at 1280px.

### Implementation notes
- Adjust the card's title row flex layout; relocate the date. Single component, used in
  multiple grids — fix once, benefits everywhere.
- Verify: `npm run lint` + Playwright screenshot of `/items/snippet` and dashboard recent.

---

## 4. Collection card — favorite icon + overflow

`src/components/dashboard/collection-card.tsx` ·
`src/components/dashboard/collection-card-actions.tsx`

### Live confirmation
The favorite `Button` always carries `bg-background/50 backdrop-blur-sm` (base class), so the
favorited resting state shows a **dark translucent pill** behind the star — subtle on the dark
desktop card but clearly heavy on hover (`bg-background/80`) and on mobile, matching the
original "test angular" screenshot. On mobile the persistent star + more-options buttons
(`touch:opacity-100`) squeeze the title (`Terminal Comman…`).

### Proposed design
- **Favorited resting state = bare star, no pill.** Drop `bg-background/50 backdrop-blur-sm`
  when `isFavorite`; keep the circular translucent background only for hover/focus on the
  not-favorited and more-options buttons.
- Keep size consistent (`size-4` star) and align the favorite + more-options cluster.
- Ensure the description/name padding clears the action cluster (`pr-20` already reserves it)
  so truncation is clean; keep accessible labels and the optimistic toggle unchanged.

### Implementation notes
- Isolated to the favorite `Button` className in `collection-card-actions.tsx`.
- Verify: `npm run lint` + Playwright screenshot of favorited vs unfavorited at desktop+mobile.

---

## 5. Collection detail header

`src/app/(app)/collections/[id]/page.tsx`

### Live confirmation
The detail page shows only `Collections › DevOps` breadcrumb + three icon actions (favorite/
edit/delete). It omits the collection **description**, **item count**, and **type summary** —
all of which the collection *cards* display. The page feels bare, especially with few items.

### Proposed design
- Add a header block: collection name (larger), description, item count, and the type-icon
  row (reuse `ItemTypeIcon`, mirroring the card). Keep the action icons aligned right.
- This makes the detail page consistent with the card and gives context above the item grid.

### Implementation notes
- Header-only change; data (description, count, types) is already loaded for the cards — reuse
  the same `CollectionWithTypes` shape.
- Verify: `npm run lint` + Playwright screenshot.

---

## 6. Grid/list consistency

`src/app/(app)/favorites` (list) vs `src/app/(app)/items/[type]` (grid)

### Live confirmation
Favorites renders a **list**: icon + full title + type badge + date, grouped by type with
section counts (`Snippet 5/10`). It is more scannable and shows titles in full. Items pages use
the **grid** cards that truncate titles (§3).

### Proposed direction
- Short-term: fix §3 so grid titles stop truncating.
- Optional: offer a **grid/list toggle** on items pages and reuse the favorites list layout —
  unifies the two surfaces and gives users the denser, more readable option. Decision below.

---

## Additional findings (second pass)

A focused review of the surfaces skipped in the first pass (public pages, secondary dialogs,
cross-cutting states). Screenshots: `review-homepage.png`,
`review-collection-create-dialog.png`, `review-collection-delete-dialog.png`.

### Confirmed
- **8 · P2 · Marketing homepage** (`src/app/(marketing)`) — strong hero ("Stop Losing Your
  Developer Knowledge" + dual CTA + "Trusted by 600+ developers"), but a full-page capture
  shows **large empty vertical gaps** between hero → features → pricing, and the pricing
  section renders only its header with no visible plan cards. Almost certainly scroll-reveal
  animations sitting at `opacity-0` until scrolled into view. Two risks to fix: (a) content is
  invisible without JS / for `prefers-reduced-motion` / to crawlers — ensure a non-animated
  fallback; (b) the inter-section gaps read as too tall even once animated. Verify by
  scrolling and with JS disabled.
- **Secondary dialogs are good — leave alone.** Create Collection (Name + AI-assisted
  Description, compact single column) and the Delete Collection confirmation (clear
  consequence copy: "items will **not** be deleted…", Cancel + red destructive action) both
  follow solid patterns. *Minor (P3):* the destructive button is low-emphasis (red text on a
  tint rather than a solid fill) — optional to strengthen.

### Not yet reviewed — need a dedicated pass (different session state)
- **9 · Auth pages** (`/sign-in`, `/register`, `/forgot-password`, `/reset-password`,
  `/verify-email`, `/link-account`) — redirect to the app while signed in, so they were not
  reviewed. These are first-impression + conversion surfaces; review **logged out** for layout,
  error/validation states, OAuth button consistency, and mobile.
- **10 · Upgrade page** (`/upgrade`) — redirects to `/settings` for a Pro account. Review with a
  **free** account; it's a key conversion surface (plan comparison, CTA clarity).
- **Profile sub-dialogs** (`change-password`, `change-email`, `delete-account`,
  `main-email-selector`) — opened from the profile rows; not individually inspected. Quick pass
  for field validation, destructive confirmation, and consistency with the create/delete
  dialogs above.

### Cross-cutting opportunities (recommend without further screenshots)
- **Empty states** — only the dashboard's empty state was seen (in code). Ensure friendly,
  actionable empty states for: empty collection detail (the DevOps page is mostly blank with 1
  item), an item type with 0 items, no favorites, and **no search results**. Each should guide
  the next action (create / adjust filter), not just show whitespace.
- **Loading skeletons** — dashboard has them; confirm `/items/[type]`, `/collections`,
  `/favorites`, and the collection detail render matching skeletons to avoid layout shift.
- **Accessibility** — (a) favorite/pin state is conveyed partly by **color**; keep the star
  *shape* (filled vs outline) as the non-color signal and verify `aria-pressed`/labels on the
  toggle; (b) ensure visible `focus-visible` rings on cards, dialog controls, and the drawer;
  (c) confirm contrast of muted text (`text-muted-foreground`) on the dark cards meets WCAG AA;
  (d) the `Jun 9` date is relative-looking but absolute — consider a `title`/`datetime` for
  full date on hover.
- **Responsive (tablet 768px)** — only 1280 and 375 were tested. Verify the item grid's
  3→2→1 column transition and the create dialog at exactly 768px (the shadcn Dialog↔Drawer
  breakpoint).
- **Mutation feedback** — confirm consistent toast placement and error handling across
  create/edit/delete/favorite actions (a `Notifications` region exists in the DOM).

---

## Best practices applied (Context7 `/websites/ui_shadcn`)
- **Responsive Dialog↔Drawer** via `useMediaQuery("(min-width: 768px)")`, one shared form →
  backs §1 desktop dialog + mobile Drawer.
- **Sticky footer** = `DialogFooter` outside the scroll container → already correct; preserve.
- **Scrollable content** = `max-h-[50vh] overflow-y-auto` wrapper → the §1 redesign aims to
  *avoid* needing this on desktop, keep as the mobile fallback.
- **`Field orientation="responsive"`** → validates the responsive two-column metadata layout.

---

## Open decisions (need user input before implementation)
1. **Create dialog** — width `860px` two-column on desktop confirmed? And do we adopt the
   shadcn **Drawer on mobile** (P3), or keep the centered modal?
2. **Dashboard stats** — (A) compact clickable strip + merge favorites, the **quick-nav by
   item type** alternative, or just make the existing four clickable?
3. **Dashboard action zone** — add a Create + Search zone at the top, or keep create in the
   topbar only?
4. **Item cards** — fix the grid title layout only, or also add a **grid/list toggle** reusing
   the favorites list (§6)?
5. **Collection favorite color** — keep `yellow-500`, or align to a brand accent?

## Suggested sequencing
1. **§4 collection favorite** + **§3 card title** — small, isolated, immediate polish across
   many surfaces.
2. **§5 collection detail header** — small, removes an obvious gap.
3. **§1 create dialog** — self-contained, high impact.
4. **§2 dashboard** — largest; do after the direction decision.
5. **§6 grid/list toggle** — optional, last.
