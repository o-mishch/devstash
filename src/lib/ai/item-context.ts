import { z } from 'zod'
import { formatBytes } from '@/lib/utils/format'
import { getFileExtension } from '@/lib/utils/files'
import { SYSTEM_TYPE_ORDER } from '@/lib/utils/constants'

export const itemTypeSchema = z.enum(SYSTEM_TYPE_ORDER as [string, ...string[]])

export const MAX_AI_FILE_SIZE_BYTES = 50_000_000

export const itemAiFileMetadataSchema = {
  fileSize: z.number().int().positive().max(MAX_AI_FILE_SIZE_BYTES).optional(),
}

export interface ItemAiContextInput {
  itemType: string
  title?: string
  content?: string
  url?: string
  language?: string
  fileName?: string
  fileSize?: number
  imageWidth?: number
  imageHeight?: number
}

export type ItemFileContext = Pick<ItemAiContextInput, 'itemType'> & {
  fileName?: string | null
  fileSize?: number | null
}

export function trimOptionalAiField(
  value: string | undefined,
  maxChars: number
): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, maxChars)
}

export function positiveOrUndefined(value: number | null | undefined): number | undefined {
  return value != null && value > 0 ? value : undefined
}

export function buildItemAiUserMessage(input: ItemAiContextInput): string {
  const lines = [`Item type: ${input.itemType}`]
  if (input.title) lines.push(`Title: ${input.title}`)
  if (input.language) lines.push(`Language: ${input.language}`)
  if (input.url) lines.push(`URL: ${input.url}`)
  if (input.fileName) {
    lines.push(`File name: ${input.fileName}`)
    const extension = getFileExtension(input.fileName)
    if (extension) lines.push(`File extension: ${extension}`)
  }
  if (input.fileSize != null) lines.push(`File size: ${formatBytes(input.fileSize)}`)
  if (input.imageWidth != null && input.imageHeight != null) {
    lines.push(`Image dimensions: ${input.imageWidth} × ${input.imageHeight} px`)
  }
  if (input.content) lines.push(`Content:\n${input.content}`)
  return lines.join('\n')
}
