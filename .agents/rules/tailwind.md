---
trigger: glob
globs:
  - src/**/*.tsx
  - web/**/*.tsx
  - src/**/*.css
  - web/**/*.css
paths:
  - "src/**/*.tsx"
  - "web/**/*.tsx"
  - "src/**/*.css"
  - "web/**/*.css"
description: Tailwind CSS v4 conventions shared by both frontends (src/ Next.js and web/ Vite SPA) — CSS-based config, no tailwind.config.ts, shadcn/ui usage (Radix-based in src/, Base UI-based in web/). Loads for .tsx/.css files in either workspace.
---

# Tailwind CSS v4

Both frontends use Tailwind CSS v4, which is CSS-based configuration — not the v3 JS-config model.

- **DO NOT** create `tailwind.config.ts` or `tailwind.config.js` files (those are for v3)
- All theme configuration must be done in CSS using the `@theme` directive
- Use CSS custom properties for colors, spacing, etc.
- No JavaScript-based config allowed

```css
@import "tailwindcss";

@theme {
  --color-primary: oklch(50% 0.2 250);
}
```

## Styling

- Tailwind CSS for all styling — no inline styles.
- **Both frontends use shadcn/ui, but on different primitive layers — the layers are not interchangeable.** `src/` (legacy) uses the classic **Radix-based** shadcn — prefer an existing shadcn component over a hand-rolled one. `web/` uses **shadcn/ui on Base UI** (the July-2026 CLI default) with `cva` for variants; its kit lives in `web/src/components/ui`. Add new `web/` components with `shadcn add` (Base UI is the CLI default — no flag needed) rather than hand-rolling, and prefer an existing kit component over a new one. **Never add Radix to `web/`:** React 19 + the React Compiler hit ref-callback bugs in Radix's collection components, so Base UI is `web/`'s deliberate React-19-safe primitive layer — that split is the whole reason for it.
- Dark theme is the design baseline in both frontends; light mode is a secondary target. Do not ship a component that only renders correctly on one.
- All `<button>` and `[role="button"]` elements get `cursor: pointer` via the global base layer — do not add `cursor-pointer` on individual components.
