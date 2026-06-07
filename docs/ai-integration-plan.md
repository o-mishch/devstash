# AI Integration Plan — DevStash

## Overview

Integrate OpenAI for four Pro-only features: auto-tagging (all item types), AI summaries (notes, links), code explanation (snippets, commands), and prompt optimization (prompts). Model selection is feature-specific: `gpt-4.1-nano` for tagging (classification, no reasoning required), `gpt-5-mini` for everything else (near-frontier quality at competitive cost).

---

## 1. AI Operational Best Practices

Before diving into the implementation details, it is critical to adhere to the following best practices when integrating OpenAI with Next.js, as derived from current guidelines and the SOLID principles:

### 1.1 SOLID Architecture & Encapsulation
- **Dependency Inversion**: Server Actions and API Routes must **never** call the OpenAI SDK directly.
- **Single Responsibility Principle**: 
  - `src/lib/ai/client.ts` owns SDK initialization and configuration.
  - `src/lib/ai/service.ts` owns the business logic, constructing prompts, and executing requests.
  - `src/actions/ai.ts` acts as a thin presentation/orchestration layer (handling Zod validation, auth, and rate-limiting).

### 1.2 Streaming vs. Non-Streaming Decision Framework
Choosing between streaming and non-streaming responses fundamentally impacts both UX and backend architecture:

- **Non-Streaming (Structured Data & Short Text)**
  - **Best for**: Auto-tagging, summarization, prompt optimization.
  - **Why**: These operations either require structured JSON output (tags) where partial data is useless, or side-by-side diffing (prompt optimization) where the full text must be ready before the UI can render meaningfully.
  - **Implementation**: Handled easily within Next.js Server Actions using the `client.chat.completions.parse()` helper.

- **Streaming (Long-Form Content)**
  - **Best for**: Code explanations and generative chat.
  - **Why**: AI explanations for large code snippets can take 5-10+ seconds to generate. Streaming provides immediate visual feedback, significantly reducing the perceived latency.
  - **Implementation**: Must use an API Route (`src/app/api/...`), as Next.js Server Actions cannot serialize `ReadableStream` objects to the client. Use `stream: true` and `stream_options: { include_usage: true }` to accurately track token consumption on the final chunk.

### 1.3 Structured Outputs
Never rely on prompt engineering alone to return JSON. Always use `client.chat.completions.parse()` paired with Zod schemas (`zodResponseFormat`). This guarantees the output matches your schema perfectly without manual `JSON.parse` or regex wrangling, ensuring type-safe returns to the client.

### 1.4 Prompt Injection & Security
- **Strict Role Separation**: Never construct the `system` role prompt using user input. All user-supplied text must be passed in the `user` message role.
- **Data Exfiltration Mitigations**: If the AI uses tools or fetches external data, ensure the application strictly isolates sensitive database access. Only provide the minimum context required for the specific task.
- **Refusal Handling**: Always check for `message.refusal` when using structured outputs, as the model may refuse to process unsafe inputs even if they parse successfully into a partial object.

---

## 2. Model Selection & Token Budget

### Application context

DevStash has seven item types. AI features don't apply uniformly — each targets a subset:

| Item type | Auto-tag | Summary | Code Explanation | Prompt Optimization |
|---|---|---|---|---|
| `snippet` | ✅ | — | ✅ primary | — |
| `command` | ✅ | — | ✅ | — |
| `prompt` | ✅ | — | — | ✅ primary |
| `note` | ✅ | ✅ primary | — | — |
| `link` | ✅ | ✅ | — | — |
| `file` | ✅ | — | — | — |
| `image` | ✅ | — | — | — |

### Selected models

| Feature | Model | Rationale |
|---|---|---|
| Auto-tagging | `gpt-4.1-nano` | Classification — no reasoning required; cheapest model. |
| AI Summary | `gpt-5-mini` | Summarization quality matters; highly competitive cost/performance. |
| Code Explanation | `gpt-5-mini` | Accuracy is critical; streaming hides longer generation latency. |
| Prompt Optimization | `gpt-5-mini` | Nuanced rewriting; strong instruction-following required. |

### Token budget per feature

Rule of thumb: **1 token ≈ 4 chars**. System prompts add ~30–50 tokens each.

| Feature | Server input limit | Max input tokens | Hard `max_tokens` | Typical output tokens |
|---|---|---|---|---|
| Auto-tagging | title + content 2,000 chars | ~580 | 100 | ~15 |
| AI Summary | content 6,000 chars | ~1,550 | 200 | ~80 |
| Code Explanation | content 8,000 chars | ~2,050 | 1,200 | ~600 |
| Prompt Optimization | content 3,000 chars | ~800 | 1,000 | ~700 |

