import { authedRoute } from '@/lib/api/route'
import { json, problem, parseOr422 } from '@/lib/api/http'
import { brainDumpSourceQuery } from '@/lib/api/schemas/ai'
import { listParseSourceCandidates } from '@/lib/db/ai-parse-jobs'

// Lists the user's eligible durable stash items for the "Select from my stash" picker. `?type=file`
// (default) lists text `file`s; `?type=content` lists `brain-dump`-tagged text-content items.
// IDOR-scoped in the DB helper; spends no AI budget.
export const GET = authedRoute({}, async ({ userId, isPro, request }) => {
  // Validate the query before the Pro gate — matches the documented schema→Pro order (api-contract.md)
  // and the sibling POST /ai/brain-dump.
  const parsed = parseOr422(brainDumpSourceQuery, Object.fromEntries(request.nextUrl.searchParams))
  if (!parsed.ok) return parsed.res
  if (!isPro) return problem(403, 'This feature requires a Pro subscription.')
  const sources = await listParseSourceCandidates(userId, parsed.data.type)
  return json({ sources })
})
