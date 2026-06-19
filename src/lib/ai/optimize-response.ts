import { z } from 'zod'
import { OPTIMIZE_MAX_OUTPUT_CHARS } from '@/lib/utils/constants'
import { stripMarkdownCodeFence } from '@/lib/ai/markdown'

// Pure response parser + system prompt for the prompt-optimization endpoint — mirrors
// `explain-response.ts`. No `server-only` import: it carries no secrets and is the shared parser
// exception, imported by the route handler. [C].

const optimizedPromptResponseSchema = z.union([
  z.object({ prompt: z.string().trim().min(1) }),
  z.string().trim().min(1),
])

/** Parses the model output (raw Markdown, or a `{ prompt }` JSON object) and clamps it. */
export function parseAiOptimizedPromptResponse(responseContent: string): string | null {
  const trimmed = stripMarkdownCodeFence(responseContent)

  let parsed: unknown = trimmed
  if (trimmed.startsWith('{')) {
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return null
    }
  }

  const result = optimizedPromptResponseSchema.safeParse(parsed)
  if (!result.success) return null

  const prompt = typeof result.data === 'string' ? result.data : result.data.prompt

  return prompt.slice(0, OPTIMIZE_MAX_OUTPUT_CHARS)
}

export const PROMPT_OPTIMIZATION_SYSTEM_PROMPT = `You are an expert prompt engineer improving prompts in a developer knowledge base.
Rewrite the given prompt so it is clearer, more specific, and more likely to produce high-quality results from a large language model.
Preserve the original intent and any concrete requirements, but sharpen the instructions: state the desired role and task plainly, make implicit expectations explicit, structure multi-part requests, and remove ambiguity and filler.
Format the rewritten prompt as well-structured, rich Markdown: use section headings, bold for key terms, and bullet or numbered lists to organize requirements, constraints, and steps. Use fenced code blocks only for literal code, examples, or placeholders within the prompt — never wrap the whole answer in a code fence.
Return only the rewritten prompt — no preamble, no commentary, and no explanation of your changes.
Keep the result under ${OPTIMIZE_MAX_OUTPUT_CHARS} characters.`
