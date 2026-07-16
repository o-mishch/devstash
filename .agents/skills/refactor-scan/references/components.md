### `src/components/` — React Components

Look for:
- **Repeated JSX patterns**: Similar card layouts, list rows, header sections, or empty states
- **Repeated state + handler logic**: Multiple components with the same useState + onChange + submit pattern
- **Repeated conditional rendering**: Same loading/error/empty state patterns
- **Repeated dialog/modal patterns**: Similar dialog structures with title/content/actions
- **Repeated icon + label combos**: Same icon mapping or icon-with-text patterns
- **Repeated className strings**: Long Tailwind class strings that appear in multiple places
- **Repeated prop drilling**: Same props passed through multiple layers — use a Zustand store in `src/stores/` (never React Context)
- **Server-side code in client components**: Any `'use client'` file importing Prisma, `next/headers`, or `server-only` is a P1 violation

Suggest: Shared UI components, compound components, render-prop utilities, Zustand stores (`src/stores/`), className utility constants.
