# Item Types

DevStash has 7 system item types. All are immutable (`isSystem: true`, `userId: null`) and seeded once at startup. Users cannot modify or delete them.

---

## Type Reference

### Snippet

| Field   | Value      |
|---------|------------|
| Icon    | `Code` (Lucide) |
| Color   | `#3b82f6` (blue) |
| Content | TEXT |
| Route   | `/items/snippets` |

**Purpose:** Reusable code blocks — hooks, utilities, patterns, boilerplates.

**Key fields:** `content` (required), `language` (for syntax highlighting), `title`, `description`, `tags`

---

### Prompt

| Field   | Value      |
|---------|------------|
| Icon    | `Sparkles` (Lucide) |
| Color   | `#8b5cf6` (purple) |
| Content | TEXT |
| Route   | `/items/prompts` |

**Purpose:** AI prompt templates — system messages, code review prompts, workflow instructions.

**Key fields:** `content` (required), `title`, `description`, `tags`

---

### Command

| Field   | Value      |
|---------|------------|
| Icon    | `Terminal` (Lucide) |
| Color   | `#f97316` (orange) |
| Content | TEXT |
| Route   | `/items/commands` |

**Purpose:** Shell commands and CLI one-liners — git, docker, npm, system administration.

**Key fields:** `content` (required), `title`, `description`, `tags`

---

### Note

| Field   | Value      |
|---------|------------|
| Icon    | `StickyNote` (Lucide) |
| Color   | `#fde047` (yellow) |
| Content | TEXT |
| Route   | `/items/notes` |

**Purpose:** Free-form markdown notes — documentation, meeting notes, research.

**Key fields:** `content` (required), `title`, `description`, `tags`

---

### File

| Field   | Value      |
|---------|------------|
| Icon    | `File` (Lucide) |
| Color   | `#6b7280` (gray) |
| Content | FILE |
| Route   | `/items/files` |

**Purpose:** Uploaded files — context files, PDFs, config templates. **Pro only.**

**Key fields:** `fileUrl` (R2 URL), `fileName` (original name), `fileSize` (bytes), `title`, `description`, `tags`

---

### Image

| Field   | Value      |
|---------|------------|
| Icon    | `Image` (Lucide) |
| Color   | `#ec4899` (pink) |
| Content | FILE |
| Route   | `/items/images` |

**Purpose:** Uploaded images — screenshots, diagrams, design references. **Pro only.**

**Key fields:** `fileUrl` (R2 URL), `fileName`, `fileSize` (bytes), `title`, `description`, `tags`

---

### Link

| Field   | Value      |
|---------|------------|
| Icon    | `Link` (Lucide) |
| Color   | `#10b981` (emerald) |
| Content | URL |
| Route   | `/items/links` |

**Purpose:** Saved URLs — documentation, tools, references, articles.

**Key fields:** `url` (required), `title`, `description`, `tags`

---

## Classification Summary

Items are grouped into three content classes, driven by the `ContentType` enum on the `Item` model:

| Class  | `ContentType` | Types                          | Storage         |
|--------|---------------|--------------------------------|-----------------|
| Text   | `TEXT`        | Snippet, Prompt, Command, Note | `content` field (db.Text) |
| File   | `FILE`        | File, Image                    | `fileUrl` (Cloudflare R2), `fileName`, `fileSize` |
| URL    | `URL`         | Link                           | `url` field     |

## Shared Properties

All items share these fields regardless of type:

| Field         | Type       | Notes |
|---------------|------------|-------|
| `id`          | String     | CUID |
| `title`       | String     | Required |
| `contentType` | Enum       | `TEXT`, `FILE`, or `URL` |
| `description` | String?    | Optional markdown |
| `isFavorite`  | Boolean    | Default `false` |
| `isPinned`    | Boolean    | Default `false` — pinned items surface to top |
| `tags`        | Tag[]      | Many-to-many |
| `collections` | Collection[] | Many-to-many via `ItemCollection` |
| `createdAt`   | DateTime   | |
| `updatedAt`   | DateTime   | |

## Display Differences

| Type    | Syntax Highlight | `language` field | File preview | URL display |
|---------|:---:|:---:|:---:|:---:|
| Snippet | ✅  | ✅  | —   | —   |
| Prompt  | —   | —   | —   | —   |
| Command | —   | —   | —   | —   |
| Note    | —   | —   | —   | —   |
| File    | —   | —   | ✅  | —   |
| Image   | —   | —   | ✅  | —   |
| Link    | —   | —   | —   | ✅  |

- **Snippet** is the only type that uses `language` for syntax highlighting.
- **File/Image** display a file preview and expose `fileName`/`fileSize` in the UI.
- **Link** renders the `url` as a clickable destination.
- **Prompt/Command/Note** render `content` as plain text or markdown, no syntax highlighting.

## Pro Gating

| Type    | Free | Pro |
|---------|:----:|:---:|
| Snippet | ✅   | ✅  |
| Prompt  | ✅   | ✅  |
| Command | ✅   | ✅  |
| Note    | ✅   | ✅  |
| Link    | ✅   | ✅  |
| File    | ❌   | ✅  |
| Image   | ❌   | ✅  |

The `PRO_TYPE_NAMES` set in the sidebar gates File and Image display without any schema changes.

## Icon Map

Icons resolve at runtime via `ICON_MAP` in [src/lib/icon-utils.tsx](../src/lib/icon-utils.tsx). The `icon` field on `ItemType` stores the Lucide component name as a string (e.g. `"Code"`), which is looked up and rendered with the type's `color` hex value.

```typescript
const ICON_MAP: Record<string, LucideIcon> = {
  Code, Sparkles, Terminal, StickyNote, File, Image, Link,
}
```
