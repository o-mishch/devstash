'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, $api } from '@/lib/api/client'
import { useAiMutation } from '@/hooks/use-ai-usage'
import type { components, paths } from '@/types/openapi'

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
export type BrainDumpJobStatus = 'processing' | 'completed' | 'failed'
// The single derived stream phase the UI renders from — the one source of truth for "what's happening
// now", so the progress card never re-classifies status/resumable/error on its own.
export type BrainDumpPhase = 'streaming' | 'paused' | 'completed' | 'failed'

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
  return useCallback(
    async (input: CreateBrainDumpInput): Promise<CreateBrainDumpResult> => {
      const { data, error, response } = await runAi('/ai/brain-dump', input)
      if (error || !data) {
        return { ok: false, message: error?.message ?? 'Failed to start the split.', status: response?.status }
      }
      return { ok: true, jobId: data.jobId, sourceName: data.sourceName, truncated: data.truncated }
    },
    [runAi],
  )
}

/** Re-reads an existing job's durable source and starts a fresh, separately metered parse job. */
export function useReparseBrainDumpJob() {
  const runAi = useAiMutation()
  return useCallback(
    async (jobId: string): Promise<CreateBrainDumpResult> => {
      const { data, error, response } = await runAi(
        '/ai/brain-dump/{jobId}/re-parse',
        {},
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

/** Lists the user's eligible text `file` items for the "Select from my files" picker (Pro-gated by caller). */
export function useBrainDumpSources(enabled: boolean) {
  return $api.useQuery('get', '/ai/brain-dump/sources', {}, { enabled, staleTime: 30_000 })
}

/** DELETE /ai/brain-dump/{jobId} — discard a job (keeps the source item; cancels the run if processing). */
export function useDiscardBrainDumpJob() {
  return useCallback(async (jobId: string): Promise<boolean> => {
    const { error } = await api.DELETE('/ai/brain-dump/{jobId}', { params: { path: { jobId } } })
    return !error
  }, [])
}

/** Lists the user's in-progress jobs; polls while any are still processing. */
export function useActiveBrainDumpJobs() {
  return $api.useQuery(
    'get',
    '/ai/brain-dump',
    {},
    {
      refetchInterval: (query) =>
        query.state.data?.jobs.some((job) => job.status === 'processing') ? 4000 : false,
    },
  )
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
  items: BrainDumpDraftItem[]
}
interface ProgressEventData {
  progress: number
  count: number
}
interface ServerErrorEventData {
  message: string
}

/**
 * Opens the SSE stream for a job: seeds from the `snapshot` event (refresh-resume), appends each
 * `item`, tracks `progress`, and finalizes on `done`/`error`. `resume()` reconnects with `?resume=1`
 * to continue an interrupted background run from its cursor. Exposes local mutators the board uses to
 * reflect optimistic edits/deletes/reclassifications.
 */
export function useBrainDumpStream(jobId: string): BrainDumpStreamState {
  const [items, setItems] = useState<BrainDumpDraftItem[]>([])
  const [status, setStatus] = useState<BrainDumpJobStatus>('processing')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [resumable, setResumable] = useState(false)
  const [truncated, setTruncated] = useState(false)
  // Bumping this re-runs the effect to reconnect; the ref carries the resume intent into the new URL.
  const [reconnectTick, setReconnectTick] = useState(0)
  const resumeRef = useRef(false)

  const resume = useCallback(() => {
    resumeRef.current = true
    setResumable(false)
    setReconnectTick((tick) => tick + 1)
  }, [])

  const applyPatch = useCallback((itemId: string, patch: Partial<BrainDumpDraftItem>) => {
    setItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, ...patch } : item)))
  }, [])

  const removeItem = useCallback((itemId: string) => {
    setItems((prev) => prev.filter((item) => item.id !== itemId))
  }, [])

  useEffect(() => {
    const wantResume = resumeRef.current
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

    source.addEventListener('snapshot', (event) => {
      const snap = parseFrame<SnapshotEventData>(event)
      if (!snap) return
      setItems(snap.items)
      setStatus(snap.status)
      setProgress(snap.progress)
      setError(snap.error ?? null)
      if (snap.truncated) setTruncated(true)
    })
    source.addEventListener('item', (event) => {
      const item = parseFrame<BrainDumpDraftItem>(event)
      if (!item) return
      setItems((prev) => (prev.some((existing) => existing.id === item.id) ? prev : [...prev, item]))
    })
    source.addEventListener('progress', (event) => {
      const data = parseFrame<ProgressEventData>(event)
      if (!data) return
      setProgress(data.progress)
    })
    source.addEventListener('resumable', () => {
      setResumable(true)
    })
    source.addEventListener('done', (event) => {
      const data = parseFrame<DoneEventData>(event)
      if (!data) {
        // Unparseable terminal frame — offer a resume rather than leaving the spinner up forever.
        setResumable(true)
        source.close()
        return
      }
      setStatus(data.status)
      if (data.status !== 'processing') setProgress(100)
      if (data.truncated) setTruncated(true)
      source.close()
    })
    source.addEventListener('error', (event) => {
      const data = (event as MessageEvent).data ? parseFrame<ServerErrorEventData>(event) : null
      if (data) {
        setError(data.message)
        setStatus('failed')
      } else {
        // No payload (native connection drop, e.g. the route hit maxDuration) or an unparseable error
        // frame — offer a resume instead of silently auto-reconnecting or stalling.
        setResumable(true)
      }
      source.close()
    })

    return () => {
      source.close()
      resumeRef.current = false
    }
  }, [jobId, reconnectTick])

  return {
    items,
    status,
    progress,
    error,
    resumable,
    truncated,
    phase: derivePhase(status, resumable),
    resume,
    applyPatch,
    removeItem,
  }
}

