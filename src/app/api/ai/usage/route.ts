import { authedRoute } from '@/lib/api/route'
import { json, problem } from '@/lib/api/http'
import { getAiUsage } from '@/lib/infra/rate-limit'

// Read-only AI usage meter. Unlike the POST /ai/* routes (which delegate the Pro gate to
// runProAiGeneration), this route does its own `isPro` 403 — and it carries NO `rateLimit` option:
// reading the budget must never consume a token. `getAiUsage` uses the non-consuming `getRemaining`
// and always fails open, so the widget never blocks or misleads the user. `userId` is from the
// session (IDOR-safe).
export const GET = authedRoute({}, async ({ userId, isPro }) => {
  if (!isPro) return problem(403, 'This feature requires a Pro subscription.')
  const features = await getAiUsage(userId)
  return json({ features })
})
