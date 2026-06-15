import { oc } from '@orpc/contract'
import { z } from 'zod'
import { itemTypeSchema, itemAiFileMetadataSchema, trimOptionalAiField } from '@/lib/ai/item-context'

const DESCRIPTION_MAX_INPUT_CHARS = 6000
const TAGS_MAX_INPUT_CHARS = 4000
const COLLECTION_NAME_MAX_CHARS = 100

const generateDescriptionInput = z
  .object({
    itemType: itemTypeSchema,
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

const generateTagsInput = z
  .object({
    itemType: itemTypeSchema,
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
  .refine(
    (data) => Boolean(data.title || data.fileName),
    { message: 'Provide a title or file name to suggest tags.' },
  )

const generateCollectionDescriptionInput = z
  .object({ name: z.string() })
  .transform((data) => ({ name: data.name.trim().slice(0, COLLECTION_NAME_MAX_CHARS) }))
  .refine((data) => data.name.length > 0, { message: 'Collection name is required' })

const descriptionOutput = z.object({ description: z.string() })

export const aiContract = {
  generateDescription: oc
    .route({ method: 'POST', path: '/ai/description' })
    .input(generateDescriptionInput)
    .output(descriptionOutput),

  generateTags: oc
    .route({ method: 'POST', path: '/ai/tags' })
    .input(generateTagsInput)
    .output(z.array(z.string())),

  generateCollectionDescription: oc
    .route({ method: 'POST', path: '/ai/collection-description' })
    .input(generateCollectionDescriptionInput)
    .output(descriptionOutput),
}
