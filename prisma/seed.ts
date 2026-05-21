import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { PrismaClient, ContentType } from '../src/generated/prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'

const adapter = new PrismaNeon({ connectionString: process.env.DIRECT_URL })
const prisma = new PrismaClient({ adapter })

const systemItemTypes = [
  { name: 'snippet', icon: 'Code', color: '#3b82f6', isSystem: true },
  { name: 'prompt', icon: 'Sparkles', color: '#8b5cf6', isSystem: true },
  { name: 'command', icon: 'Terminal', color: '#f97316', isSystem: true },
  { name: 'note', icon: 'StickyNote', color: '#fde047', isSystem: true },
  { name: 'file', icon: 'File', color: '#6b7280', isSystem: true },
  { name: 'image', icon: 'Image', color: '#ec4899', isSystem: true },
  { name: 'link', icon: 'Link', color: '#10b981', isSystem: true },
]

interface SeedItem {
  title: string
  contentType: ContentType
  content?: string
  url?: string
  description?: string
  language?: string
  isPinned?: boolean
  isFavorite?: boolean
  itemTypeId: string
  userId: string
}

async function seedItems(
  items: SeedItem[],
  collectionId: string,
) {
  await Promise.all(
    items.map(async (data) => {
      const item = await prisma.item.create({ data })
      await prisma.itemCollection.create({ data: { itemId: item.id, collectionId } })
    }),
  )
}

