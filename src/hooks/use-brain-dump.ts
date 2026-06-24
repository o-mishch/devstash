'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { api, $api } from '@/lib/api/client'
import { useAiMutation } from '@/hooks/use-ai-usage'
import { useInvalidate } from '@/hooks/use-cache-invalidation'
import { useUpgradePromptStore } from '@/stores/upgrade-prompt'
import { SPLIT_FILE_MAX_INPUT_CHARS } from '@/lib/utils/constants'
import { runBulk } from '@/lib/utils/run-bulk'
import type { BulkDraftResult } from '@/lib/utils/run-bulk'
import type { components, paths } from '@/types/openapi'

// Shared upgrade-prompt copy for every Brain Dump entry point (card + the stash "Parse with Brain
// Dump" affordance) so the Pro gate reads identically wherever a non-Pro user hits it.
export const BRAIN_DUMP_UPGRADE_PROMPT = {
  title: 'Brain Dump is a Pro feature',
  description: 'Upgrade to split a long file into ready-to-save items with AI.',
}

// The PATCH contract narrows itemTypeName to the five text buckets; BrainDumpDraftItem types it as a plain
// `string` (app-wide), so the board's already-validated patch is cast to the route's body shape.
type DraftPatchBody = NonNullable<
  paths['/ai/brain-dump/{jobId}/items/{itemId}']['patch']['requestBody']
>['content']['application/json']

// Client hooks for the AI File Splitter (Brain Dump). The live stream uses a native EventSource (same-origin, the
// session cookie rides along automatically); the create/patch/delete/commit calls go through the
// typed `api` client per the API-contract rule.

export type BrainDumpDraftItem = components['schemas']['BrainDumpDraftItem']
export type BrainDumpJobSummary = components['schemas']['BrainDumpJobSummary']
export type BrainDumpSource = components['schemas']['BrainDumpSource']
export type BrainDumpJobStatus = 'processing' | 'completed' | 'failed' | 'closed'

// Single source of truth for the human-facing status wording, shared by every surface that shows a job's
// state (the /parse list badge, the dashboard widget pill). The enum value `completed` means "AI finished,
// your turn to review" — not "the whole job is done" — so it reads "Ready to review" to make the hand-off
// explicit rather than as a terminal state. `closed` is post-commit history (never in the active list).
export const BRAIN_DUMP_STATUS_LABEL: Record<BrainDumpJobStatus, string> = {
  processing: 'In progress',
  completed: 'Ready to review',
  failed: 'Failed',
  closed: 'Saved',
}
// The single derived progress-card phase, named as variants of the underlying status so each phase reads
// 1:1 against `BrainDumpJobStatus`. The live `processing` status splits into `processing-active` (reader
// attached, drafts streaming) and `processing-paused` (interrupted run the user can resume); the two
// review-terminal statuses map straight through (`completed`/`failed`). `closed` is NOT a phase — a
// closed job is post-commit history and renders its own board branch (History banner), never the card.
export type BrainDumpPhase =
  | 'processing-active'
  | 'processing-reconnecting'
  | 'processing-paused'
  | 'completed'
  | 'failed'

export interface CreateBrainDumpResult {
  ok: boolean
  jobId?: string
  // The persisted source label + whether the parse window was truncated — surfaced in the post-create toast.
  sourceName?: string | null
  truncated?: boolean
  message?: string
  status?: number
}

// Exactly one of `text` (paste) or `sourceItemId` (upload/select an existing item).
export interface CreateBrainDumpInput {
  text?: string
  sourceItemId?: string
}

/** POST /ai/brain-dump — starts a job, returns its id (or a typed failure for 403/422/429). */
export function useCreateBrainDumpJob() {
  const runAi = useAiMutation()
  const invalidateJobs = useInvalidateBrainDumpJobs()
  return useCallback(
    async (input: CreateBrainDumpInput): Promise<CreateBrainDumpResult> => {
      const { data, error, response } = await runAi('/ai/brain-dump', input)
      if (error || !data) {
        return { ok: false, message: error?.message ?? 'Failed to start the split.', status: response?.status }
      }
      // A freshly created job must show up in the active-jobs list. Callers navigate straight to the new
      // board (the list is unmounted), so mark it stale here; it refetches when the user returns to /parse
      // — without this, a return within the 5-min staleTime can show the new job missing.
      invalidateJobs()
      return { ok: true, jobId: data.jobId, sourceName: data.sourceName, truncated: data.truncated }
    },
    [runAi, invalidateJobs],
  )
}