---

## 3. SDK Setup & Configuration

### Installation

```bash
npm install openai
```

### 3.1 AI Client Initialization: `src/lib/ai/client.ts`

This file owns the SDK client instance, model constants, and a shared error handler.

```ts
import 'server-only'
import OpenAI from 'openai'
import type { ChatModel } from 'openai/resources'
import { ApiResponse } from '@/lib/api'
import { createLogger, toErrorMessage } from '@/lib/logger'
import type { ApiBody } from '@/types/api'

const log = createLogger('openai')

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30 * 1000,  // 30s — short enough to not hang a Server Action
  maxRetries: 2,       // automatic exponential backoff on 429/5xx
})

export const AI_MODELS = {
  TAG:     'gpt-4.1-nano' as ChatModel,
  DEFAULT: 'gpt-5-mini'  as ChatModel,
} as const

export function handleOpenAIError(err: unknown): ApiBody<null> {
  if (err instanceof OpenAI.APIError) {
    if (err.status === 429) {
      return ApiResponse.TOO_MANY_REQUESTS('AI rate limit exceeded. Try again shortly.')
    }
    if (err.status >= 500) {
      return ApiResponse.INTERNAL_ERROR('AI service unavailable. Try again later.')
    }
    log.warn('OpenAI API error', { status: err.status, code: err.code })
    return ApiResponse.INTERNAL_ERROR('AI request failed.')
  }
  
  log.error('unexpected AI error', toErrorMessage(err))
  return ApiResponse.INTERNAL_ERROR()
}
```

### 3.2 AI Service Layer: `src/lib/ai/service.ts`

To maintain SOLID principles, all business logic relating to OpenAI resides here. Server Actions import from this service.

```ts
import 'server-only'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'
import { openai, AI_MODELS } from './client'
import { createLogger } from '@/lib/logger'

const log = createLogger('ai-service')

// --- Auto-tagging ---

const autoTagResponseSchema = z.object({ tags: z.array(z.string()).max(5) })

export interface SuggestTagsParams {
  title: string
  content?: string | null
}

export async function suggestTags({ title, content }: SuggestTagsParams) {
  const userContent = content ? `Title: ${title}\nContent: ${content}` : `Title: ${title}`
  
  const completion = await openai.chat.completions.parse({
    model: AI_MODELS.TAG,
    max_tokens: 100,
    response_format: zodResponseFormat(autoTagResponseSchema, 'auto_tags'),
    messages: [
      {
        role: 'system',
        content: 'You are a tagging assistant. Return up to 5 lowercase tags with no spaces. Base tags on the provided title and content.',
      },
      {
        role: 'user',
        content: userContent,
      },
    ],
  })

  const message = completion.choices[0]?.message
  
  if (message?.refusal) {
    log.warn('OpenAI refused auto-tag request', { refusal: message.refusal })
    throw new Error('AI refused to generate tags for this content.')
  }

  log.info('Auto-tag completion', { tokens: completion.usage?.total_tokens })
  return message?.parsed?.tags ?? []
}

// --- Code Explanation (Streaming) ---

export interface ExplainCodeParams {
  content: string
  language?: string | null
  signal?: AbortSignal
}

export async function explainCode({ content, language, signal }: ExplainCodeParams) {
  return openai.chat.completions.create(
    {
      model: AI_MODELS.DEFAULT,
      max_tokens: 1200,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        {
          role: 'system',
          content: 'You are an expert developer. Explain what the code does, key concepts used, and any gotchas. Be concise.',
        },
        {
          role: 'user',
          content: `Language: ${language ?? 'unknown'}\n\n\`\`\`\n${content}\n\`\`\``,
        },
      ],
    },
    { signal }
  )
}
```

---

## 4. Server Action Patterns (Non-Streaming)

### File: `src/actions/ai.ts`

Actions act as thin orchestrators handling Zod validation, auth, rate limiting, and delegating to the AI Service.

```ts
'use server'

import { z } from 'zod'
import { ApiResponse } from '@/lib/api'
import { withValidatedAuth } from '@/lib/session'
import { rateLimitAction } from '@/lib/rate-limit'
import { handleOpenAIError } from '@/lib/ai/client'
import { suggestTags } from '@/lib/ai/service'
import type { ApiBody } from '@/types/api'

const autoTagSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().max(2000).optional().nullable(),
})

interface AutoTagData {
  tags: string[]
}

