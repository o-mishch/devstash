import { z } from 'zod'
import { itemAiFileMetadataSchema, trimOptionalAiField } from '@/lib/ai/item-context'

// Request/response schemas for the AI endpoints (oRPC `oc.route()` wrappers stripped — bare Zod).
// The inputs keep their `.transform()` (trim/clamp) + `.refine()` (require some signal) so the route
// handler's parse normalizes and validates exactly as the contract did. [C].
//
// `itemType` is `z.string()` (not the system-type enum): item type is modeled as a free string
// across the app (SYSTEM_TYPE_ORDER is `string[]`), it only flavors the AI prompt (not a
// security/Pro boundary), and a plain string keeps the generated client type aligned with the app's
// uniform `string` typing instead of a stricter codegen-only literal union.

const DESCRIPTION_MAX_INPUT_CHARS = 6000
const TAGS_MAX_INPUT_CHARS = 4000
const COLLECTION_NAME_MAX_CHARS = 100

export const generateDescriptionInput = z
  .object({
    itemType: z.string(),
    itemId: z.string().optional(),
    title: z.string().optional(),
    content: z.string().optional(),
    url: z.string().optional(),
    language: z.string().optional(),
    fileName: z.string().optional(),
    ...itemAiFileMetadataSchema,
  })
  .transform((data) => ({
    itemType: data.itemType,
    itemId: data.itemId,
    title: trimOptionalAiField(data.title, DESCRIPTION_MAX_INPUT_CHARS),
    content: trimOptionalAiField(data.content, DESCRIPTION_MAX_INPUT_CHARS),
    url: trimOptionalAiField(data.url, DESCRIPTION_MAX_INPUT_CHARS),
    language: trimOptionalAiField(data.language, 100),
    fileName: trimOptionalAiField(data.fileName, 255),
    fileSize: data.fileSize,
  }))
  .refine(
    (data) => Boolean(data.title || data.content || data.url || data.fileName),
    { message: 'Provide a title, content, URL, or file name to generate a description.' },
  )

export const generateTagsInput = z
  .object({
    itemType: z.string(),
    itemId: z.string().optional(),
    title: z.string().optional(),
    content: z.string().optional(),
    fileName: z.string().optional(),
    ...itemAiFileMetadataSchema,
  })
  .transform((data) => ({
    itemType: data.itemType,
    itemId: data.itemId,
    title: trimOptionalAiField(data.title, TAGS_MAX_INPUT_CHARS),
    content: trimOptionalAiField(data.content, TAGS_MAX_INPUT_CHARS),
    fileName: trimOptionalAiField(data.fileName, 255),
    fileSize: data.fileSize,
  }))
  .refine((data) => Boolean(data.title || data.fileName), {
    message: 'Provide a title or file name to suggest tags.',
  })

export const generateCollectionDescriptionInput = z
  .object({ name: z.string() })
  .transform((data) => ({ name: data.name.trim().slice(0, COLLECTION_NAME_MAX_CHARS) }))
  .refine((data) => data.name.length > 0, { message: 'Collection name is required' })

// Explain a code item the user already owns: only the item id is sent — the route reads the
// canonical content/language/type from the DB (scoped to the session userId), so the client never
// re-uploads the code and the server never trusts client-supplied content.
export const explainCodeInput = z.object({
  itemId: z.string().trim().min(1),
})

// Shared `{ description }` response — reused by item + collection description, so `.meta({ id })`
// emits a single $ref component.
export const aiDescriptionOutput = z.object({ description: z.string() }).meta({ id: 'AiDescription' })

export const aiExplanationOutput = z.object({ explanation: z.string() }).meta({ id: 'AiExplanation' })

export const aiTagsOutput = z.array(z.string())
