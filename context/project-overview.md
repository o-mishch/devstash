# DevStash - Project Overview

> A unified hub for developer knowledge & resources

> [!IMPORTANT]
> **This is a product-intent document, and a pre-migration snapshot for anything stack-related.**
>
> It records *what DevStash is and why* — problem, users, features, pricing, design. Trust it for that.
>
> Do **not** trust its **Tech Stack** section: it describes the original single-codebase Next.js app and predates the Go backend (`backend/`) and Vite SPA (`web/`). For the current stack see `.agents/rules/boundary.md`; for migration status `context/current-feature.md`; for architecture decisions `context/migration-log.md`.
>
> The Prisma schema dump, project structure, and "Next Steps" sections were removed — they duplicated or contradicted the real sources. The schema is **frozen** and lives in `prisma/schema.prisma`; goose (`backend/db/migrations/`) owns all new schema changes.

---

## 📋 Table of Contents

- [Problem Statement](#-problem-statement)
- [Target Users](#-target-users)
- [Features](#-features)
- [Data Architecture](#-data-architecture)
- [Tech Stack](#-tech-stack)
- [Monetization](#-monetization)
- [UI/UX Guidelines](#-uiux-guidelines)

---

## 🎯 Problem Statement

Developers keep their essentials scattered across multiple tools and locations:

| Resource      | Common Location          |
| ------------- | ------------------------ |
| Code snippets | VS Code, Notion, Gists   |
| AI prompts    | Chat histories           |
| Context files | Buried in projects       |
| Useful links  | Browser bookmarks        |
| Documentation | Random folders           |
| Commands      | .txt files, bash history |
| Templates     | GitHub Gists             |

**The Result:** Context switching, lost knowledge, and inconsistent workflows.

**The Solution:** DevStash provides ONE fast, searchable, AI-enhanced hub for all developer knowledge & resources.

---

## 👥 Target Users

| User Type                      | Primary Needs                                      |
| ------------------------------ | -------------------------------------------------- |
| **Everyday Developer**         | Fast access to snippets, prompts, commands, links  |
| **AI-First Developer**         | Save prompts, contexts, workflows, system messages |
| **Content Creator / Educator** | Store code blocks, explanations, course notes      |
| **Full-Stack Builder**         | Collect patterns, boilerplates, API examples       |

---

## ✨ Features

### A. Items & Item Types

Items are the core unit of DevStash. Each item has a type that determines its behavior and appearance.

#### System Types (Immutable)

| Type      | Icon         | Color               | Content Type | Route             |
| --------- | ------------ | ------------------- | ------------ | ----------------- |
| 🔷 Snippet | `Code`       | `#3b82f6` (blue)    | Text         | `/items/snippets` |
| 🟣 Prompt  | `Sparkles`   | `#8b5cf6` (purple)  | Text         | `/items/prompts`  |
| 🟠 Command | `Terminal`   | `#f97316` (orange)  | Text         | `/items/commands` |
| 🟡 Note    | `StickyNote` | `#fde047` (yellow)  | Text         | `/items/notes`    |
| ⚫ File    | `File`       | `#6b7280` (gray)    | File         | `/items/files`    |
| 🩷 Image   | `Image`      | `#ec4899` (pink)    | File         | `/items/images`   |
| 🟢 Link    | `Link`       | `#10b981` (emerald) | URL          | `/items/links`    |

> **Note:** File and Image types are Pro-only features.

### B. Collections

Users can organize items into collections. Items support many-to-many relationships with collections.

**Examples:**

- React Patterns (snippets, notes)
- Context Files (files)
- Python Snippets (snippets)
- Interview Prep (mixed types)

### C. Search

Powerful search across:

- Content
- Tags
- Titles
- Types

### D. Authentication

- Email/password authentication
- GitHub OAuth sign-in
- Powered by NextAuth v5

### E. Core Features

- ⭐ Collection and item favorites
- 📌 Pin items to top
- 🕐 Recently used items
- 📥 Import code from file
- ✍️ Markdown editor for text types
- 📤 File upload for file types
- 💾 Export data (JSON/ZIP)
- 🌙 Dark mode (default)
- 🏷️ Multi-collection item assignment
- 👁️ View item's collection memberships

### F. AI Features (Pro Only)

- 🤖 AI auto-tag suggestions
- 📝 AI summaries
- 💡 AI "Explain This Code"
- ⚡ Prompt optimizer

---

## 🗄️ Data Architecture

### Entity Relationship Diagram

```mermaid
erDiagram
    USER ||--o{ ITEM : creates
    USER ||--o{ COLLECTION : creates
    USER ||--o{ ITEMTYPE : creates
    ITEM ||--o{ ITEMCOLLECTION : belongs_to
    COLLECTION ||--o{ ITEMCOLLECTION : contains
    ITEM }o--|| ITEMTYPE : has_type
    ITEM }o--o{ TAG : tagged_with
    COLLECTION }o--o| ITEMTYPE : has_default_type

    USER {
        string id PK
        string email
        string name
        boolean isPro
        string stripeCustomerId
        string stripeSubscriptionId
        datetime createdAt
        datetime updatedAt
    }

    ITEM {
        string id PK
        string title
        enum contentType
        text content
        string fileUrl
        string fileName
        int fileSize
        string url
        string description
        boolean isFavorite
        boolean isPinned
        string language
        datetime createdAt
        datetime updatedAt
        string userId FK
        string itemTypeId FK
    }

    ITEMTYPE {
        string id PK
        string name
        string icon
        string color
        boolean isSystem
        string userId FK
    }

    COLLECTION {
        string id PK
        string name
        string description
        boolean isFavorite
        string defaultTypeId FK
        datetime createdAt
        datetime updatedAt
        string userId FK
    }

    ITEMCOLLECTION {
        string itemId FK
        string collectionId FK
        datetime addedAt
    }

    TAG {
        string id PK
        string name
    }
```

### Seed Data for System Types

```typescript
// prisma/seed.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const systemItemTypes = [
  { name: 'snippet', icon: 'Code', color: '#3b82f6', isSystem: true },
  { name: 'prompt', icon: 'Sparkles', color: '#8b5cf6', isSystem: true },
  { name: 'command', icon: 'Terminal', color: '#f97316', isSystem: true },
  { name: 'note', icon: 'StickyNote', color: '#fde047', isSystem: true },
  { name: 'file', icon: 'File', color: '#6b7280', isSystem: true },
  { name: 'image', icon: 'Image', color: '#ec4899', isSystem: true },
  { name: 'link', icon: 'Link', color: '#10b981', isSystem: true },
];

async function main() {
  console.log('Seeding system item types...');

  for (const type of systemItemTypes) {
    await prisma.itemType.upsert({
      where: { name_userId: { name: type.name, userId: null } },
      update: {},
      create: type,
    });
  }

  console.log('Seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

---

## 🛠️ Tech Stack

### Architecture Diagram

```mermaid
flowchart TB
    subgraph Client["Client Layer"]
        Browser["Browser"]
        Mobile["Mobile Browser"]
    end

    subgraph NextJS["Next.js 16 Application"]
        Pages["SSR Pages"]
        Components["React 19 Components"]
        API["API Routes"]
    end

    subgraph Services["External Services"]
        Auth["NextAuth v5"]
        AI["OpenAI GPT-4o Mini"]
        Storage["AWS S3"]
        Payments["Stripe"]
    end

    subgraph Database["Database Layer"]
        Neon["Neon PostgreSQL"]
        Prisma["Prisma 7 ORM"]
    end

    Browser --> NextJS
    Mobile --> NextJS
    Pages --> Components
    Components --> API
    API --> Auth
    API --> AI
    API --> Storage
    API --> Payments
    API --> Prisma
    Prisma --> Neon
```

### Technology Choices

| Category           | Technology                  | Notes                                  |
| ------------------ | --------------------------- | -------------------------------------- |
| **Framework**      | Next.js 16 / React 19       | SSR pages, API routes, single codebase |
| **Language**       | TypeScript                  | Type safety throughout                 |
| **Database**       | Neon PostgreSQL             | Serverless Postgres                    |
| **ORM**            | Prisma 7                    | Latest version with full type safety   |
| **File Storage**   | AWS S3                      | Object storage                         |
| **Authentication** | NextAuth v5                 | Email/password + GitHub OAuth          |
| **AI**             | OpenAI GPT-4o Mini          | Cost-effective for AI features         |
| **Styling**        | Tailwind CSS v4 + shadcn/ui | Modern, accessible components          |
| **Payments**       | Stripe                      | Subscriptions & billing                |

### Important Development Notes

> ⚠️ **Database Migrations**
>
> **NEVER** use `prisma db push` or directly update the database structure.
>
> Always create migrations that run in development first, then production:
>
> ```bash
> # Create migration
> npx prisma migrate dev --name <migration_name>
>
> # Apply to production
> npx prisma migrate deploy
> ```

### Recommended Links

- [Next.js Documentation](https://nextjs.org/docs)
- [Prisma Documentation](https://www.prisma.io/docs)
- [NextAuth.js Documentation](https://authjs.dev)
- [Tailwind CSS v4](https://tailwindcss.com/docs)
- [shadcn/ui Components](https://ui.shadcn.com)
- [Neon PostgreSQL](https://neon.tech/docs)
- [AWS S3](https://docs.aws.amazon.com/s3)
- [Stripe Subscriptions](https://stripe.com/docs/billing/subscriptions)

---

## 💰 Monetization

### Pricing Tiers

```mermaid
flowchart LR
    subgraph Free["Free Tier"]
        F1["50 items total"]
        F2["3 collections"]
        F3["Basic types only"]
        F4["Basic search"]
        F5["No file uploads"]
        F6["No AI features"]
    end

    subgraph Pro["Pro Tier - $8/mo or $72/yr"]
        P1["Unlimited items"]
        P2["Unlimited collections"]
        P3["File & Image uploads"]
        P4["Custom types (future)"]
        P5["AI auto-tagging"]
        P6["AI code explanation"]
        P7["AI prompt optimizer"]
        P8["Export (JSON/ZIP)"]
        P9["Priority support"]
    end
```

### Feature Comparison

| Feature                                   | Free  |      Pro      |
| ----------------------------------------- | :---: | :-----------: |
| Items                                     |  50   |   Unlimited   |
| Collections                               |   3   |   Unlimited   |
| Snippets, Prompts, Commands, Notes, Links |   ✅   |       ✅       |
| Files & Images                            |   ❌   |       ✅       |
| Basic Search                              |   ✅   |       ✅       |
| Custom Types                              |   ❌   | 🔜 Coming Soon |
| AI Auto-tagging                           |   ❌   |       ✅       |
| AI Code Explanation                       |   ❌   |       ✅       |
| AI Prompt Optimizer                       |   ❌   |       ✅       |
| Data Export                               |   ❌   |       ✅       |
| Priority Support                          |   ❌   |       ✅       |

> **Development Note:** During development, all users can access all features. Pro gating will be enabled before launch.

---

## 🎨 UI/UX Guidelines

### Design Principles

- **Modern & Minimal** - Developer-focused aesthetic
- **Dark Mode Default** - Light mode optional
- **Clean Typography** - Generous whitespace
- **Subtle Accents** - Borders and shadows used sparingly
- **Syntax Highlighting** - For all code blocks

### Design References

- [Notion](https://notion.so) - Clean organization
- [Linear](https://linear.app) - Modern dev aesthetic
- [Raycast](https://raycast.com) - Quick access patterns

### Screenshots

Refer to the screenshots below as a base for the dashboard UI. It does not have to be exact. Use it as a reference:

- @context/screenshots/dashboard-ui-main.png
- @context/screenshots/dashboard-ui-drawer.png

### Layout Structure

```
┌─────────────────────────────────────────────────────────────┐
│  DevStash                                    🔍  ⚙️  👤     │
├──────────────┬──────────────────────────────────────────────┤
│              │                                              │
│  TYPES       │  Collections                                 │
│  ─────────   │  ┌────────┐ ┌────────┐ ┌────────┐           │
│  📝 Snippets │  │ React  │ │ Python │ │Context │           │
│  ✨ Prompts  │  │Patterns│ │Snippets│ │ Files  │           │
│  ⌨️ Commands │  └────────┘ └────────┘ └────────┘           │
│  📒 Notes    │                                              │
│  📁 Files    │  Recent Items                                │
│  🖼️ Images   │  ┌──────────────────────────────────────┐   │
│  🔗 Links    │  │ 🔷 useAuth hook snippet              │   │
│              │  ├──────────────────────────────────────┤   │
│  ─────────   │  │ 🟣 Code review prompt                │   │
│  COLLECTIONS │  ├──────────────────────────────────────┤   │
│  React...    │  │ 🟠 git reset --hard HEAD~1           │   │
│  Python...   │  └──────────────────────────────────────┘   │
│              │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

### Type Colors (CSS Variables)

```css
:root {
  --color-snippet: #3b82f6; /* Blue */
  --color-prompt: #8b5cf6; /* Purple */
  --color-command: #f97316; /* Orange */
  --color-note: #fde047; /* Yellow */
  --color-file: #6b7280; /* Gray */
  --color-image: #ec4899; /* Pink */
  --color-link: #10b981; /* Emerald */
}
```

### Icon Mapping (Lucide React)

```typescript
// lib/constants/item-types.ts

import {
  Code,
  Sparkles,
  Terminal,
  StickyNote,
  File,
  Image,
  Link,
} from 'lucide-react';

export const ITEM_TYPE_ICONS = {
  snippet: Code,
  prompt: Sparkles,
  command: Terminal,
  note: StickyNote,
  file: File,
  image: Image,
  link: Link,
} as const;

export const ITEM_TYPE_COLORS = {
  snippet: '#3b82f6',
  prompt: '#8b5cf6',
  command: '#f97316',
  note: '#fde047',
  file: '#6b7280',
  image: '#ec4899',
  link: '#10b981',
} as const;
```

### Responsive Behavior

| Viewport            | Sidebar                    | Layout                         |
| ------------------- | -------------------------- | ------------------------------ |
| Desktop (≥1024px)   | Visible, collapsible       | Full sidebar + main content    |
| Tablet (768-1023px) | Drawer (hidden by default) | Full-width main content        |
| Mobile (<768px)     | Drawer (hidden by default) | Stacked cards, simplified grid |

### Micro-interactions

- **Transitions** - Smooth 150-200ms easing
- **Hover States** - Subtle elevation on cards
- **Toast Notifications** - For CRUD actions
- **Loading States** - Skeleton placeholders
- **Drawer Animations** - Slide-in for item editing

---