// Single classification of the live stream phase: a terminal status wins; otherwise an interrupted run
// the user can resume is "paused", and anything else is actively "streaming".
function derivePhase(status: BrainDumpJobStatus, resumable: boolean): BrainDumpPhase {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  return resumable ? 'paused' : 'streaming'
}

export interface PatchResult {
  ok: boolean
  item?: BrainDumpDraftItem
}

/** PATCH a draft (reclassify/edit). */
export function usePatchBrainDumpDraftItem() {
  return useCallback(async (jobId: string, itemId: string, patch: Partial<BrainDumpDraftItem>): Promise<PatchResult> => {
    const { data, error } = await api.PATCH('/ai/brain-dump/{jobId}/items/{itemId}', {
      params: { path: { jobId, itemId } },
      body: patch as DraftPatchBody,
    })
    if (error || !data) return { ok: false }
    return { ok: true, item: data }
  }, [])
}

/** DELETE a draft permanently (used by "Delete forever" in the Trash bucket). */
export function useDeleteBrainDumpDraftItem() {
  return useCallback(async (jobId: string, itemId: string): Promise<boolean> => {
    const { error } = await api.DELETE('/ai/brain-dump/{jobId}/items/{itemId}', {
      params: { path: { jobId, itemId } },
    })
    return !error
  }, [])
}

/** DELETE every trashed draft of a job ("Empty trash"). */
export function useEmptyBrainDumpTrash() {
  return useCallback(async (jobId: string): Promise<boolean> => {
    const { error } = await api.DELETE('/ai/brain-dump/{jobId}/trash', {
      params: { path: { jobId } },
    })
    return !error
  }, [])
}

export interface UpdateCollectionsInput {
  collectionName?: string | null
  collectionIds?: string[]
}

/** PATCH the job's commit-time collection target (new-collection name + existing collection ids). */
export function useUpdateBrainDumpJobCollections() {
  return useCallback(async (jobId: string, input: UpdateCollectionsInput): Promise<boolean> => {
    const { error } = await api.PATCH('/ai/brain-dump/{jobId}', {
      params: { path: { jobId } },
      body: input,
    })
    return !error
  }, [])
}

export interface BrainDumpCommitResult {
  ok: boolean
  created?: number
  total?: number
  partial?: boolean
  message?: string
}

/** POST commit a single draft ("Save now") — creates the item attached to the job's collection target. */
export function useCommitBrainDumpDraftItem() {
  return useCallback(async (jobId: string, itemId: string): Promise<BrainDumpCommitResult> => {
    // Spends no AI budget (just createItem), so it does not route through useAiMutation.
    // eslint-disable-next-line no-restricted-syntax
    const { data, error } = await api.POST('/ai/brain-dump/{jobId}/items/{itemId}/commit', {
      params: { path: { jobId, itemId } },
    })
    if (error || !data) return { ok: false, message: error?.message ?? 'Failed to save item.' }
    return { ok: data.created > 0, created: data.created }
  }, [])
}

/** POST commit — turns the drafts into real items and deletes the job. */
export function useCommitBrainDumpJob() {
  return useCallback(async (jobId: string): Promise<BrainDumpCommitResult> => {
    // Not an AI mutation (commit spends no AI budget — it just creates real items), so it does not go
    // through useAiMutation and there is no usage meter to refetch.
    // eslint-disable-next-line no-restricted-syntax
    const { data, error } = await api.POST('/ai/brain-dump/{jobId}/commit', {
      params: { path: { jobId } },
    })
    if (error || !data) return { ok: false, message: error?.message ?? 'Failed to save items.' }
    const partial = data.created < data.total
    return { ok: !partial, created: data.created, total: data.total, partial }
  }, [])
}
