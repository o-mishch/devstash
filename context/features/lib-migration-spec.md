# Library Migration Spec

Replace three sets of project-custom hook implementations with well-maintained, purpose-built libraries.

## Libraries

| Library | Replaces |
|---|---|
| `nuqs` | `use-item-url-param-sync.ts`, `parse-draft-card.tsx` URL sync |
| `react-intersection-observer` | `use-intersection-observer.ts` |
| `ahooks` (`useEventListener`) | bare `addEventListener`/`removeEventListener` in component `useEffect` blocks |

---

## 1. nuqs — URL Search Param State

**Why:** nuqs is the de-facto standard for type-safe URL search params in Next.js App Router. It handles the push/replace/shallow logic, Suspense boundary requirement, and SSR hydration that the custom hook handles manually with `useRef`/`useEffect` guards.

**Install:** `npm install nuqs`

### Replaces: `src/hooks/use-item-url-param-sync.ts`

The hook tracks `prevOpen`/`prevId` refs and imperatively pushes/replaces the `?item=` param. Replace with a `useQueryState` call directly in the `ItemDrawerUrlSync` component in `src/providers/item-drawer-provider.tsx`.

**Migration:**
- Delete `src/hooks/use-item-url-param-sync.ts`
- In `item-drawer-provider.tsx`: replace `useItemUrlParamSync(isOpen, selectedItemId ?? '')` with `useQueryState('item', { history: 'push', scroll: false, shallow: true })`; drive open/close from the nuqs state instead of tracking refs
- In `src/components/parse/parse-draft-card.tsx`: same pattern — replace the `useItemUrlParamSync` call with `useQueryState`
- Wrap the provider's `ItemDrawerUrlSync` component in `<NuqsAdapter>` (must be added once at the app root in `src/app/layout.tsx` or the `(app)` layout)

### nuqs API

```typescript
import { useQueryState } from 'nuqs'
// push history entry, no scroll-to-top, shallow (no server re-render):
const [itemId, setItemId] = useQueryState('item', { history: 'push', scroll: false, shallow: true })
// clear param:
setItemId(null)
```

---

## 2. react-intersection-observer — Viewport Visibility

**Why:** A thin, well-typed wrapper around the native `IntersectionObserver` API. Eliminates the manual callback-ref pattern and `triggerOnce` / disconnect bookkeeping in the custom hook.

**Install:** `npm install react-intersection-observer`

### Replaces: `src/hooks/use-intersection-observer.ts`

**Migration:**
- Delete `src/hooks/use-intersection-observer.ts`
- Update callers to use `useInView` directly:

**`src/components/favorites/favorite-items-list.tsx`**
```typescript
// before
import { useIntersectionObserver } from '@/hooks/use-intersection-observer'
const { ref: sentinelRef, inView } = useIntersectionObserver({ rootMargin: '200px' })

// after
import { useInView } from 'react-intersection-observer'
const { ref: sentinelRef, inView } = useInView({ rootMargin: '200px' })
```

**`src/components/marketing/fade-in.tsx`**
```typescript
// before
import { useIntersectionObserver } from '@/hooks/use-intersection-observer'
const { ref, inView } = useIntersectionObserver({ threshold: 0.1, rootMargin: '0px 0px -40px 0px', triggerOnce: true })

// after
import { useInView } from 'react-intersection-observer'
const { ref, inView } = useInView({ threshold: 0.1, rootMargin: '0px 0px -40px 0px', triggerOnce: true })
```

---

## 3. ahooks — `useEventListener`

**Why:** Replaces manually-managed `addEventListener`/`removeEventListener` pairs in `useEffect` blocks. Handles cleanup automatically, supports `window`, `document`, `Element`, and `RefObject<Element>` as the target, and passes through `capture`, `passive`, `once` options.

**Install:** `npm install ahooks`

### Signature

```typescript
import { useEventListener } from 'ahooks'
useEventListener(eventName, handler, { target?, capture?, passive?, once? })
// target defaults to window
```

### Does NOT apply to

- `use-is-touch.ts`, `use-media-query.ts` — matchMedia listeners, keep as-is
- `use-visual-viewport.ts` — uses `useSyncExternalStore`, keep as-is
- `use-brain-dump.ts` — EventSource (SSE), not a DOM listener
- `src/components/ui/bottom-sheet.tsx` resizable pointer-capture block — already clean PointerEvent handling

### Candidates

| File | Events |
|---|---|
| `src/components/ui/bottom-sheet.tsx` | `document` · `focusin` |
| `src/components/ui/dot-pattern.tsx` | `window` · `resize` |
| `src/components/ui/editor-chrome.tsx` | `document` · `keydown` (capture) |
| `src/components/shared/global-search.tsx` | `document` · `keydown`, `mousedown` |
| `src/components/dashboard/total-items-reveal.tsx` | `document` · `keydown`; `window` · `resize`, `scroll` (capture) |
| `src/components/dashboard/total-items-fanout.tsx` | `window` · `resize`; `document` · `keydown` |
| `src/components/items/drawer/item-drawer-edit-content.tsx` | `document` · `focusin` |
| `src/components/marketing/chaos-canvas.tsx` | canvas · 5 mouse/touch events |

### Pattern

```typescript
// before
useEffect(() => {
  function handler(e: KeyboardEvent) { ... }
  document.addEventListener('keydown', handler, true)
  return () => document.removeEventListener('keydown', handler, true)
}, [dep])

// after
useEventListener('keydown', handler, { target: document, capture: true })
```

Note: the handler must be ref-stable (defined outside the `useEventListener` call or wrapped in `useCallback`) if it closes over state that changes — ahooks re-subscribes when the handler reference changes.

---

## Verification

After all replacements:
```
npm run lint
npm run test:run
```