/**
 * Starts a Brain Dump job from an existing stash item (the "Parse with Brain Dump" affordance) and
 * routes to its review board. Encapsulates the shared finish flow — a 403 opens the upgrade prompt, a
 * success toasts (noting truncation) and navigates to `/parse/[jobId]` — so callers only pass the
 * source id. Spends the hourly token (a new job); Pro-gate the trigger UI separately.
 */
export function useStartBrainDumpFromSource() {
  const createJob = useCreateBrainDumpJob()
  const router = useRouter()
  const { openPrompt } = useUpgradePromptStore()
  return useCallback(
    async (sourceItemId: string): Promise<CreateBrainDumpResult> => {
      const result = await createJob({ sourceItemId })
      if (!result.ok) {
        if (result.status === 403) openPrompt(BRAIN_DUMP_UPGRADE_PROMPT)
        else toast.error(result.message ?? 'Could not start the split.')
        return result
      }
      const label = result.sourceName ? `“${result.sourceName}”` : 'your source'
      toast.success(
        result.truncated
          ? `Parsing ${label} — the first ${SPLIT_FILE_MAX_INPUT_CHARS.toLocaleString()} characters were parsed.`
          : `Started parsing ${label}.`,
      )
      router.push(`/parse/${result.jobId}`)
      return result
    },
    [createJob, router, openPrompt],
  )
}

/** Re-reads an existing job's durable source and starts a fresh, separately metered parse job. */
export function useReparseBrainDumpJob() {
  const runAi = useAiMutation()
  return useCallback(
    async (jobId: string): Promise<CreateBrainDumpResult> => {
      // Re-parse takes no request body — only the `jobId` path param.
      const { data, error, response } = await runAi(
        '/ai/brain-dump/{jobId}/re-parse',
        undefined,
        { path: { jobId } },
      )
      if (error || !data) {
        return { ok: false, message: error?.message ?? 'Failed to re-parse the source.', status: response?.status }
      }
      return { ok: true, jobId: data.jobId, sourceName: data.sourceName, truncated: data.truncated }
    },
    [runAi],
  )
}

/**
 * Lists the user's eligible source items for the picker (Pro-gated by caller). `type` selects the tab:
 * `file` → text `file`s ("My files"), `content` → `brain-dump`-tagged content items ("Items").
 */
export function useBrainDumpSources(enabled: boolean, type: 'file' | 'content' = 'file') {
  return $api.useQuery(
    'get',
    '/ai/brain-dump/sources',
    { params: { query: { type } } },
    // No staleTime: the picker mounts only when its tab is selected, and a source's eligibility changes
    // out-of-band (e.g. adding the `brain-dump` tag to an item elsewhere) without touching this query's
    // cache. `refetchOnMount: 'always'` re-reads on every tab (re)selection so a freshly-tagged item
    // appears without a full page reload. The list is cheap and advisory, so the extra fetch is cheap.
    { enabled, refetchOnMount: 'always' },
  )
}

/**
 * The single place that touches `queryClient` for the Brain Dump source-picker cache. Returns a
 * fire-and-forget invalidator covering BOTH tabs (`file` and `content`), matched by path prefix so it
 * hits every `type` variant of the key. A source's eligibility changes out-of-band — adding/removing
 * the `brain-dump` tag on an item or file flows through `useUpdateItem`, which never touches this query
 * — so the item-edit flow calls this after a successful PATCH to drop the stale picker list. With the
 * default `refetchType: 'active'` it is a true no-op when no picker is mounted, so callers invoke it
 * unconditionally.
 */
export function useInvalidateBrainDumpSources(): () => void {
  const invalidate = useInvalidate()
  return useCallback(() => invalidate('brainDumpSources'), [invalidate])
}

/** DELETE /ai/brain-dump/{jobId} — discard a job (keeps the source item; cancels the run if processing). */
export function useDiscardBrainDumpJob() {
  const { mutateAsync } = useMutation({
    mutationFn: async (jobId: string): Promise<boolean> => {
      const { error } = await api.DELETE('/ai/brain-dump/{jobId}', { params: { path: { jobId } } })
      return !error
    },
  })
  return useCallback((jobId: string) => mutateAsync(jobId), [mutateAsync])
}

