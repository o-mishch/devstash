# Feature: Theme system — tweakcn preset library (preset × light/dark)

## Status
Planned — deferred for later implementation. Start by branching `feature/theme-presets` off `main`
and pointing `context/current-feature.md` at this spec (feature-workflow doc step 1).

## Guiding principle
**Eliminate custom code; lean on dependencies, presets, and web standards.** Every decision below
prefers a library feature (next-themes), a published preset (tweakcn), or a CSS standard (`color-mix`,
`@custom-variant`, `color-scheme`) over bespoke logic. New hand-written code is limited to a thin
mechanical codegen step and small UI glue; the cross-device DB sync **reuses the app's existing**
editor-preferences store/endpoint/initializer rather than adding a new persistence path.

## Problem
The app ships **6 hand-rolled dark-only themes** (`vscode/github/jetbrains/vercel/dracula/monokai`) as
`.dark[data-theme="…"]` CSS-variable blocks in `src/app/globals.css`, enumerated in
`src/types/editor-preferences.ts`, and rendered as a 6-card grid in
`src/components/settings/editor-preferences-form.tsx`. Two issues:
1. **Cards lose their borders on real mobile** (`context/mobile/*`) — see *Card border visibility*.
2. The user wants a **maintained theme library** instead of bespoke palettes, with **light + dark**.

## Decisions
1. **Drop the custom 6 entirely.** Replace with a published preset library.
2. **shadcn.io ruled out** — every theme download is paywalled (per-account token → 401), licensing-
   encumbered, and lacks IDE themes (only `vs-code`/`vercel` overlap).
3. **Adopt tweakcn** (`github.com/jnsahaj/tweakcn`, **MIT**). `utils/theme-presets.ts` holds **42
   presets**, each a `{ light, dark }` pair using the **exact shadcn token names we already use**
   (`background`, `card`, `border`, `input`, `ring`, `sidebar-*`, `chart-*`, `radius`) — 1:1 with our
   CSS variables.
4. **next-themes owns all theme state** (verified via Context7). Context7 confirms next-themes is
   **single-axis**: the `value` prop maps a theme name to **one string applied to all attributes** —
   there is *no* per-attribute mapping that could drive an independent mode-class + preset-attribute.
   So the **documented-native** way to express "preset × mode" is a single axis of flattened
   `"<preset>-<mode>"` values (e.g. `catppuccin-dark`) via the `themes` list — not a custom two-axis
   workaround. next-themes handles the **DOM attribute + flash-free SSR (`ThemeScript`)** with **no
   custom DOM writes**. The UI still presents **two controls** (preset picker + Light/Dark toggle); the
   flattening is internal only. Every API used (single `attribute`, custom `themes` names, flash-free
   script) is documented; the only CSS-side piece is a standard Tailwind v4 `@custom-variant` matched
   on the `-dark` suffix.
5. **Theme preference is DB-synced across devices** (hard requirement). The flattened theme value lives
   in `editorPreferences.appTheme` (the existing `Json?` column — no migration), written through the
   existing `/profile/editor-preferences` endpoint + store, and applied client-side by the existing
   thin initializer (`theme-initializer.tsx`) which calls next-themes `setTheme(dbValue)` on load. This
   is the app's **current** mechanism, reused verbatim — next-themes owns the DOM/flash-free layer;
   the DB owns the cross-device source of truth. Same-device reloads are flash-free (next-themes
   `localStorage` mirrors the last value); a fresh device shows the default for one paint, then the
   initializer reconciles to the DB value (the pre-existing behavior).
6. **Visible card borders are a hard requirement**, fixed with the rendering change + a CSS standard
   (no custom color math) — see *Card border visibility*.

## Architecture (single next-themes axis)

### One attribute on `<html>`, library-managed
- `<ThemeProvider attribute="data-theme-preset" themes={ALL_THEME_VALUES} defaultTheme="modern-minimal-dark"
  enableColorScheme={false} disableTransitionOnChange storageKey="theme">` where `ALL_THEME_VALUES` is
  the generated list of **84** `"<preset>-<mode>"` slugs. next-themes sets
  `<html data-theme-preset="catppuccin-dark">` pre-paint (flash-free) and persists to `localStorage`.
- Remove the hardcoded `dark` class and `defaultTheme="vscode"` `data-theme` provider from
  `src/app/layout.tsx`. Keep `suppressHydrationWarning` on `<html>`.
