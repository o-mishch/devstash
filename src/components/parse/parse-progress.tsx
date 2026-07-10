'use client'

import { useCallback, useState } from 'react'
import { Loader2, RotateCw, Save, Sparkles, CheckCircle2, AlertTriangle, Trash2, RefreshCw, type LucideIcon } from 'lucide-react'
import type { HTMLProps } from '@base-ui/react/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { NumberTicker } from '@/components/ui/number-ticker'
import { BorderBeam } from '@/components/ui/border-beam'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { useAiUsage } from '@/hooks/ai/use-ai-usage'
import { formatRenewIn } from '@/lib/utils/format'
import { isStreamingPhase, type BrainDumpPhase } from '@/hooks/items/use-brain-dump'

interface PhaseMeta {
  Icon: LucideIcon
  iconClassName?: string
  label: string
}

// Single phase → presentation map, keyed by the hook's derived `phase` (no re-classification here).
const PHASE_META: Record<BrainDumpPhase, PhaseMeta> = {
  'processing-active': { Icon: Sparkles, iconClassName: 'animate-pulse', label: 'AI is reading your file…' },
  'processing-reconnecting': { Icon: Loader2, iconClassName: 'animate-spin', label: 'Reconnecting…' },
  'processing-paused': { Icon: Sparkles, label: 'Paused — connection lost' },
  completed: { Icon: CheckCircle2, label: 'Ready to review' },
  failed: { Icon: AlertTriangle, label: 'Something went wrong' },
}

// Fully static — no prop/state dependency — so it's hoisted once at module scope rather than
// recreated per render. Base UI clones this element with the tooltip's own trigger props at use.
const REPARSE_RATE_LIMITED_TRIGGER = (
  <span className="inline-flex">
    <Button variant="outline" size="sm" disabled>
      <RefreshCw className="size-4" />
      <span className="hidden @min-[390px]/progress:inline">Re-parse</span>
    </Button>
  </span>
)

interface ParseProgressProps {
  phase: BrainDumpPhase
  progress: number
  count: number
  error: string | null
  committing: boolean
  discarding: boolean
  reparsing: boolean
  onResume: () => void
  onCommitAll: () => void
  onDiscard: () => void
  onReparse: () => void
  chrome?: boolean
}