/** Lists the user's in-progress jobs; polls while any are still processing. */
export function useActiveBrainDumpJobs() {
  // init `undefined` (not `{}`) so the observed key is `['get','/ai/brain-dump']`, consistent with the
  // other param-less reads. The brainDumpJobs predicate matches on `key[1]` regardless, and the closed
  // list keys distinctly via its `history` query param — so the two lists never collide.
  return $api.useQuery(
    'get',
    '/ai/brain-dump',
    undefined,
    {
      refetchInterval: (query) =>
        query.state.data?.jobs.some((job) => job.status === 'processing') ? 4000 : false,
    },
  )
}

/** Lists the user's `closed` history jobs (post-commit stubs) for the /parse History section. */
export function useClosedBrainDumpJobs() {
  return $api.useQuery('get', '/ai/brain-dump', { params: { query: { history: '1' } } })
}

/**
 * Invalidates both job lists (active + History) so a delete/close/commit refreshes them. Lives in the
 * hook file per the cache-updater rule — components call this rather than `useQueryClient()` directly.
 */
export function useInvalidateBrainDumpJobs(): () => void {
  const invalidate = useInvalidate()
  return useCallback(() => invalidate('brainDumpJobs'), [invalidate])
}

export interface BrainDumpStreamState {
  items: BrainDumpDraftItem[]
  status: BrainDumpJobStatus
  progress: number
  error: string | null
  // True when an interrupted background run exists and the user can resume it.
  resumable: boolean
  // True when the run finished but its tail wasn't parsed (input window or output token cap) — the
  // board discloses it live, mirroring the persisted notice the source banner shows on reload.
  truncated: boolean
  // Closed-job history stub stats (0/null until the job is closed) — for the History banner.
  committedCount: number
  committedByType: Record<string, number> | null
  // Derived once here so the UI has a single phase to switch on (no parallel re-derivation).
  phase: BrainDumpPhase
  resume: () => void
  applyPatch: (itemId: string, patch: Partial<BrainDumpDraftItem>) => void
  removeItem: (itemId: string) => void
}

interface DoneEventData {
  status: BrainDumpJobStatus
  truncated?: boolean
}
interface SnapshotEventData {
  status: BrainDumpJobStatus
  progress: number
  error?: string | null
  truncated?: boolean
  // Closed-job stub stats for the History banner (null/absent on in-review jobs).
  committedCount?: number
  committedByType?: Record<string, number> | null
  items: BrainDumpDraftItem[]
}
interface ProgressEventData {
  progress: number
  count: number
}
interface ServerErrorEventData {
  message: string
}

export interface BrainDumpStreamSeed {
  status: BrainDumpJobStatus
  progress: number
  error: string | null
  truncated: boolean
  committedCount: number
  committedByType: Record<string, number> | null
  items: BrainDumpDraftItem[]
}

/**
 * Opens the SSE stream for a job: seeds from the `snapshot` event (refresh-resume), appends each
 * `item`, tracks `progress`, and finalizes on `done`/`error`. `resume()` reconnects with `?resume=1`
 * to continue an interrupted background run from its cursor. Exposes local mutators the board uses to
 * reflect optimistic edits/deletes/reclassifications.
 *
 * Pass `initialSnapshot` (from the server-fetched snapshot) to pre-populate state on mount and avoid
 * the brief intermediate flash where the hook defaults to `processing`/empty before the SSE snapshot
 * event fires.
 */
// Max automatic reconnect attempts before we surface a manual Resume CTA.
const MAX_AUTO_RECONNECTS = 3
// If no SSE event (including heartbeat) arrives within this window, the pipe is dead.
const HEARTBEAT_TIMEOUT_MS = 25_000

