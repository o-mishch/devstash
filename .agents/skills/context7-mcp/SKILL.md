---
name: context7-mcp
description: Fetches current documentation for any library, framework, SDK, or API using Context7 MCP instead of relying on training data.
when_to_use: Use any time the user mentions React, Next.js, Prisma, Tailwind, shadcn/ui, NextAuth, Zod, Stripe, Resend, or any other library/framework. Triggers on "how do I use X", "what's the syntax for Y", "configure Z", "write a query/hook/component using library", setup questions, version migration, API references. Prefer this over WebSearch for library docs.
---

## How to Fetch Documentation

### Step 1: Resolve the Library ID

Call `resolve-library-id` with:

- `libraryName`: The library name extracted from the user's question
- `query`: The user's full question (improves relevance ranking)

### Step 2: Select the Best Match

From the resolution results, choose based on:

- Exact or closest name match to what the user asked for
- Higher benchmark scores indicate better documentation quality
- If the user mentioned a version (e.g., "React 19"), prefer version-specific IDs

### Step 3: Fetch the Documentation

Call `query-docs` with:

- `libraryId`: The selected Context7 library ID (e.g., `/vercel/next.js`)
- `query`: The user's specific question

### Step 4: Use the Documentation

Incorporate the fetched documentation into your response:

- Answer the user's question using current, accurate information
- Include relevant code examples from the docs
- Cite the library version when relevant

## Guidelines

- **Be specific**: Pass the user's full question as the query for better results
- **Version awareness**: When users mention versions ("Next.js 15", "React 19"), use version-specific library IDs if available from the resolution step
- **Prefer official sources**: When multiple matches exist, prefer official/primary packages over community forks
