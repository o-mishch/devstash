// Per-id outcome of a bulk fan-out, so the board can revert/keep exactly the ids that failed.
export interface BulkDraftResult {
  succeeded: string[]
  failed: string[]
}

// Bounds fan-out concurrency: firing all bulk requests at once would swamp the connection pool.
// Runs them in fixed-size waves instead.
const BULK_CONCURRENCY = 8

/**
 * Runs `task` over every id in capped-concurrency waves, collecting per-id success/failure. A task
 * resolving false (or throwing) marks that id failed; the call itself never rejects.
 *
 * Note: a benign skip (`task` resolving false — e.g. the atomic commit's 0-row delete-guard meaning
 * "already taken by another tab, nothing to do") and a real throw are deliberately collapsed into the
 * same `failed[]`. The board only needs to know which ids to revert/keep, not why; it does not surface a
 * skip-vs-error distinction. If a caller ever needs that, return a third `skipped[]` bucket here.
 */
export async function runBulk(ids: string[], task: (id: string) => Promise<boolean>): Promise<BulkDraftResult> {
  const succeeded: string[] = []
  const failed: string[] = []
  // Walk the ids in fixed-size waves: each wave must settle before the next starts (bounded concurrency),
  // hence the await in the loop body — the sanctioned for-loop exception to "prefer array methods".
  for (let start = 0; start < ids.length; start += BULK_CONCURRENCY) {
    const wave = ids.slice(start, start + BULK_CONCURRENCY)
    const settled = await Promise.allSettled(wave.map((id) => task(id)))
    settled.forEach((result, index) => {
      const id = wave[index]
      if (result.status === 'fulfilled' && result.value) succeeded.push(id)
      else failed.push(id)
    })
  }
  return { succeeded, failed }
}
