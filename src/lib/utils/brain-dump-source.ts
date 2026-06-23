import { SPLIT_FILE_ALLOWED_EXTS, BRAIN_DUMP_SOURCE_TAG } from './constants'

// The minimal item shape needed to decide parse-from-stash eligibility — satisfied by both LightItem
// and FullItem (drawer) without pulling the full type in.
export interface ParseSourceEligibilityInput {
  itemType: { name: string }
  fileName: string | null
  tags: string[]
}

/**
 * Coarse client-side gate for the "Parse with Brain Dump" affordance. Both eligible types must carry the
 * `brain-dump` tag (the user's explicit "mark this for parsing" signal): a tagged `note`, or a tagged
 * `file` whose name also ends in an allowed text extension (.txt/.md). This only decides whether to
 * *show* the action; the route re-validates and 422s on a truly ineligible source, so it is advisory,
 * not a security boundary.
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