export function useBrainDumpStream(jobId: string, initialSnapshot?: BrainDumpStreamSeed): BrainDumpStreamState {
  const [items, setItems] = useState<BrainDumpDraftItem[]>(() => initialSnapshot?.items ?? [])
  const [status, setStatus] = useState<BrainDumpJobStatus>(() => initialSnapshot?.status ?? 'processing')
  const [progress, setProgress] = useState(() =>
    initialSnapshot ? (initialSnapshot.status === 'processing' ? initialSnapshot.progress : 100) : 0,
  )
  const [error, setError] = useState<string | null>(() => initialSnapshot?.error ?? null)
  const [resumable, setResumable] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [truncated, setTruncated] = useState(() => initialSnapshot?.truncated ?? false)
  const [committedCount, setCommittedCount] = useState(() => initialSnapshot?.committedCount ?? 0)
  const [committedByType, setCommittedByType] = useState<Record<string, number> | null>(
    () => initialSnapshot?.committedByType ?? null,
  )
  // Bumping this re-runs the effect to (re)connect; resumeRef carries the ?resume=1 intent.
  const [reconnectTick, setReconnectTick] = useState(0)
  const resumeRef = useRef(false)
  // Counts consecutive auto-reconnect attempts; reset to 0 on successful data receipt.
  const autoReconnectRef = useRef(0)

  // Shows the manual Resume CTA and freezes the progress bar — called only when the bounded auto-reconnect
  // budget is exhausted or a server-sent error closes the job definitively.
  const markResumable = useCallback(() => {
    setResumable(true)
    setReconnecting(false)
    setProgress(100)
  }, [])

  // User-initiated resume: resets the auto-reconnect budget so the next interruption gets a fresh set of
  // attempts. A freshly-constructed EventSource sends no `Last-Event-ID` header, so the manual path signals
  // resume with `?resume=1` (consumed in the effect); the server resumes from the DB cursor either way.
  const resume = useCallback(() => {
    autoReconnectRef.current = 0
    resumeRef.current = true
    setResumable(false)
    setReconnecting(false)
    setReconnectTick((tick) => tick + 1)
  }, [])

  const applyPatch = useCallback((itemId: string, patch: Partial<BrainDumpDraftItem>) => {
    setItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, ...patch } : item)))
  }, [])

  const removeItem = useCallback((itemId: string) => {
    setItems((prev) => prev.filter((item) => item.id !== itemId))
  }, [])

  useEffect(() => {
    // Consume the resume flag immediately so the cleanup doesn't race-reset it before this effect reads it.
    const wantResume = resumeRef.current
    resumeRef.current = false
    const url = `/api/ai/brain-dump/${jobId}/stream${wantResume ? '?resume=1' : ''}`
    const source = new EventSource(url, { withCredentials: true })

    // A single malformed SSE frame must never throw uncaught inside a listener — that would freeze the
    // stream with the spinner up. Returns null so the handler skips that frame instead of crashing.
    const parseFrame = <T,>(event: Event): T | null => {
      try {
        return JSON.parse((event as MessageEvent).data) as T
      } catch {
        return null
      }
    }

    // Heartbeat watchdog: native EventSource won't notice a silently half-open socket (a proxy holding the
    // connection open with no data) for minutes. If nothing — not even a heartbeat — arrives within
    // HEARTBEAT_TIMEOUT_MS, force-close and rebuild a fresh resume connection (counts against the budget).
    let heartbeatTimer: ReturnType<typeof setTimeout> | null = null
    const clearHeartbeat = () => {
      if (heartbeatTimer) clearTimeout(heartbeatTimer)
      heartbeatTimer = null
    }
    const resetHeartbeat = () => {
      clearHeartbeat()
      heartbeatTimer = setTimeout(() => {
        source.close()
        autoReconnectRef.current += 1
        if (autoReconnectRef.current > MAX_AUTO_RECONNECTS) {
          markResumable()
        } else {
          // A new EventSource sends no Last-Event-ID, so the forced rebuild resumes via ?resume=1.
          setReconnecting(true)
          resumeRef.current = true
          setReconnectTick((tick) => tick + 1)
        }
      }, HEARTBEAT_TIMEOUT_MS)
    }
    resetHeartbeat() // start watchdog immediately on connection open

    // Real streaming data proves the connection is healthy: clear the reconnecting flag and refill the
    // auto-reconnect budget so the NEXT interruption gets a full set of attempts.
    const onData = () => {
      autoReconnectRef.current = 0
      setReconnecting(false)
      resetHeartbeat()
    }

    source.addEventListener('open', () => resetHeartbeat())
    source.addEventListener('heartbeat', () => resetHeartbeat())
    source.addEventListener('snapshot', (event) => {
      // The snapshot is replayed on EVERY (re)connect, so it clears the reconnecting flag but does NOT
      // refill the budget here — a lock-contention bounce also replays the snapshot without real progress,
      // and refilling on it would let that loop reconnect forever instead of surfacing the manual CTA.
      resetHeartbeat()
      setReconnecting(false)
      const snap = parseFrame<SnapshotEventData>(event)
      if (!snap) return
      setItems(snap.items)
      setStatus(snap.status)
      // A terminal snapshot (resume/reload of an already-finished job) pins the bar at 100 even if the
      // stored progress heuristic stopped short, so a completed board never shows a mid-fill bar.
      setProgress(snap.status === 'processing' ? snap.progress : 100)
      setError(snap.error ?? null)
      if (snap.truncated) setTruncated(true)
      setCommittedCount(snap.committedCount ?? 0)
      setCommittedByType(snap.committedByType ?? null)
    })
    source.addEventListener('item', (event) => {
      const item = parseFrame<BrainDumpDraftItem>(event)
      if (!item) return
      onData()
      setItems((prev) => (prev.some((existing) => existing.id === item.id) ? prev : [...prev, item]))
    })
    source.addEventListener('progress', (event) => {
      const data = parseFrame<ProgressEventData>(event)
      if (!data) return
      onData()
      setProgress(data.progress)
    })
    source.addEventListener('resumable', () => {
      resetHeartbeat()
      setResumable(true)
    })
    source.addEventListener('done', (event) => {
      const data = parseFrame<DoneEventData>(event)
      if (!data) {
        // Unparseable terminal frame — stop and surface the manual CTA rather than freeze the spinner.
        clearHeartbeat()
        source.close()
        markResumable()
        return
      }
      if (data.status === 'processing') {
        // Server closed its side but the background run continues (60 s Vercel cutoff, lock contention).
        // Leave the source OPEN so native EventSource auto-reconnects, re-sending Last-Event-ID — the
        // `error` handler below counts that attempt. Just reflect the reconnecting state immediately.
        setReconnecting(true)
        return
      }
      // Terminal (completed/failed/closed) — stop native reconnect.
      clearHeartbeat()
      setStatus(data.status)
      setProgress(100)
      if (data.truncated) setTruncated(true)
      source.close()
    })
    source.addEventListener('error', (event) => {
      // A native EventSource error is a plain Event (no `.data`); only a server-sent named error frame is
      // a MessageEvent carrying a payload. Guard on the instance instead of casting a non-MessageEvent.
      const data = event instanceof MessageEvent && event.data ? parseFrame<ServerErrorEventData>(event) : null
      if (data) {
        // Server explicitly reported a job failure — don't reconnect, surface the error.
        clearHeartbeat()
        setError(data.message)
        setStatus('failed')
        setProgress(100)
        source.close()
        return
      }
      // Native connection drop. readyState CONNECTING ⇒ the browser is already auto-reconnecting
      // (re-sending Last-Event-ID); CLOSED ⇒ it gave up (e.g. a non-2xx response). Supervise the native
      // retry: count attempts, show the reconnecting state, and fall back to the manual CTA past the budget.
      autoReconnectRef.current += 1
      if (autoReconnectRef.current > MAX_AUTO_RECONNECTS || source.readyState === EventSource.CLOSED) {
        clearHeartbeat()
        source.close()
        markResumable()
      } else {
        setReconnecting(true)
        resetHeartbeat() // fresh watchdog window for the in-flight native reconnect
      }
    })

    return () => {
      clearHeartbeat()
      source.close()
    }
  }, [jobId, reconnectTick, markResumable])

  return {
    items,
    status,
    progress,
    error,
    resumable,
    truncated,
    committedCount,
    committedByType,
    // A closed job never renders the progress card (the board branches to History first), so its phase is
    // unused; fall back to `completed` for the type rather than widening BrainDumpPhase with a non-phase.
    phase: status === 'closed' ? 'completed' : derivePhase(status, resumable, reconnecting),
    resume,
    applyPatch,
    removeItem,
  }
}

