import { z } from 'zod'

const tagSchema = z.string().trim().min(1).max(50)
const tagResponseSchema = z.union([
  z.object({ tags: z.array(tagSchema).max(5) }),
  z.array(tagSchema).max(5),
])

export const TAG_SYSTEM_PROMPT = `You are an expert tag generator for a developer knowledge base.
Your task is to suggest 3-5 highly relevant, concise, and specific tags based on the provided item type, title, file name, and content.
Return the result strictly as a JSON object with a single "tags" property containing an array of strings.
Example: { "tags": ["react", "hooks", "typescript"] }
Do not include any other text or properties.`

export function parseTagsResponse(responseContent: string): string[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(responseContent)
  } catch {
    return null
  }

  const result = tagResponseSchema.safeParse(parsed)
  if (!result.success) return null

  const tags = Array.isArray(result.data) ? result.data : result.data.tags
  return [...new Set(tags.map((tag) => tag.toLowerCase()))].slice(0, 5)
}
