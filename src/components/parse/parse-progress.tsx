'use client'

import { useState } from 'react'
import { Loader2, RotateCw, Save, Sparkles, CheckCircle2, AlertTriangle, Trash2, type LucideIcon } from 'lucide-react'
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
import type { BrainDumpPhase } from '@/hooks/use-brain-dump'

interface PhaseMeta {
  Icon: LucideIcon
  iconClassName?: string
  label: string
}

// Single phase → presentation map, keyed by the hook's derived `phase` (no re-classification here).
const PHASE_META: Record<BrainDumpPhase, PhaseMeta> = {
  streaming: { Icon: Sparkles, iconClassName: 'animate-pulse', label: 'AI is reading your file…' },
  completed: { Icon: CheckCircle2, label: 'Ready to review' },
  failed: { Icon: AlertTriangle, label: 'Something went wrong' },
  paused: { Icon: Sparkles, label: 'Paused' },
}

interface ParseProgressProps {
  phase: BrainDumpPhase
  progress: number
  count: number
  error: string | null
  committing: boolean
  discarding: boolean
  onResume: () => void
  onCommitAll: () => void
  onDiscard: () => void
}

export function ParseProgress({
  phase,
  progress,
  count,
  error,
  committing,
  discarding,
  onResume,
  onCommitAll,
  onDiscard,
}: ParseProgressProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const isStreaming = phase === 'streaming'
  const done = phase === 'completed'
  const failed = phase === 'failed'
  const resumable = phase === 'paused'
  const meta = PHASE_META[phase]

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-4 sm:p-5">
      {isStreaming && <BorderBeam size={120} duration={6} className="opacity-70" />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex size-9 items-center justify-center rounded-full',
              failed ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary',
            )}
          >
            <meta.Icon className={cn('size-4', meta.iconClassName)} />
          </div>
          <div>
            <p className="text-sm font-semibold">{meta.label}</p>
            <p className="text-xs text-muted-foreground">
              <NumberTicker value={count} className="font-medium text-foreground" /> draft
              {count === 1 ? '' : 's'} found
              {error ? ` · ${error}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {resumable && (
            <Button variant="outline" size="sm" onClick={onResume}>
              <RotateCw className="size-4" /> Resume parsing
            </Button>
          )}
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogTrigger
              render={
                <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={discarding}>
                  {discarding ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  Discard
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Discard this parse job?</DialogTitle>
                <DialogDescription>
                  This deletes the drafts and stops parsing. Your saved source stays in your stash (tagged
                  brain-dump) so you can re-parse it later.
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
                  Discard job
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button size="sm" onClick={onCommitAll} disabled={committing || count === 0 || isStreaming}>
            {committing ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save all {count > 0 ? count : ''}
          </Button>
        </div>
      </div>

      {!done && !failed && <Progress value={progress} className="mt-4 h-1.5" />}
    </div>
  )
}