// Single classification of the live progress-card phase. Only called for in-review statuses — a `closed`
// job renders the History board branch, never the progress card, so it has no phase. A review-terminal
// status (`completed`/`failed`) maps 1:1; priority for `processing`: paused (user action needed) >
// reconnecting (auto-reconnect in progress) > active (streaming normally).
function derivePhase(
  status: Exclude<BrainDumpJobStatus, 'closed'>,
  resumable: boolean,
  reconnecting: boolean,
): BrainDumpPhase {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (resumable) return 'processing-paused'
  if (reconnecting) return 'processing-reconnecting'
  return 'processing-active'
}

export interface PatchResult {
  ok: boolean
  item?: BrainDumpDraftItem
}

interface PatchDraftVariables {
  jobId: string
  itemId: string
  patch: Partial<BrainDumpDraftItem>
}

/** PATCH a draft (reclassify/edit). */
export function usePatchBrainDumpDraftItem() {
  const { mutateAsync } = useMutation({
    mutationFn: async ({ jobId, itemId, patch }: PatchDraftVariables): Promise<PatchResult> => {
      const { data, error } = await api.PATCH('/ai/brain-dump/{jobId}/items/{itemId}', {
        params: { path: { jobId, itemId } },
        body: patch as DraftPatchBody,
      })
      if (error || !data) return { ok: false }
      return { ok: true, item: data }
    },
  })
  return useCallback(
    (jobId: string, itemId: string, patch: Partial<BrainDumpDraftItem>) =>
      mutateAsync({ jobId, itemId, patch }),
    [mutateAsync],
  )
}

