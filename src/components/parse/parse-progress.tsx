'use client'

import { useState } from 'react'
import { Loader2, RotateCw, Save, Sparkles, CheckCircle2, AlertTriangle, Trash2, RefreshCw, type LucideIcon } from 'lucide-react'
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
import { useAiUsage } from '@/hooks/use-ai-usage'
import { formatRenewIn } from '@/lib/utils/format'
import type { BrainDumpPhase } from '@/hooks/use-brain-dump'

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
  const isStreaming = phase === 'processing-active' || phase === 'processing-reconnecting'
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

  return (
    <TooltipProvider delay={150}>
      <div
        className={cn(
          'relative @container/progress flex min-w-0 flex-col gap-4 overflow-hidden',
          chrome &&
            'card-surface card-hover group rounded-xl border border-border bg-muted/20 p-3 transition-colors hover:bg-muted/40 @min-[34rem]/progress:p-4 @min-[54rem]/progress:p-5',
        )}
      >
        {isStreaming && chrome && <BorderBeam size={120} duration={6} className="opacity-70" />}
        {/* Single grid: narrow = 2 cols × 2 rows; wide = 4 cols × 1 row.
            Items flow in order: [status] [re-parse/resume] [discard] [save all].
            On narrow the first pair (status + contextual btn) sits on row 1 and the
            action pair (discard + save all) wraps to row 2 naturally. */}
        {/* Narrow (< 460px): 2-col grid — status spans both rows (col 1), all buttons stay
            in col 2 (right side). Re-parse sits on row 1; Discard + Save share row 2 as a
            flex pair. Wide (≥ 460px): 4-col single row — the action-pair wrapper becomes
            display:contents so Discard and Save each occupy their own grid column.
            Button labels use stacked container-query thresholds: progressively hide from
            right-to-left as the narrow zone shrinks, and re-reveal left-to-right as the
            wide zone grows — never all at once. */}
        <div className="grid grid-cols-[minmax(min-content,1fr)_auto] items-center gap-x-2 gap-y-2 @min-[460px]/progress:grid-cols-[minmax(min-content,1fr)_auto_auto_auto]">
          {/* Status — spans both rows in narrow so all buttons stay right-aligned in col 2. */}
          <div className="row-span-2 flex items-center gap-3 @min-[460px]/progress:row-span-1">
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

          {/* Row 1 col 2 (narrow) / col 2 (wide): Resume or Re-parse */}
          <div className="flex justify-end">
            {resumable && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button variant="outline" size="sm" onClick={onResume}>
                      <RotateCw className="size-4" />
                      <span className="hidden @[340px]/progress:inline @[460px]/progress:hidden @[530px]/progress:inline">Resume parsing</span>
                    </Button>
                  }
                />
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
                <TooltipTrigger
                  render={
                    <span className="inline-flex">
                      <Button variant="outline" size="sm" disabled>
                        <RefreshCw className="size-4" />
                        <span className="hidden @[340px]/progress:inline @[460px]/progress:hidden @[530px]/progress:inline">Re-parse</span>
                      </Button>
                    </span>
                  }
                />
                <TooltipContent className="max-w-[260px]">
                  Re-parse uses your hourly Brain Dump token, and you&apos;ve used this hour&apos;s —{' '}
                  {formatRenewIn(reparseQuota.resetAt)}.
                </TooltipContent>
              </Tooltip>
            )}
            {done && !reparseRateLimited && (
              <Dialog open={reparseOpen} onOpenChange={setReparseOpen}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <DialogTrigger
                        render={
                          <Button variant="outline" size="sm" disabled={reparsing}>
                            {reparsing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                            <span className="hidden @[340px]/progress:inline @[460px]/progress:hidden @[530px]/progress:inline">Re-parse</span>
                          </Button>
                        }
                      />
                    }
                  />
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
                    <Button variant="outline" size="sm" onClick={() => setReparseOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setReparseOpen(false)
                        onReparse()
                      }}
                    >
                      Use token and re-parse
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>

          {/* Row 2 col 2 (narrow): flex pair of action buttons, right-aligned.
              Wide: display:contents so each child becomes its own grid column (cols 3 + 4). */}
          <div className="flex justify-end gap-1 @min-[460px]/progress:contents">
            <div>
              <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <DialogTrigger
                        render={
                          <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={discarding}>
                            {discarding ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4 text-destructive" />}
                            <span className="hidden @[400px]/progress:inline @[460px]/progress:hidden @[590px]/progress:inline">Discard and Delete</span>
                          </Button>
                        }
                      />
                    }
                  />
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
                    <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        setConfirmOpen(false)
                        onDiscard()
                      }}
                    >
                      Discard and delete
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            <div>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="inline-flex">
                      <Button size="sm" onClick={onCommitAll} disabled={committing || count === 0 || isStreaming}>
                        {committing ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                        <span className="hidden @[280px]/progress:inline @[460px]/progress:hidden @[480px]/progress:inline">Save all {count > 0 ? count : ''}</span>
                      </Button>
                    </span>
                  }
                />
                <TooltipContent className="max-w-[260px]">{saveAllTooltip}</TooltipContent>
              </Tooltip>
            </div>
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
