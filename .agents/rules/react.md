---
trigger: glob
globs:
  - src/**/*.tsx
  - web/**/*.tsx
paths:
  - "src/**/*.tsx"
  - "web/**/*.tsx"
description: Framework-agnostic React conventions shared by both frontends (src/ Next.js and web/ Vite SPA) — component shape, props typing, and the window/document/createContext restrictions. Loads for any .tsx file in either workspace. Next.js-only React concerns live elsewhere: Server Components and 'use client' in legacy-server-client-boundary.md, Zustand vs TanStack Query ownership in legacy-state-management.md, cache-updater ownership in legacy-coding-standards.md.
---

# React Conventions

These rules apply to any React component regardless of which frontend workspace it lives in. Framework-specific concerns are out of scope here. For `src/`: Server Components and the server/client bundle boundary in `legacy-server-client-boundary.md`, Zustand vs TanStack Query ownership in `legacy-state-management.md`, cache-updater ownership in `legacy-coding-standards.md`. For `web/`: `web-architecture.md`.

- Always define an explicit named interface for component props — never inline prop types.
- No nested ternary operators — extract to a variable, early return, or a small focused component instead.
- Never use the `React.` namespace prefix — import named types/hooks directly (e.g. `MouseEvent`, not `React.MouseEvent`).
- Never use the deprecated `FormEvent` type (deprecated as of `@types/react` 19.2.14) — use `SyntheticEvent<T>`, or the specific `ChangeEvent`/`InputEvent`/`SubmitEvent`.
- Avoid `window.` access — prefer DOM APIs or React patterns. Use `window` only when there is no framework-level alternative and the browser global is genuinely required (e.g. `window.location` for a hard redirect outside React). Add a one-line comment saying why.
- Avoid direct `document.` manipulation — prefer React refs (`useRef`), event handlers, or library abstractions. Use `document.` only when no React alternative exists (e.g. triggering a file download via a temporary anchor). Add a one-line comment saying why.
- **Never use `createContext` / `React.createContext`.** Both frontends push client state into their own store layer (`src/stores/` Zustand in the Next.js app; the equivalent in `web/`) rather than React Context.

```tsx
// ✅ correct
interface SidebarProps {
  onClose?: () => void
}
export function Sidebar({ onClose }: SidebarProps) { ... }

// ❌ wrong
export function Sidebar({ onClose }: { onClose?: () => void }) { ... }
```

```tsx
// ❌ wrong — never create context, in either workspace
const ItemContext = createContext<ItemContextValue | null>(null)
export function ItemProvider({ children }: { children: ReactNode }) {
  return <ItemContext.Provider value={...}>{children}</ItemContext.Provider>
}
```
