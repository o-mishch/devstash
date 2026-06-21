import { authedRoute } from '@/lib/api/route'
import { json, problem } from '@/lib/api/http'
import { listParseSourceCandidates } from '@/lib/db/ai-parse-jobs'

// Lists the user's eligible text `file` items for the "Select from my files" picker. IDOR-scoped in the
// DB helper; spends no AI budget. (Prior paste notes are re-parsed via the `brain-dump` tag / re-parse.)
export const GET = authedRoute({}, async ({ userId, isPro }) => {
  if (!isPro) return problem(403, 'This feature requires a Pro subscription.')
  const sources = await listParseSourceCandidates(userId)
  return json({ sources })
})
