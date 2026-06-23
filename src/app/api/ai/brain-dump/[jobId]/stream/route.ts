import { NextResponse } from 'next/server'
import { authedRouteWithParams } from '@/lib/api/route'
import { problem } from '@/lib/api/http'
import { getOpenAIClient } from '@/lib/ai/openai'
import {
  startBackgroundBrainDump,
  resumeBackgroundBrainDump,
  consumeBrainDumpStream,
  brainDumpProgress,
  buildFailureDetail,
} from '@/lib/ai/brain-dump'
import {
  getParseJobSnapshot,
  getParseJobRunState,
  appendDraftsAndAdvance,
  setOpenAiResponseId,
  finishJob,
} from '@/lib/db/ai-parse-jobs'
import { getRedis } from '@/lib/infra/redis'
import { logger } from '@/lib/infra/pino'

// SSE stream for the AI File Splitter, backed by an OpenAI **background** run. On connect it replays
// the DB snapshot (refresh-resume of already-saved drafts). For a fresh job it starts the background
// run and streams live; for an interrupted job it does nothing until the client asks to resume
// (`?resume=1`), then reconnects to the background run from the stored cursor — no duplication, no new
// token. `request.signal` aborts only OUR read; the background run keeps going on OpenAI's servers.
// A Redis single-flight lock (70s TTL — also the crash safety net) stops two readers generating at once.

export const maxDuration = 60
// Node runtime (default) — SSE + the OpenAI streaming SDK are not edge-compatible. No
// `dynamic = 'force-dynamic'`: it's incompatible with this project's `cacheComponents`, and the route
// is already dynamic (it reads the session, request signal, and query params).
// Vercel Hobby ceiling is 60 s. The background OpenAI run (store: true) survives the cutoff; the
// client detects the drop via a server heartbeat and auto-reconnects from the stored cursor.

const log = logger.child({ tag: 'ai-brain-dump-stream' })

const SPLIT_LOCK_NS = 'split-lock'

// Reconnect delay (ms) handed to the browser via the SSE `retry:` field. Native EventSource waits this
// long before auto-reconnecting after a drop (e.g. the 60 s Vercel cutoff), re-sending `Last-Event-ID`.
const SSE_RETRY_MS = 3000

interface SendOptions {
  // Emitted as the SSE `id:` field. The browser echoes the last id it saw as the `Last-Event-ID` header on
  // its native auto-reconnect, which the route reads to resume the background run from the DB cursor.
  id?: number
  // Emitted as the SSE `retry:` field (reconnect delay). Sent once, folded into the first frame.
  retry?: number
}

interface JobIdParam {
  jobId: string
}