export function ParseProgress({
  phase,
  progress,
  count,
  error,
  committing,
  discarding,
  reparsing,
  onResume,
  onCommitAll,
  onDiscard,
  onReparse,
  chrome = true,
}: ParseProgressProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [reparseOpen, setReparseOpen] = useState(false)
  const isStreaming = isStreamingPhase(phase)
  const done = phase === 'completed'
  const failed = phase === 'failed'
  const resumable = phase === 'processing-paused'
  const meta = PHASE_META[phase]

  // Re-parse spends a fresh hourly `aiBrainDump` token, so right after a first parse the user is at
  // 0 remaining until the slot renews. Disable + explain rather than letting the click 429. Fail open:
  // when the quota is unknown (loading / non-Pro / meter down) the button stays enabled and the
  // server's 429 is the backstop.
  const { data: aiUsage } = useAiUsage()
  const reparseQuota = aiUsage?.brainDump
  const reparseRateLimited = reparseQuota != null && reparseQuota.remaining < 1

  // State-aware copy for the Save all button (disabled while streaming or with nothing to commit).
  let saveAllTooltip = 'Commit every draft into your stash as real items in one go.'
  if (isStreaming) saveAllTooltip = 'Wait for parsing to finish, then save every draft into your stash at once.'
  else if (count === 0) saveAllTooltip = 'No drafts to save yet.'

  // Base UI's `render` prop accepts a function for exactly this case — a stable reference (via
  // useCallback) instead of a fresh element every render. Each level spreads the merged trigger
  // props first, then its own explicit attrs, without overriding ref/onClick/aria-* Base UI sets.
  const renderResumeTrigger = useCallback(
    (props: HTMLProps<HTMLButtonElement>) => (
      <Button {...props} variant="outline" size="sm" onClick={onResume}>
        <RotateCw className="size-4" />
        <span className="hidden @min-[390px]/progress:inline">Resume parsing</span>
      </Button>
    ),
    [onResume],
  )

  const renderReparseButton = useCallback(
    (props: HTMLProps<HTMLButtonElement>) => (
      <Button {...props} variant="outline" size="sm" disabled={reparsing}>
        {reparsing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        <span className="hidden @min-[390px]/progress:inline">Re-parse</span>
      </Button>
    ),
    [reparsing],
  )
  const renderReparseDialogTrigger = useCallback(
    (props: HTMLProps<HTMLButtonElement>) => <DialogTrigger {...props} render={renderReparseButton} />,
    [renderReparseButton],
  )
  const closeReparseDialog = useCallback(() => setReparseOpen(false), [])
  const confirmReparse = useCallback(() => {
    setReparseOpen(false)
    onReparse()
  }, [onReparse])

  const renderDiscardButton = useCallback(
    (props: HTMLProps<HTMLButtonElement>) => (
      <Button {...props} variant="ghost" size="sm" className="text-muted-foreground" disabled={discarding}>
        {discarding ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4 text-destructive" />}
        <span className="hidden @min-[500px]/progress:inline">Discard and Delete</span>
      </Button>
    ),
    [discarding],
  )
  const renderDiscardDialogTrigger = useCallback(
    (props: HTMLProps<HTMLButtonElement>) => <DialogTrigger {...props} render={renderDiscardButton} />,
    [renderDiscardButton],
  )
  const closeConfirmDialog = useCallback(() => setConfirmOpen(false), [])
  const confirmDiscard = useCallback(() => {
    setConfirmOpen(false)
    onDiscard()
  }, [onDiscard])

  const renderSaveAllTrigger = useCallback(
    (props: HTMLProps<HTMLSpanElement>) => (
      <span {...props} className="inline-flex">
        <Button size="sm" onClick={onCommitAll} disabled={committing || count === 0 || isStreaming}>
          {committing ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          <span className="hidden @min-[620px]/progress:inline">Save all {count > 0 ? count : ''}</span>
        </Button>
      </span>
    ),
    [onCommitAll, committing, count, isStreaming],
  )

  return (
    <TooltipProvider delay={150}>
      <div
        className={cn(
          'relative @container/progress flex min-w-0 flex-col gap-4',
          chrome &&
            'card-surface card-hover group rounded-xl border border-border bg-muted/20 p-3 transition-colors hover:bg-muted/40 @min-[34rem]/progress:p-4 @min-[54rem]/progress:p-5',
        )}
      >
        {isStreaming && chrome && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
            <BorderBeam size={120} duration={6} className="opacity-70" />
          </div>
        )}
        {/* Single row always. Status is whitespace-nowrap (never wraps/shrinks).
            Buttons drop labels right-to-left as space shrinks:
              ≥ 620px: all labels visible
              ≥ 500px: Re-parse + Discard labelled, Save all icon-only
              ≥ 390px: Re-parse labelled, Discard + Save all icon-only
              < 390px: all icon-only */}
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-3">
            <div
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-full',
                failed ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary',
              )}
            >
              <meta.Icon className={cn('card-icon size-4', meta.iconClassName)} />
            </div>
            <div>
              <p className="whitespace-nowrap text-sm font-semibold">{meta.label}</p>
              <p className="whitespace-nowrap text-xs text-muted-foreground">
                <NumberTicker value={count} className="font-medium text-foreground" /> draft
                {count === 1 ? '' : 's'} found
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {resumable && (
              <Tooltip>
                <TooltipTrigger render={renderResumeTrigger} />
                <TooltipContent className="max-w-[260px]">
                  Pick up parsing where it stopped — continues this same job from the last saved point.
                </TooltipContent>
              </Tooltip>
            )}
            {/* Re-parse is `completed`-only: it re-runs the same source, which only makes sense once a job
                has finished cleanly. A `failed` job's retry path is Parse-from-stash on the source item (a
                blind re-run reproduces the fault); the server route also 409s a non-`completed` re-parse.
                When the hourly Brain Dump token is spent, the button is disabled with a tooltip stating when
                the next slot opens — rather than letting the click 429. */}
            {done && reparseRateLimited && (
              <Tooltip>
                <TooltipTrigger render={REPARSE_RATE_LIMITED_TRIGGER} />
                <TooltipContent className="max-w-[260px]">
                  Re-parse uses your hourly Brain Dump token, and you&apos;ve used this hour&apos;s —{' '}
                  {formatRenewIn(reparseQuota.resetAt)}.
                </TooltipContent>
              </Tooltip>
            )}
            {done && !reparseRateLimited && (
              <Dialog open={reparseOpen} onOpenChange={setReparseOpen}>
                <Tooltip>
                  <TooltipTrigger render={renderReparseDialogTrigger} />
                  <TooltipContent className="max-w-[260px]">
                    Run a fresh parse of the saved source in a new job — uses one hourly Brain Dump token.
                  </TooltipContent>
                </Tooltip>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Re-parse this source?</DialogTitle>
                    <DialogDescription>
                      This starts a separate parse job from the saved source and uses a new hourly Brain Dump token.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" size="sm" onClick={closeReparseDialog}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={confirmReparse}>
                      Use token and re-parse
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}

            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <Tooltip>
                <TooltipTrigger render={renderDiscardDialogTrigger} />
                <TooltipContent className="max-w-[260px]">
                  Permanently delete this parse job and its drafts, and stop parsing. Your saved source stays in your
                  stash to re-parse later.
                </TooltipContent>
              </Tooltip>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Discard and delete this parse job?</DialogTitle>
                  <DialogDescription>
                    This permanently deletes the parse job and its drafts, and stops parsing. Your saved source stays in
                    your stash (tagged brain-dump) so you can re-parse it later.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" size="sm" onClick={closeConfirmDialog}>
                    Cancel
                  </Button>
                  <Button variant="destructive" size="sm" onClick={confirmDiscard}>
                    Discard and delete
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Tooltip>
              <TooltipTrigger render={renderSaveAllTrigger} />
              <TooltipContent className="max-w-[260px]">{saveAllTooltip}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Failed jobs surface the server's rich remediation detail in a dedicated block (not a clipped
            suffix on the muted "N drafts found" line) so the "what to fix before re-running" guidance is
            legible — a blind re-run reproduces the fault. Partials above stay committable. */}
        {failed && error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {!done && !failed && <Progress value={progress} className="h-1.5" />}
      </div>
    </TooltipProvider>
  )
}
