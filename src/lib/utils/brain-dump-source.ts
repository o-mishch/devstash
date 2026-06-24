import { BRAIN_DUMP_SOURCE_TAG, SPLIT_FILE_ALLOWED_EXTS } from '@/lib/utils/constants'

/**
 * The minimal item shape needed to decide parse-from-stash eligibility — satisfied by
 * both LightItem and FullItem (drawer) without pulling the full type in.
 */
export interface ParseSourceEligibilityInput {
  itemType: { name: string }
  fileName: string | null
  tags: string[]
}

/**
 * Client-side gate for "can this item be used as a Brain Dump source?". Advisory only, not a
 * security boundary — the server re-validates eligibility before acting. Eligible types: note
 * (any), file (only extensions defined in SPLIT_FILE_ALLOWED_EXTS). Item must also carry the
 * brain-dump source tag.
 */
export function isParseSourceEligible(item: ParseSourceEligibilityInput): boolean {
  if (!item.tags.includes(BRAIN_DUMP_SOURCE_TAG)) return false
  if (item.itemType.name === 'note') return true
  if (item.itemType.name === 'file') {
    const ext = item.fileName?.split('.').pop()?.toLowerCase() ?? ''
    return SPLIT_FILE_ALLOWED_EXTS.has(ext)
  }
  return false
}