export async function suggestTagsAction(
  raw: z.infer<typeof autoTagSchema>
): Promise<ApiBody<AutoTagData | null>> {
  return withValidatedAuth(autoTagSchema, raw, async ({ userId, isPro }, data) => {
    if (!isPro) {
      return ApiResponse.FORBIDDEN('Auto-tagging requires a Pro subscription.')
    }

    const rl = await rateLimitAction('aiRequest', userId)
    if (rl) return rl as ApiBody<AutoTagData | null>

    try {
      const tags = await suggestTags({
        title: data.title,
        content: data.content,
      })
      
      return ApiResponse.OK({ tags })
    } catch (err) {
      return handleOpenAIError(err)
    }
  }, 'suggestTagsAction')
}
```

---

## 5. Streaming Pattern (Code Explanation)

### API Route: `src/app/api/ai/explain/route.ts`

API Routes handle the streaming data piping.

```ts
import { z } from 'zod'
import { ApiResponse, authenticatedRoute } from '@/lib/api'
import { explainCode } from '@/lib/ai/service'
import { rateLimitRoute, getRequestIP } from '@/lib/rate-limit'
import { createLogger } from '@/lib/logger'

const log = createLogger('ai-explain')

const bodySchema = z.object({
  content: z.string().trim().min(1).max(8000),
  language: z.string().trim().max(50).optional().nullable(),
})

export const POST = authenticatedRoute(async (request, _context, { isPro }) => {
  if (!isPro) {
    return ApiResponse.FORBIDDEN('Pro required')
  }

  const rl = await rateLimitRoute('aiRequest', getRequestIP(request))
  if (rl) return rl

  const json = await request.json()
  const result = bodySchema.safeParse(json)
  
  if (!result.success) {
    return ApiResponse.BAD_REQUEST('Invalid input')
  }

  try {
    const stream = await explainCode({
      content: result.data.content,
      language: result.data.language,
      signal: request.signal,
    })

    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content
          if (delta) {
            controller.enqueue(encoder.encode(delta))
          }
          if (chunk.usage) {
            log.info('Explain code tokens', { total: chunk.usage.total_tokens })
          }
        }
        controller.close()
      },
    })

    return new Response(readable, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  } catch (err) {
    log.error('Streaming API Error', err)
    return ApiResponse.INTERNAL_ERROR('Failed to generate explanation')
  }
})
```

---

## 6. Rate Limiting

Add `aiRequest` to the rate limit config in `src/lib/rate-limit.ts`:

```ts
export type RateLimitKey =
  | 'login'
  | 'api'
  | 'aiRequest'

const LIMIT_CONFIG: Record<RateLimitKey, LimitConfig> = {
  // ...existing
  aiRequest: { attempts: 20, window: '1 h' },
}
```

---

## 7. UI Patterns

### Loading States

```tsx
interface AiLoadingProps {
  isLoading: boolean
}

export function AiLoading({ isLoading }: AiLoadingProps) {
  if (!isLoading) return null

  return (
    <div className="flex items-center gap-2 text-muted-foreground text-sm">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>Thinking…</span>
    </div>
  )
}
```

### Accept / Reject Suggestions (Auto-tag)

```tsx
interface TagSuggestionsProps {
  tags: string[]
  onAddTag: (tag: string) => void
}

export function TagSuggestions({ tags, onAddTag }: TagSuggestionsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <button
          key={tag}
          type="button"
          onClick={() => onAddTag(tag)}
          className="badge badge-outline gap-1"
        >
          <Plus className="h-3 w-3" /> {tag}
        </button>
      ))}
    </div>
  )
}
```

### Streaming Text Display

```tsx
interface AiExplanationProps {
  explanation: string
  isStreaming: boolean
  onAbort: () => void
}

export function AiExplanation({ explanation, isStreaming, onAbort }: AiExplanationProps) {
  return (
    <div className="space-y-2">
      <pre className="whitespace-pre-wrap text-sm">{explanation}</pre>
      
      {isStreaming && (
        <div className="flex items-center gap-2">
          <span className="animate-pulse">|</span>
          <button 
            type="button" 
            onClick={onAbort} 
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Stop
          </button>
        </div>
      )}
    </div>
  )
}
```

---

## 8. Implementation Order

1. Structure scaffolding: Create `src/lib/ai/client.ts` and `src/lib/ai/service.ts`.
2. Integrate `aiRequest` rate limit key to `src/lib/rate-limit.ts`.
3. Build **Non-Streaming Feature**: Implement `suggestTags` logic in service, `suggestTagsAction` in `src/actions/ai.ts`, and wire the auto-tag UI.
4. Build **Non-Streaming Feature**: Implement `summarizeContent` logic.
5. Build **Non-Streaming Feature**: Implement `optimizePrompt` logic.
6. Build **Streaming Feature**: Implement `explainCode` in service, create `src/app/api/ai/explain/route.ts`, and wire the streaming UI.