interface DraftItemVariables {
  jobId: string
  itemId: string
}

/** DELETE a draft permanently (used by "Delete forever" in the Trash bucket). */
export function useDeleteBrainDumpDraftItem() {
  const { mutateAsync } = useMutation({
    mutationFn: async ({ jobId, itemId }: DraftItemVariables): Promise<boolean> => {
      const { error } = await api.DELETE('/ai/brain-dump/{jobId}/items/{itemId}', {
        params: { path: { jobId, itemId } },
      })
      return !error
    },
  })
  return useCallback((jobId: string, itemId: string) => mutateAsync({ jobId, itemId }), [mutateAsync])
}

/** DELETE every trashed draft of a job ("Empty trash"). */
export function useEmptyBrainDumpTrash() {
  const { mutateAsync } = useMutation({
    mutationFn: async (jobId: string): Promise<boolean> => {
      const { error } = await api.DELETE('/ai/brain-dump/{jobId}/trash', {
        params: { path: { jobId } },
      })
      return !error
    },
  })
  return useCallback((jobId: string) => mutateAsync(jobId), [mutateAsync])
}

export interface UpdateCollectionsInput {
  collectionName?: string | null
  collectionIds?: string[]
}

interface UpdateCollectionsVariables {
  jobId: string
  input: UpdateCollectionsInput
}

/** PATCH the job's commit-time collection target (new-collection name + existing collection ids). */
export function useUpdateBrainDumpJobCollections() {
  const invalidateJobs = useInvalidateBrainDumpJobs()
  const { mutateAsync } = useMutation({
    mutationFn: async ({ jobId, input }: UpdateCollectionsVariables): Promise<boolean> => {
      const { error } = await api.PATCH('/ai/brain-dump/{jobId}', {
        params: { path: { jobId } },
        body: input,
      })
      if (error) return false
      return true
    },
    onSuccess: (ok) => {
      // The /parse list labels each card with the job's `collectionName`, but its query is unmounted while
      // the user is inside the job and the global 5-min staleTime keeps the cached list "fresh" on return —
      // so a rename here would otherwise show the old name. Invalidate both job lists: a no-op over the
      // network while inside the job (the list is inactive → just marked stale) and a refetch on return.
      if (ok) invalidateJobs()
    },
  })
  return useCallback(
    (jobId: string, input: UpdateCollectionsInput) => mutateAsync({ jobId, input }),
    [mutateAsync],
  )
}

export interface BrainDumpCommitResult {
  ok: boolean
  created?: number
  total?: number
  partial?: boolean
  // True when this commit demoted the job to the `closed` history stub ("Save all" full commit, or the
  // last per-item "Save now"). The board toasts + redirects to the dashboard.
  closed?: boolean
  // True when a per-item commit was HELD pending collection-create confirmation (nothing saved yet); the
  // board shows the confirm dialog then re-commits with the user's choice.
  needsCollectionConfirm?: boolean
  message?: string
}

// Per-item commit options threaded to the route's `confirmCreateCollection` flag (the collection-confirm
// dialog choice): undefined → ask, true → create+attach, false → commit without the new collection.
export interface CommitDraftItemOptions {
  confirmCreateCollection?: boolean
}

