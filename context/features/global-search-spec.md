# Global Search / Command Palette

## Overview

Add a global command palette (Cmd+K / Ctrl+K) with fuzzy search across items and collections.

## Requirements

- Open with Cmd+K (Mac) / Ctrl+K (Windows)
- Fuzzy search across all items and collections
- Grouped results: Items section, Collections section
- Keyboard navigation (arrow keys, Enter to select)
- Show item type icon and collection item count
- Navigate to item drawer or collection page on select
- TopBar search input opens palette on click
- Show ⌘K hint in search input placeholder

## Technical

- Use shadcn `cmdk` component (Command)
- **Hybrid Search Architecture**: Combine local fuzzy search with an async remote search because the front-end only holds a partial list of items (due to infinite scroll).
- **Local Search**: Filter against the `ItemsStoreContext` (which holds `LightItem` records loaded so far) and the globally available collections.
- **Remote Search**: Send a debounced async search request to the backend (e.g., via Server Action `searchItemsAction`) to search all entities (Items and Collections) in the database.
- **Backend Performance (Prisma + Neon Postgres)**:
  - Enable the `fullTextSearchPostgres` preview feature in Prisma schema to unlock native `.search()` for PostgreSQL.
  - Implement a raw SQL migration to add a **GIN index** with `to_tsvector` on the searchable text columns (`Item`: title, description, content; `Collection`: name, description). This guarantees O(1) index lookups and extremely fast execution times (sub-millisecond) for full-text search, avoiding sequential scans.
- **CMDK Configuration**: Use `<Command shouldFilter={false}>` to disable the internal `cmdk` filter. This prevents `cmdk` from incorrectly filtering out async backend results that match on fields not present in the local UI value.
- **Result Merging**: Deduplicate remote results against local results by ID, ensuring items already loaded locally don't appear twice.
- **Loading State**: Utilize `<Command.Loading>` to indicate when the async backend search is in progress.
- Search data: items (id, title, type, content preview), collections (id, name, itemCount)
