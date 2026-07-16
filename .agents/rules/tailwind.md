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
description: Tailwind CSS v4 conventions shared by both frontends (src/ Next.js and web/ Vite SPA) — CSS-based config, no tailwind.config.ts, shadcn/ui usage. Loads for .tsx/.css files in either workspace.
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
- **Component kit is per-workspace, and they are not interchangeable:** `src/` uses shadcn/ui — prefer an existing shadcn component over a hand-rolled one. `web/` has **no shadcn** and is not getting it; it ships its own kit in `web/src/components/ui`. Never add shadcn, Radix, or `cva` to `web/`.
- Dark theme is the design baseline in both frontends; light mode is a secondary target. Do not ship a component that only renders correctly on one.
- All `<button>` and `[role="button"]` elements get `cursor: pointer` via the global base layer — do not add `cursor-pointer` on individual components.