/**
 * POST commit a single draft ("Save now") — creates the item attached to the job's collection target.
 * `options.confirmCreateCollection` threads the collection-confirm dialog choice: omitted asks first (the
 * server may answer `needsCollectionConfirm`), true creates+attaches the pending collection, false commits
 * without it. `autoClosed` surfaces as `closed` so the board can redirect when the last draft is saved.
 */
interface CommitDraftItemVariables {
  jobId: string
  itemId: string
  options: CommitDraftItemOptions
}

export function useCommitBrainDumpDraftItem() {
  const { mutateAsync } = useMutation({
    mutationFn: async ({ jobId, itemId, options }: CommitDraftItemVariables): Promise<BrainDumpCommitResult> => {
      // Spends no AI budget (just createItem), so it does not route through useAiMutation.
      // eslint-disable-next-line no-restricted-syntax
      const { data, error } = await api.POST('/ai/brain-dump/{jobId}/items/{itemId}/commit', {
        params: { path: { jobId, itemId } },
        body: { confirmCreateCollection: options.confirmCreateCollection },
      })
      if (error || !data) return { ok: false, message: error?.message ?? 'Failed to save item.' }
      if (data.needsCollectionConfirm) return { ok: false, needsCollectionConfirm: true }
      return { ok: data.created > 0, created: data.created, closed: data.autoClosed }
    },
  })
  return useCallback(
    (jobId: string, itemId: string, options: CommitDraftItemOptions = {}) =>
      mutateAsync({ jobId, itemId, options }),
    [mutateAsync],
  )
}

/** POST commit ("Save all") — turns the drafts into real items and demotes the job to the closed stub. */
export function useCommitBrainDumpJob() {
  const { mutateAsync } = useMutation({
    mutationFn: async (jobId: string): Promise<BrainDumpCommitResult> => {
      // Not an AI mutation (commit spends no AI budget — it just creates real items), so it does not go
      // through useAiMutation and there is no usage meter to refetch.
      // eslint-disable-next-line no-restricted-syntax
      const { data, error } = await api.POST('/ai/brain-dump/{jobId}/commit', {
        params: { path: { jobId } },
      })
      if (error || !data) return { ok: false, message: error?.message ?? 'Failed to save items.' }
      const partial = data.created < data.total
      return { ok: !partial, created: data.created, total: data.total, partial, closed: data.closed }
    },
  })
  return useCallback((jobId: string) => mutateAsync(jobId), [mutateAsync])
}

export interface BulkCommitResult extends BulkDraftResult {
  // True when the bulk commit drained the last non-trashed draft and the job auto-closed (history stub).
  // The board evaluates this ONCE after the whole fan-out settles, then redirects to the dashboard.
  closed: boolean
}

/**
 * Bulk commit a set of drafts ("Save now" over a selection or a whole bucket), fanning out the existing
 * per-item commit endpoint. Each commit deletes its draft server-side; the caller removes the succeeded
 * ids from the board. Passes `confirmCreateCollection: true` so a pending new collection is materialized
 * silently — matching the full-job "Save all" semantics (the per-item card path is the only one that
 * prompts). Reports `closed` if any commit auto-closed the job. Spends no AI budget.
 */
interface BulkCommitVariables {
  jobId: string
  ids: string[]
}

export function useBulkCommitBrainDumpDrafts() {
  const { mutateAsync } = useMutation({
    mutationFn: async ({ jobId, ids }: BulkCommitVariables): Promise<BulkCommitResult> => {
      // Flip this once any commit reports it drained the last draft, then evaluate auto-close ONCE after the
      // whole batch settles (note 7) — never mid-wave. The flag is the one place `closed` is decided.
      let closed = false
      const result = await runBulk(ids, async (id) => {
        // Not an AI mutation (commit just creates real items), so it bypasses useAiMutation.
        // eslint-disable-next-line no-restricted-syntax
        const { data, error } = await api.POST('/ai/brain-dump/{jobId}/items/{itemId}/commit', {
          params: { path: { jobId, itemId: id } },
          body: { confirmCreateCollection: true },
        })
        if (data?.autoClosed) closed = true
        return !error && Boolean(data && data.created > 0)
      })
      return { ...result, closed }
    },
  })
  return useCallback((jobId: string, ids: string[]) => mutateAsync({ jobId, ids }), [mutateAsync])
}