export const GET = authedRouteWithParams<JobIdParam>({}, async ({ userId, isPro, request, params }) => {
  // Pro-gated like the commit routes: the stream drives the paid OpenAI run, so a user who has since
  // downgraded must not start/resume generation on a previously-created job via a direct request.
  if (!isPro) return problem(403, 'This feature requires a Pro subscription.')

  const { jobId } = params
  const snapshot = await getParseJobSnapshot(userId, jobId)
  if (!snapshot) return problem(404, 'Parse job not found.')

  // Native EventSource auto-reconnect re-sends the last `id:` it saw as the `Last-Event-ID` header — treat
  // that as a resume (continue the background run from the stored cursor). `?resume=1` covers the manual
  // paths (the Resume CTA and the watchdog-forced rebuild), where a freshly-constructed EventSource sends
  // no header. Either way the cursor is server-side (DB), so the client value is just a resume signal.
  const resume =
    request.nextUrl.searchParams.get('resume') === '1' || request.headers.get('last-event-id') !== null
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let active = true
      const send = (event: string, data: unknown, opts?: SendOptions): void => {
        if (!active) return
        let frame = ''
        if (opts?.retry !== undefined) frame += `retry: ${opts.retry}\n`
        if (opts?.id !== undefined) frame += `id: ${opts.id}\n`
        frame += `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        try {
          controller.enqueue(encoder.encode(frame))
        } catch {
          active = false // client went away; stop enqueuing
        }
      }
      const close = (): void => {
        active = false
        try {
          controller.close()
        } catch {
          // already closed by a client disconnect
        }
      }

      // 1. Replay the persisted snapshot (refresh-resume of saved drafts). The first frame carries the
      //    server-driven reconnect delay (`retry:`) and an initial `id:` (current draft count) so the
      //    browser always has a `Last-Event-ID` to re-send even if the pipe drops before any item streams.
      send('snapshot', snapshot, { retry: SSE_RETRY_MS, id: snapshot.items.length })
      if (snapshot.status !== 'processing') {
        send('done', { status: snapshot.status })
        close()
        return
      }

      const runState = await getParseJobRunState(userId, jobId)
      if (!runState) {
        send('error', { message: 'Parse job not found.' })
        close()
        return
      }

      const client = getOpenAIClient()
      if (!client) {
        await finishJob(userId, jobId, 'failed', 'AI is not configured.')
        send('error', { message: 'AI is not configured.' })
        close()
        return
      }

      const isFresh = !runState.openaiResponseId && runState.itemCount === 0
      const canResume = Boolean(runState.openaiResponseId)

      // 2. Not a fresh start and not an explicit resume → don't generate. Either offer a resume
      //    (background run exists) or settle a stuck job that can't be resumed.
      if (!isFresh && !resume) {
        if (canResume) {
          send('resumable', { count: runState.itemCount })
        } else {
          // Has drafts but no resumable run id (a crash between the first persist and the cursor write):
          // settle it terminal, but flag truncated so the board discloses it may be partial — never a
          // silent clean "completed" for a run we can't prove finished.
          await finishJob(userId, jobId, 'completed', undefined, true)
          send('done', { status: 'completed', truncated: true })
        }
        close()
        return
      }

      // 3. Single-flight lock — a second live reader just gets the snapshot (no double-generate).
      const redis = getRedis()
      const lockKey = `${SPLIT_LOCK_NS}:${jobId}`
      const acquired = redis ? await redis.set(lockKey, '1', { nx: true, ex: maxDuration + 10 }) : null
      if (!acquired) {
        if (!redis) {
          send('error', { message: 'Generation is temporarily unavailable. Please try again.' })
        } else {
          send('done', { status: 'processing' })
        }
        close()
        return
      }

      // Keep-alive: send a heartbeat every 15 s so the client can detect a dead pipe quickly
      // (native TCP timeout can take minutes). The client resets its watchdog on every heartbeat.
      const heartbeatInterval = setInterval(() => {
        send('heartbeat', {})
      }, 15_000)

      try {
        // 4. Open the background event stream — start it fresh or resume from the cursor.
        const events = isFresh
          ? await startBackgroundBrainDump(client, runState.sourceText, request.signal)
          : await resumeBackgroundBrainDump(
              client,
              runState.openaiResponseId as string,
              runState.streamCursor,
              request.signal,
            )

        const result = await consumeBrainDumpStream(
          events,
          {
            startOrder: runState.itemCount,
            onResponseId: async (id) => {
              await setOpenAiResponseId(userId, jobId, id)
            },
            onFlush: async (drafts, startOrder, cursor) => {
              // One atomic write per clean boundary: drafts + cursor + progress commit together, so a
              // crash can never leave a persisted draft ahead of the cursor (which would duplicate on
              // resume). Emit over SSE only after the batch is durably saved.
              const saved = await appendDraftsAndAdvance(userId, jobId, drafts, startOrder, cursor)
              // `id:` = the draft's order, so the browser's native auto-reconnect re-sends it as
              // `Last-Event-ID` and the route resumes the background run from the stored cursor.
              saved.forEach((row) => send('item', row, { id: row.order }))
              if (saved.length > 0) {
                const count = startOrder + saved.length
                send('progress', { progress: brainDumpProgress(count), count })
              }
            },
          },
          log,
        )

        if (result.status === 'completed') {
          await finishJob(userId, jobId, 'completed')
          send('done', { status: 'completed' })
        } else if (result.status === 'incomplete') {
          // Token cap (max_output_tokens) cut the run short. Finish as completed but flag it truncated
          // so the review board discloses that the tail wasn't parsed — never a silent cut.
          await finishJob(userId, jobId, 'completed', undefined, true)
          send('done', { status: 'completed', truncated: true })
        } else if (result.status === 'failed') {
          // Rich `failed` detail: total drafts persisted across (re)connects = startOrder + this run's
          // emitted. A content_filter/model-error failure keeps those partials committable; we write a
          // human-readable description + remediation and never offer a re-parse on a failed job.
          const draftsPersisted = runState.itemCount + result.emitted
          const failure = result.failure ?? { reason: 'model_error' as const, message: null }
          const detail = buildFailureDetail(failure, draftsPersisted)
          await finishJob(userId, jobId, 'failed', detail, undefined, { reason: failure.reason })
          send('error', { message: detail, reason: failure.reason })
        } else {
          // detached without a throw — leave the job processing so it can be resumed.
          send('done', { status: 'processing' })
        }
      } catch (err) {
        if (request.signal.aborted) {
          // Client disconnected — the background run keeps going on OpenAI; leave the job processing
          // so the user can resume. We never cancel the upstream run.
          log.info({ userId, jobId }, 'split reader detached (client disconnect); background run continues')
        } else if (!(await getParseJobSnapshot(userId, jobId))) {
          // The job was discarded mid-flush: the cascade delete makes the in-flight draft write throw.
          // That's a clean user-initiated stop, not a generation error — don't surface a failure.
          log.info({ userId, jobId }, 'split stream stopped: job discarded mid-run')
        } else {
          log.error({ userId, jobId, err }, 'split stream failed')
          send('error', { message: 'Generation failed.' })
        }
      } finally {
        clearInterval(heartbeatInterval)
        if (redis) await redis.del(lockKey)
        close()
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      // EventSource strictly requires `text/event-stream`; the explicit charset is the spec-blessed option.
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable reverse-proxy buffering (nginx and compatible layers) so heartbeat/item frames flush
      // immediately instead of being batched — without this a buffering proxy can withhold the heartbeat
      // and defeat the client's fast dead-pipe detection.
      'X-Accel-Buffering': 'no',
    },
  })
})
