/**
 * During static prerendering Next.js aborts a completed prerender by rejecting
 * `headers()` (and other dynamic APIs) with an error carrying this digest. It is
 * a control-flow signal that React/Next.js handles upstream — not a real failure.
 *
 * Any `catch` that wraps session or dynamic-API reads must rethrow it instead of
 * swallowing it, or the prerender can't abort and the signal gets miscategorized
 * as an auth failure / 500.
 */
const PRERENDER_INTERRUPT_DIGEST = 'HANGING_PROMISE_REJECTION'

export function isPrerenderInterrupt(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    error.digest === PRERENDER_INTERRUPT_DIGEST
  )
}
