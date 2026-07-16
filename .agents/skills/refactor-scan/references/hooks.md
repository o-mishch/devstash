### `src/hooks/` — Custom Hooks

Look for:
- **Repeated state patterns**: Multiple hooks managing similar state shapes
- **Repeated effect patterns**: Similar useEffect cleanup or dependency patterns
- **Hooks that could be composed**: Smaller hooks that multiple hooks re-implement instead of composing
- **Repeated callback patterns**: Similar memoized callbacks across hooks

Suggest: Composed hooks, base hooks, shared state reducers.
