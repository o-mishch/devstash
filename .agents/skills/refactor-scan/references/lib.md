### `src/lib/` — Utilities & Libraries

Look for:
- **Repeated helper functions**: Similar transform, format, or validation functions across files
- **Repeated type definitions**: Similar interfaces or types that could be unified
- **Repeated constants**: Same magic numbers, strings, or config values in multiple files
- **Overlapping utilities**: Functions in different files that do nearly the same thing
- **Repeated API client patterns**: Similar fetch/response handling
- **Client-only code in lib**: Browser APIs, React state, or DOM access in `src/lib/` files is a P1 violation

Suggest: Consolidated utility modules, shared type files, constants files.
