---
trigger: glob
globs: ["backend/**/*.go"]
paths:
  - "backend/**/*.go"
description: How to write loops in the Go backend — the slices/maps-helper → value-only-range → classic-for priority ladder, with the concrete cases where a classic loop is allowed. Loads when editing any Go file under backend/. Split out of go-coding-standards.md to stay under Antigravity's 12k per-file cap; architecture, validation, logging, IDOR, data access, and testing live there.
---

# Go Iteration Style

Applies to `backend/**/*.go`. Not `backend/exercise/` — see `go-coding-standards.md`.

**Choose the iteration form by this priority ladder.** Reach for the lowest-numbered option that fits the task; only drop to the next tier when the current one genuinely doesn't apply. Go 1.23+ has first-class iterator support via `iter.Seq` / `iter.Seq2`, the `slices`/`maps` algorithm helpers, and the `slices.Values` / `maps.Keys` / `maps.Values` range-over-func adapters — this ladder is built on them.

1. **`slices` / `maps` algorithm helper — first choice.** If the operation is filter, sort, search, contains, min/max, dedup, reverse, equal, clone, etc., use the stdlib helper. This is the most idiomatic form: no explicit loop at all, intent stated declaratively.
2. **Modern Go 1.23+ value-only range — when no helper fits.** For arbitrary per-element work (side effects, calling `yield`, accumulation) there is no stdlib helper, so walk the collection with a **single-variable value range**: `for x := range slices.Values(s)`, `maps.Values(m)`, `maps.Keys(m)`, `maps.All(m)`, or a custom `iter.Seq`. No index counters, no `_`-discarded keys, no `k, v` two-variable range over a plain slice/map.
3. **Classic `for` — last resort only.** Allowed **only** when neither tier 1 nor tier 2 applies *and* the classic form genuinely reads clearer than an iterator. See [When a classic loop is allowed](#when-a-classic-loop-is-allowed) for the concrete cases; each such loop must carry a one-line comment saying why.

### ❌ Do NOT reach for a classic loop when tier 1 or 2 fits

These are the common mistakes — a helper or a value range exists, so the classic form is wrong here:

```go
// ❌ index counter where a value range (or slices helper) fits
for i := 0; i < len(items); i++ {
    process(items[i])
}

// ❌ keyed range over a slice when you only use the value — use slices.Values
for _, item := range items {
    process(item)
}

// ❌ two-variable range over a map when a value/key range fits — use maps.Values / maps.Keys
for k, v := range myMap {
    use(k, v)
}
```

### ✅ Tier 1 & 2 — helpers, then value-only range (Go 1.23+)

Reach for a `slices`/`maps` helper first; drop to a value range only when you need per-element work no helper expresses.

```go
import (
    "iter"
    "maps"
    "slices"
)

// Prefer an algorithm helper — no explicit loop at all
filtered := slices.DeleteFunc(items, func(item Item) bool {
    return item.Archived
})

// Value-only range over a slice — the default for walking a slice
for item := range slices.Values(items) {
    process(item)
}

// Value-only range over a custom iterator (range-over-func, Go 1.23)
for item := range someIterator() {
    process(item)
}

// Map VALUES only
for v := range maps.Values(myMap) {
    use(v)
}

// Map KEYS only
for k := range maps.Keys(myMap) {
    use(k)
}

// Both key and value — go through maps.All, never a bare `range myMap`
for k, v := range maps.All(myMap) {
    use(k, v)
}

// Integer counts — value-only range over an int (Go 1.22+), never `for i := 0; ...`
for i := range n {
    use(i)
}

// Sorted map keys
for k := range slices.Sorted(maps.Keys(myMap)) {
    use(k)
}
```

Define iterators with `iter.Seq[V]` or `iter.Seq2[K, V]`:

```go
// ✅ Define a domain iterator (the value range inside stays value-only)
func ActiveItems(items []Item) iter.Seq[Item] {
    return func(yield func(Item) bool) {
        for item := range slices.Values(items) {
            if !item.Archived && !yield(item) {
                return
            }
        }
    }
}

// ✅ Consume it
for item := range ActiveItems(all) {
    process(item)
}
```

### ✅ Channels — concurrent streams

Use channels for fan-out, pipelines, or work queues where goroutines produce values asynchronously:

```go
// Producer goroutine writes to a channel; consumer ranges over it.
func streamResults(ctx context.Context) <-chan Result {
    ch := make(chan Result)
    go func() {
        defer close(ch)
        for r := range slices.Values(source) {
            select {
            case ch <- r:
            case <-ctx.Done():
                return
            }
        }
    }()
    return ch
}

// Consumer
for result := range streamResults(ctx) {
    handle(result)
}
```

### When a classic loop is allowed

Tier 3 — drop to a classic `for` only after tiers 1 and 2 have been ruled out, and only when it truly makes the code clearer. In practice that means one of these, and each such loop **must** carry a one-line comment stating which case applies and why:

1. **Ranging a channel** — `for v := range ch` (the blocking, `await`-equivalent primitive; no iterator to prefer).
2. **Parallel index + element arithmetic** — you need the index for something *other than* element access (offset math, writing back into a second slice at the same index). Even here prefer `for i := range s` (value-only int range) over a `for i := 0; ...` counter, and index `s[i]` inside.
3. **Building an iterator's own body** where the `slices.Values`/`maps.*` adapters can't express the walk (e.g. two slices advanced in lockstep, or a `for {}` with a mid-loop break condition).
4. **A genuinely clearer classic form** — a short, self-evident walk where wrapping it in `slices.Values` would add noise without adding clarity. This is a judgement call, not a blanket licence: if a tier-1 helper or a plain value range says it as clearly, use that instead.

