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
    <div className="card-surface card-hover group relative @container/progress flex h-full flex-col justify-center overflow-hidden rounded-xl border border-border bg-muted/20 transition-colors hover:bg-muted/40 p-4 sm:p-5">
      {isStreaming && <BorderBeam size={120} duration={6} className="opacity-70" />}
      {/* Container-query layout keyed to the card's OWN width via EXPLICIT px breakpoints — the page
          root font-size is 20px, so rem-based container sizes (@md/@lg/@xl) resolve 1.25× larger than
          their names imply (@xl = 36rem = 720px, not 576px); px thresholds stay honest. Two regimes,
          both width-filling (no sparse centered island), icon+title always on ONE line (compact, 2 rows
          of text at most — less wasted vertical space than icon-on-top):
            • ≥620px → single-row toolbar: status left (icon beside title), actions row right.
            • <620px → status line on top (icon beside title), actions flex-wrap row(s) filling below. */}
      <div className="flex flex-col gap-3 @min-[620px]/progress:flex-row @min-[620px]/progress:items-center @min-[620px]/progress:justify-between @min-[620px]/progress:gap-4">
        <div className="flex min-w-0 items-center gap-3 @min-[620px]/progress:flex-1">
          <div
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-full',
              failed ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary',
            )}
          >
            <meta.Icon className={cn('card-icon size-4', meta.iconClassName)} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{meta.label}</p>
            <p className="text-xs text-muted-foreground">
              <NumberTicker value={count} className="font-medium text-foreground" /> draft
              {count === 1 ? '' : 's'} found
            </p>
          </div>
        </div>

        {/* Actions: full-width flex-wrap that MAXIMISES the useful area. `grow` lets each button expand
            to fill its row but never shrink below its label (so the wide "Discard and Delete" never
            clips), and wrapping packs them to the width — 3-in-a-row when there's room, 2+1 when not,
            one-per-row when narrow; a lone wrapped button grows to span the full width. `>span>button`
            fills the inline-flex-wrapped triggers (Save all / disabled Re-parse). Once the card is wide
            (≥620px) it becomes a natural-width single-row toolbar beside the status. */}
        <div className="flex w-full flex-wrap items-center gap-2 [&>*]:grow [&>span>button]:w-full @min-[620px]/progress:w-auto @min-[620px]/progress:shrink-0 @min-[620px]/progress:flex-nowrap @min-[620px]/progress:[&>*]:grow-0">
          {resumable && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="outline" size="sm" onClick={onResume}>
                    <RotateCw className="size-4" />
                    Resume parsing
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
                      Re-parse
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
                          Re-parse
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
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DialogTrigger
                    render={
                      <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={discarding}>
                        {discarding ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4 text-destructive" />}
                        Discard and Delete
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
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex">
                  <Button size="sm" onClick={onCommitAll} disabled={committing || count === 0 || isStreaming}>
                    {committing ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    Save all {count > 0 ? count : ''}
                  </Button>
                </span>
              }
            />
            <TooltipContent className="max-w-[260px]">{saveAllTooltip}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Failed jobs surface the server's rich remediation detail in a dedicated block (not a clipped
          suffix on the muted "N drafts found" line) so the "what to fix before re-running" guidance is
          legible — a blind re-run reproduces the fault. Partials above stay committable. */}
      {failed && error && (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {!done && !failed && <Progress value={progress} className="mt-4 h-1.5" />}
    </div>
    </TooltipProvider>
  )
}