- `enableColorScheme={false}` because theme names aren't `light`/`dark`; native control theming is
  handled in CSS instead — each generated block emits `color-scheme: light|dark` (a web standard, zero
  JS) so scrollbars/inputs match.

### Dark variant keys off the suffix (Tailwind v4 standard)
Replace the existing `@custom-variant dark (&:is(.dark *))` in `globals.css` with the canonical
`:where` form, matched on the `-dark` suffix (Context7 — `:where` keeps zero specificity and matches
the root element itself, not only descendants):
```css
@custom-variant dark (&:where([data-theme-preset$="-dark"], [data-theme-preset$="-dark"] *));
```
The ~50 existing `dark:` utilities (all shadcn state refinements, none load-bearing) then apply on dark
presets and fall back on light — correct.

### Generated CSS — one block per preset/mode
```css
[data-theme-preset="catppuccin-light"] { color-scheme: light; --background: …; --card: …; … }
[data-theme-preset="catppuccin-dark"]  { color-scheme: dark;  --background: …; --card: …; … }
```
Both the tokens and the `dark:` variant key off the same single attribute — no `.dark` class, no
second axis.

### Vendored data + thin codegen
- `src/lib/themes/tweakcn-presets.json` — vendored from tweakcn (TS → JSON), with `LICENSE-tweakcn.md`
  (MIT text + upstream commit/URL) and an attribution header.
- `scripts/generate-themes.ts` (run via `tsx`, mirroring `scripts/generate-openapi.ts`) — a mechanical
  transform (no color math) that emits:
  - `src/app/themes.generated.css` — for each preset, the two blocks above (+ baseline
    `:root{…default…}` for pre-hydration / no-JS). Map preset keys → `--<key>` and add `color-scheme`.
    **Include:** background, foreground, card/popover(+fg), primary/secondary/muted/accent(+fg),
    destructive(+foreground), border, input, ring, chart-1..5, radius, sidebar(+all sidebar-*).
    **Exclude:** `font-*`, `shadow-*`, `tracking-*`, `spacing` (keep Geist + our rem scale).
  - `src/types/theme-presets.generated.ts` — `ALL_THEME_VALUES` (84 slugs for next-themes
    `themes`), `THEME_PRESETS` (the 42 bases: `{ value, label, light:{bg,primary}, dark:{bg,primary} }`
    for the picker swatches), and a `DEFAULT_THEME` constant.
- `package.json` — add `"themes:gen": "tsx scripts/generate-themes.ts"`.

### Card border visibility (two fixes — both standard/minimal, no custom color math)

**Fix 1 — rendering (primary; fixes the mobile-only disappearance).** Borders show in desktop browsers
but vanish on **real mobile**. `card.tsx` (panels) and `item-row.tsx` (rows) draw their edge with
**`ring-1 ring-border`**, and Tailwind's `ring` is an **outset `box-shadow`**. iOS / mobile WebKit
**clips outset box-shadows on elements that combine `border-radius` + `overflow: hidden`** — exactly
`Card` (`overflow-hidden rounded-xl ring-1`) and `ItemRow` (`rounded-xl` inside `.app-row` =
`overflow-hidden`). Stat chips use a real **`border`** (no `overflow-hidden`) — which is why they
stayed faintly visible. **Fix:** `ring-1 ring-border` → real **`border border-border`** on `card.tsx`
+ `item-row.tsx` (a real border is part of the box and immune to overflow clipping). `stat-chip.tsx`
already uses `border`.

**Default = trust the preset's `--border` (use the dependency).** The reported bug is *rendering*
(box-shadow clip), not contrast — borders looked fine in-browser, so each preset's authored `--border`
already has adequate contrast. Best practice is therefore to keep the preset's tokens verbatim and ship
**only Fix 1**. Do **not** override `--border` by default.

**Fix 2 — optional contrast safeguard (only if the real-mobile QA pass finds a specific offender).** If
some preset's `--border` ≈ `--card` is genuinely too faint, fix it with a CSS standard, not custom
color math — override once in the base layer:
```css
@layer base { :root { --border: color-mix(in oklch, var(--card-foreground) 14%, var(--card)); } }
```
This is a last resort because it discards the preset's authored border; prefer leaving presets intact.

**Acceptance criteria:** on every preset, in both light and dark, the Collections panel, Recent Items
panel, item rows, and stat chips show a clearly visible edge — **verified on a real mobile device / iOS
Safari**, not desktop DevTools emulation (which does **not** reproduce the box-shadow-clip bug, so it
cannot prove the fix). Worst cases: any near-black dark preset and the lowest-contrast light preset.

