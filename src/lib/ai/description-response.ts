import { z } from 'zod'

export const ITEM_MAX_DESCRIPTION_CHARS = 280
export const COLLECTION_MAX_DESCRIPTION_CHARS = 500

const descriptionResponseSchema = z.union([
  z.object({ description: z.string().trim().min(1) }),
  z.string().trim().min(1),
])

function stripMarkdownCodeFence(text: string): string {
  const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i)
  return fenceMatch ? fenceMatch[1].trim() : text
}

export function parseAiDescriptionResponse(
  responseContent: string,
  maxChars: number
): string | null {
  const trimmed = stripMarkdownCodeFence(responseContent.trim())

  let parsed: unknown = trimmed
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return null
    }
  }

  const result = descriptionResponseSchema.safeParse(parsed)
  if (!result.success) return null

  const description =
    typeof result.data === 'string' ? result.data : result.data.description

  return description.slice(0, maxChars)
}

export function buildDescriptionOutputRules(maxChars: number): string {
  return `Write exactly 1-2 short sentences (maximum ${maxChars} characters total).
Be specific; avoid feature lists, marketing language, and markdown formatting.
Return the result strictly as a JSON object with a single "description" property containing a string.
Do not include any other text or properties.`
}

export function buildDescriptionSystemPrompt(
  role: string,
  guidance: string,
  example: string,
  maxChars: number
): string {
  return `You are an expert at writing concise descriptions for ${role} in a developer knowledge base.
${guidance}
${buildDescriptionOutputRules(maxChars)}
Example: ${example}`
}

export const ITEM_DESCRIPTION_SYSTEM_PROMPT = buildDescriptionSystemPrompt(
  'a developer knowledge base item',
  'Help the user quickly understand what this item is about.',
  '{ "description": "A Go utility that retries functions with exponential backoff and per-attempt timeouts." }',
  ITEM_MAX_DESCRIPTION_CHARS
)

export const COLLECTION_DESCRIPTION_SYSTEM_PROMPT = buildDescriptionSystemPrompt(
  'collections in a developer knowledge base',
  'Explain what kinds of items belong in this collection based on its name.',
  '{ "description": "Snippets and patterns for React hooks and component design." }',
  COLLECTION_MAX_DESCRIPTION_CHARS
)
