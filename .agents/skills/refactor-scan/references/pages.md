### `src/app/(dashboard)/` or `src/app/(auth)/` — Pages

Look for:
- **Repeated page layouts**: Similar page structure (heading, content area, pagination)
- **Repeated data fetching patterns**: Same query + transform + render pattern
- **Repeated loading/error states**: Same Suspense boundaries or error handling
- **Repeated search params handling**: Same pagination or filter param parsing

Suggest: Layout components, page templates, data fetching wrappers, shared page sections.