### UI (two controls, thin glue)
`src/components/settings/editor-preferences-form.tsx` — replace the 6-card grid with:
- a **searchable preset combobox** (existing `popover.tsx` + `command.tsx` + `scroll-area.tsx`) listing
  the 42 `THEME_PRESETS` with a mini swatch (bg + primary) for the current mode;
- a **Light/Dark toggle** (existing `tabs.tsx`/`switch.tsx`).
Each change does **both** next-themes `setTheme(value)` (instant DOM) **and** `updatePreference('appTheme',
value)` (DB sync via the existing store/endpoint). Derive base/mode from the active value with a ~3-line
helper: `const base = theme.replace(/-(light|dark)$/, ''); const mode = theme.endsWith('-dark') ? 'dark' : 'light'`.
Preset change → set `` `${value}-${mode}` ``; mode toggle → set `` `${base}-${nextMode}` ``.

`src/components/layout/sidebar/user-dropdown.tsx` — sign-out resets to `setTheme(DEFAULT_THEME)`.

### DB sync (existing mechanism, reused)
- `src/components/shared/theme-initializer.tsx` — **kept**; on `isInitialized`, calls
  `setTheme(store.appTheme)` so the DB value (loaded into the store) is applied across devices. This is
  unchanged from today other than `appTheme` now holding the flattened `"<preset>-<mode>"` value.
- `appTheme` **stays** in `editorPreferencesSchema` (`validators.ts`), `EditorPreferences`
  (`editor-preferences.ts`), the store PATCH body (`stores/editor-preferences.ts`), and
  `schemas/profile.ts` + `openapi/paths.ts`. Only the **validation domain changes**: `z.enum(APP_THEMES)`
  → `z.enum(ALL_THEME_VALUES)` (the 84 generated slugs); default → `DEFAULT_THEME`. No DB migration
  (JSON column). `APP_THEME_OPTIONS`/`APP_THEME_SWATCH_CLASSES` are replaced by the generated
  `THEME_PRESETS`. Monaco editor `theme` (`EDITOR_THEMES`) is untouched.

## Files
- NEW: `src/lib/themes/tweakcn-presets.json` (+ `LICENSE-tweakcn.md`), `scripts/generate-themes.ts`
- GENERATED: `src/app/themes.generated.css`, `src/types/theme-presets.generated.ts`
- `package.json` (themes:gen)
- `src/app/globals.css` (import generated css; `:where` `-dark`-suffix dark variant; delete the 6 theme
  blocks + old `:root`/`.dark` token blocks; optional `color-mix` border only if QA needs it),
  `src/app/layout.tsx` (provider)
- Border fix: `src/components/ui/card.tsx`, `src/components/dashboard/item-row.tsx`
- UI: `src/components/settings/editor-preferences-form.tsx`,
  `src/components/layout/sidebar/user-dropdown.tsx`
- DB-sync (edits, not deletions): `src/types/editor-preferences.ts` (`appTheme` domain →
  `ALL_THEME_VALUES`, drop `APP_THEMES`/`APP_THEME_OPTIONS`/`APP_THEME_SWATCH_CLASSES`),
  `src/lib/utils/validators.ts`, `src/lib/api/schemas/profile.ts`, `src/lib/api/openapi/paths.ts`,
  `src/stores/editor-preferences.ts` (unchanged — still PATCHes `appTheme`),
  `src/components/shared/theme-initializer.tsx` (kept)
- Tests: `src/app/api/profile/profile.test.ts` — `appTheme` fixture uses a flattened slug; validator
  accepts a known slug, rejects an unknown one.

## Verification
- `npm run themes:gen` then `npm run openapi:gen` — generated CSS + types compile.
- `npm run lint` + `npm run test:run`.
- Desktop / Playwright: `/settings` → switch presets + toggle Light/Dark; screenshot `/dashboard` for a
  few → confirm clean light + dark and **no FOUC** on `/sign-in` (next-themes `ThemeScript`).
  `browser_close` when done.
- **Real mobile / iOS Safari (mandatory for the border fix):** open `/dashboard` on a real phone and
  confirm Collections panel, Recent Items panel, item rows, and stat chips all show a visible edge.
- `npm run build` only if the CSS `@import`/generated output raises a build-only concern; else say it
  was skipped.

## Out of scope
- Monaco editor theme list (`EDITOR_THEMES`), the credential-email feature on this branch, any DB
  schema/migration (theme reuses the existing `editorPreferences` JSON column).
