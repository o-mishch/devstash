import { z } from 'zod'
import { ITEM_DESCRIPTION_MAX_CHARS } from '@/lib/utils/constants'
import { stripMarkdownCodeFence } from '@/lib/ai/markdown'

// Pure response parser + system prompt for the code-explanation endpoint — mirrors
// `description-response.ts`. No `server-only` import: it carries no secrets and is the shared
// parser exception, imported by the route handler. [C].

const explanationResponseSchema = z.union([
  z.object({ explanation: z.string().trim().min(1) }),
  z.string().trim().min(1),
])

/** Parses the model output (raw Markdown, or a `{ explanation }` JSON object) and clamps it. */
export function parseAiExplanationResponse(responseContent: string): string | null {
  const trimmed = stripMarkdownCodeFence(responseContent)

  let parsed: unknown = trimmed
  if (trimmed.startsWith('{')) {
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return null
    }
  }

  const result = explanationResponseSchema.safeParse(parsed)
  if (!result.success) return null

  const explanation =
    typeof result.data === 'string' ? result.data : result.data.explanation

  return explanation.slice(0, ITEM_DESCRIPTION_MAX_CHARS)
}

export const CODE_EXPLANATION_SYSTEM_PROMPT = `You are an expert developer explaining code in a developer knowledge base.
Write a concise explanation (roughly 200-300 words) of what the code does and the key concepts or techniques it uses.
Use clear, plain language and light Markdown — a short lead sentence, then a few bullet points covering the important parts. Do not restate the code line by line, and do not wrap the whole answer in a code fence.
Keep the result under ${ITEM_DESCRIPTION_MAX_CHARS} characters.`
