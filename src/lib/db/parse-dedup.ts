import 'server-only'
import { prisma } from '@/lib/infra/prisma'

// Advisory de-dup: flags review-board drafts that look like an item already in the user's stash, so the
// card can show a non-blocking "possible duplicate" badge linking to the existing item. Detection only
// — it never auto-trashes a draft or blocks a commit. Intentionally uncached (draft/streaming surface;
// must reflect the latest committed stash).

// The minimal draft fields the matcher reads.
export interface DedupDraftInput {
  id: string
  title: string
  content: string | null
}

// The minimal committed-item fields the matcher compares against.
export interface DedupCandidateItem {
  id: string
  title: string
  content: string | null
  itemTypeName: string
}

// The existing item a draft duplicates: id + type build the `/items/[type]?item=<id>` deep-link, title
// labels the badge tooltip.
export interface DuplicateMatch {
  id: string
  title: string
  itemTypeName: string
}

// Title comparisons are normalized so trivial whitespace/case differences still match. Content uses a
// raw case-insensitive substring test (mirrors globalSearch's `contains`) — only normalized for case.
function normalizeTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

// Below this many non-blank characters a draft's content is too short to make a substring match
// meaningful (e.g. "ok", "TODO") — title match still applies. Bounds false positives.
const MIN_CONTENT_MATCH_CHARS = 12

// Upper bound on the content length compared per string. The bidirectional `.includes()` scan runs over
// up to ~100 drafts × 500 items on the hot snapshot path; capping the compared prefix keeps a power
// user's large bodies from spiking CPU. Advisory feature, so an exact-but-beyond-prefix match is an
// acceptable miss.
const MAX_CONTENT_COMPARE_CHARS = 2000

/**
 * Pure matcher: for each draft, find the first committed item it duplicates — normalized-title equality
 * OR (for long-enough content) a case-insensitive substring match in either direction (the draft's
 * content contains the item's, or the item's contains the draft's). Returns a Map keyed by draft id;
 * drafts with no match are absent. No DB access — testable in isolation.
 */
export function matchDraftsToItems(
  drafts: DedupDraftInput[],
  items: DedupCandidateItem[],
): Map<string, DuplicateMatch> {
  const matches = new Map<string, DuplicateMatch>()
  if (items.length === 0) return matches

  // Precompute item keys once so the per-draft scan is O(drafts × items) on already-normalized values.
  // `contentMatchable` bounds the item side the same way the draft side is bounded below: a trivially
  // short item content ("ok", "123") would substring-match any longer draft and produce a spurious badge.
  const normalizedItems = items.map((item) => {
    const normContent = item.content ? item.content.trim().toLowerCase().slice(0, MAX_CONTENT_COMPARE_CHARS) : ''
    return {
      id: item.id,
      title: item.title,
      itemTypeName: item.itemTypeName,
      normTitle: normalizeTitle(item.title),
      normContent,
      contentMatchable: normContent.replace(/\s/g, '').length >= MIN_CONTENT_MATCH_CHARS,
    }
  })

  drafts.forEach((draft) => {
    const draftTitle = normalizeTitle(draft.title)
    const draftContent = draft.content ? draft.content.trim().toLowerCase().slice(0, MAX_CONTENT_COMPARE_CHARS) : ''
    const contentMatchable = draftContent.replace(/\s/g, '').length >= MIN_CONTENT_MATCH_CHARS

    const hit = normalizedItems.find((item) => {
      if (draftTitle && item.normTitle === draftTitle) return true
      if (!contentMatchable || !item.contentMatchable) return false
      return draftContent.includes(item.normContent) || item.normContent.includes(draftContent)
    })
    if (hit) matches.set(draft.id, { id: hit.id, title: hit.title, itemTypeName: hit.itemTypeName })
  })

  return matches
}

// Hard cap on committed items scanned per snapshot — keeps the single fetch + in-memory match bounded
// for power users with large stashes (advisory feature, not exhaustive).
const DEDUP_CANDIDATE_LIMIT = 500

/**
 * Resolves duplicate matches for a job's drafts against the user's committed items in ONE batched,
 * IDOR-scoped query (no N+1). Returns a Map keyed by draft id; absent ids have no duplicate. Returns an
 * empty Map when there are no drafts to check. The job's own `sourceItemId` (when set) is excluded —
 * a paste/select source persists the *whole* text as one item, so every draft would otherwise substring-
 * match it and get a spurious badge.
 */
export async function findDuplicateMatches(
  userId: string,
  drafts: DedupDraftInput[],
  sourceItemId: string | null,
): Promise<Map<string, DuplicateMatch>> {
  if (drafts.length === 0) return new Map()
  const items = await prisma.item.findMany({
    where: { userId, ...(sourceItemId ? { id: { not: sourceItemId } } : {}) },
    select: { id: true, title: true, content: true, itemType: { select: { name: true } } },
    orderBy: { updatedAt: 'desc' },
    take: DEDUP_CANDIDATE_LIMIT,
  })
  const candidates: DedupCandidateItem[] = items.map((item) => ({
    id: item.id,
    title: item.title,
    content: item.content,
    itemTypeName: item.itemType.name,
  }))
  return matchDraftsToItems(drafts, candidates)
}
