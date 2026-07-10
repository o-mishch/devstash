---
trigger: glob
globs: ["backend/**/*.go"]
---

# Go Coding Standards

## Iteration style

**Never use classic `for` loops for in-memory sequence iteration.** Go 1.23+ has first-class iterator support via `iter.Seq` / `iter.Seq2` and `slices`/`maps` range-over-func. Use the modern equivalents instead.

### ❌ The Classic Go Way — do NOT write this

```go
// Classic loop over a slice
for i := 0; i < len(items); i++ {
    process(items[i])
}

// Classic range-for (still ok for simple indexed access, but see below)
for _, item := range items {
    process(item)
}

// Classic map iteration
for k, v := range myMap {
    use(k, v)
}
```

### ✅ The Modern Way — iterators (Go 1.23+)

Use `slices`, `maps`, and custom `iter.Seq`/`iter.Seq2` range functions:

```go
import (
    "iter"
    "maps"
    "slices"
)

// Collect, filter, transform with slices package
filtered := slices.DeleteFunc(items, func(item Item) bool {
    return item.Archived
})

// Range over a custom iterator (range-over-func, Go 1.23)
for item := range someIterator() {
    process(item)
}

// Map iteration via maps.All
for k, v := range maps.All(myMap) {
    use(k, v)
}

// Sorted map keys
for k := range slices.Sorted(maps.Keys(myMap)) {
    use(k)
}
```

Define iterators with `iter.Seq[V]` or `iter.Seq2[K, V]`:

```go
// ✅ Define a domain iterator
func ActiveItems(items []Item) iter.Seq[Item] {
    return func(yield func(Item) bool) {
        for _, item := range items {
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
        for _, r := range source {
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

### Exception

Use a plain `for range` or `for i` only when:
- You need `await`-equivalent behaviour (blocking on channel ops inside the loop), **or**
- You need the index for something other than element access (e.g. offset arithmetic).

Always justify the plain loop with a brief comment if it is not self-evident.