async function main() {
  console.log('Seeding system item types...')
  await prisma.itemType.createMany({ data: systemItemTypes, skipDuplicates: true })

  console.log('Seeding demo user...')
  const passwordHash = await bcrypt.hash('12345678', 12)
  const user = await prisma.user.upsert({
    where: { email: 'demo@devstash.io' },
    update: {},
    create: {
      email: 'demo@devstash.io',
      name: 'Demo User',
      password: passwordHash,
      isPro: false,
      emailVerified: new Date(),
    },
  })

  const types = await prisma.itemType.findMany({ where: { isSystem: true, userId: null } })
  const t = Object.fromEntries(types.map((type) => [type.name, type.id]))

  // ── React Patterns ────────────────────────────────────────────────
  console.log('Seeding React Patterns...')
  const reactPatterns = await prisma.collection.create({
    data: { name: 'React Patterns', description: 'Reusable React patterns and hooks', userId: user.id, isFavorite: true },
  })

  await seedItems(
    [
      {
        title: 'useDebounce Hook',
        contentType: ContentType.TEXT,
        language: 'typescript',
        isPinned: true,
        itemTypeId: t['snippet'],
        userId: user.id,
        content: `import { useState, useEffect } from 'react'

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debouncedValue
}`,
      },
      {
        title: 'Context Provider Pattern',
        contentType: ContentType.TEXT,
        language: 'typescript',
        itemTypeId: t['snippet'],
        userId: user.id,
        content: `import { createContext, useContext, useState, ReactNode } from 'react'

interface ThemeContextValue {
  theme: 'light' | 'dark'
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}`,
      },
      {
        title: 'cn Utility (clsx + tailwind-merge)',
        contentType: ContentType.TEXT,
        language: 'typescript',
        itemTypeId: t['snippet'],
        userId: user.id,
        content: `import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}`,
      },
    ],
    reactPatterns.id,
  )

  // ── AI Workflows ──────────────────────────────────────────────────
  console.log('Seeding AI Workflows...')
  const aiWorkflows = await prisma.collection.create({
    data: { name: 'AI Workflows', description: 'AI prompts and workflow automations', userId: user.id, isFavorite: true },
  })

  await seedItems(
    [
      {
        title: 'Code Review Prompt',
        contentType: ContentType.TEXT,
        itemTypeId: t['prompt'],
        userId: user.id,
        content: `Review the following code and provide feedback on:
1. Correctness — are there logic errors or edge cases?
2. Performance — any unnecessary operations or bottlenecks?
3. Security — input validation, auth checks, injection risks
4. Readability — naming, structure, unnecessary complexity
5. Patterns — does it match the existing codebase style?

Be concise. Prioritize issues by severity (critical → minor).

\`\`\`
{{code}}
\`\`\``,
      },
      {
        title: 'Documentation Generator',
        contentType: ContentType.TEXT,
        itemTypeId: t['prompt'],
        userId: user.id,
        content: `Generate clear, concise documentation for the following function or module.

Include:
- A one-line summary
- Parameters (name, type, description)
- Return value
- Example usage
- Any important notes or side effects

Do not add obvious comments. Focus on the WHY, not the WHAT.

\`\`\`
{{code}}
\`\`\``,
      },
      {
        title: 'Refactoring Assistant',
        contentType: ContentType.TEXT,
        itemTypeId: t['prompt'],
        userId: user.id,
        content: `Refactor the following code to improve readability and maintainability.

Rules:
- Preserve exact behavior — no functional changes
- Reduce nesting and complexity where possible
- Use descriptive variable names
- Extract repeated logic into helpers
- Remove dead code and unused variables
- Keep it idiomatic for the language/framework

Show the refactored version only. Add a brief bullet list of what changed.

\`\`\`
{{code}}
\`\`\``,
      },
    ],
    aiWorkflows.id,
  )

  // ── DevOps ────────────────────────────────────────────────────────
  console.log('Seeding DevOps...')
  const devops = await prisma.collection.create({
    data: { name: 'DevOps', description: 'Infrastructure and deployment resources', userId: user.id },
  })

  await seedItems(
    [
      {
        title: 'Next.js Dockerfile (multi-stage)',
        contentType: ContentType.TEXT,
        language: 'dockerfile',
        itemTypeId: t['snippet'],
        userId: user.id,
        content: `FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]`,
      },
      {
        title: 'Zero-downtime deploy (Docker)',
        contentType: ContentType.TEXT,
        itemTypeId: t['command'],
        userId: user.id,
        content: `docker pull ghcr.io/$IMAGE_NAME:latest && \\
docker stop app || true && \\
docker rm app || true && \\
docker run -d --name app --restart unless-stopped \\
  -p 3000:3000 \\
  --env-file .env.production \\
  ghcr.io/$IMAGE_NAME:latest`,
        description: 'Pull latest image, swap container with zero downtime',
      },
      {
        title: 'GitHub Actions Documentation',
        contentType: ContentType.URL,
        url: 'https://docs.github.com/en/actions',
        description: 'Official GitHub Actions docs — workflows, triggers, runners',
        itemTypeId: t['link'],
        userId: user.id,
      },
      {
        title: 'Docker Official Documentation',
        contentType: ContentType.URL,
        url: 'https://docs.docker.com',
        description: 'Docker engine, Compose, networking, volumes reference',
        itemTypeId: t['link'],
        userId: user.id,
      },
    ],
    devops.id,
  )

  // ── Terminal Commands ─────────────────────────────────────────────
  console.log('Seeding Terminal Commands...')
  const terminalCmds = await prisma.collection.create({
    data: { name: 'Terminal Commands', description: 'Useful shell commands for everyday development', userId: user.id },
  })

  await seedItems(
    [
      {
        title: 'Git — interactive rebase last N commits',
        contentType: ContentType.TEXT,
        itemTypeId: t['command'],
        userId: user.id,
        content: 'git rebase -i HEAD~{{n}}',
        description: 'Squash, reorder, or edit the last N commits before pushing',
      },
      {
        title: 'Docker — remove all stopped containers & unused images',
        contentType: ContentType.TEXT,
        itemTypeId: t['command'],
        userId: user.id,
        content: 'docker system prune -af --volumes',
        description: 'Frees disk space by removing stopped containers, dangling images, and unused volumes',
      },
      {
        title: 'Find & kill process on port',
        contentType: ContentType.TEXT,
        itemTypeId: t['command'],
        userId: user.id,
        isPinned: true,
        content: 'lsof -ti tcp:{{port}} | xargs kill -9',
        description: 'Useful when a dev server fails to release its port',
      },
      {
        title: 'npm — audit and fix vulnerabilities',
        contentType: ContentType.TEXT,
        itemTypeId: t['command'],
        userId: user.id,
        content: 'npm audit fix && npm dedupe',
        description: 'Auto-fix known vulnerabilities and deduplicate the dependency tree',
      },
    ],
    terminalCmds.id,
  )

  // ── Design Resources ──────────────────────────────────────────────
  console.log('Seeding Design Resources...')
  const designResources = await prisma.collection.create({
    data: { name: 'Design Resources', description: 'UI/UX resources and references', userId: user.id },
  })

  await seedItems(
    [
      {
        title: 'Tailwind CSS Documentation',
        contentType: ContentType.URL,
        url: 'https://tailwindcss.com/docs',
        description: 'Utility-first CSS framework — full class reference',
        itemTypeId: t['link'],
        userId: user.id,
      },
      {
        title: 'shadcn/ui Components',
        contentType: ContentType.URL,
        url: 'https://ui.shadcn.com',
        description: 'Accessible, copy-paste React components built on Radix UI',
        itemTypeId: t['link'],
        userId: user.id,
      },
      {
        title: 'Radix UI Primitives',
        contentType: ContentType.URL,
        url: 'https://www.radix-ui.com/primitives',
        description: 'Unstyled, accessible component primitives for React',
        itemTypeId: t['link'],
        userId: user.id,
      },
      {
        title: 'Lucide Icons',
        contentType: ContentType.URL,
        url: 'https://lucide.dev/icons',
        description: 'Open-source icon library — searchable, MIT licensed',
        itemTypeId: t['link'],
        userId: user.id,
      },
    ],
    designResources.id,
  )

  console.log('Seeding complete.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
