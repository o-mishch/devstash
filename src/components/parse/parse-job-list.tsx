'use client'

import { memo, useCallback, useState } from 'react'
import type { HTMLProps } from '@base-ui/react/types'
import Link from 'next/link'
import { ArrowRight, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  useActiveBrainDumpJobs,
  useDiscardBrainDumpJob,
  useInvalidateBrainDumpJobs,
  BRAIN_DUMP_STATUS_LABEL,
  type BrainDumpJobSummary,
} from '@/hooks/items/use-brain-dump'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'

interface ParseJobRowProps {
  job: BrainDumpJobSummary
  onDiscardRequest: (jobId: string) => void
}

// Extracted so the per-item Button/onClick closures created inside jobs.map() below are stable
// (React.memo + a single id-based callback from the parent) instead of a fresh closure per render.
const ParseJobRow = memo(function ParseJobRow({ job, onDiscardRequest }: ParseJobRowProps) {
  const handleDiscardClick = useCallback(() => {
    onDiscardRequest(job.id)
  }, [job.id, onDiscardRequest])

  const renderDiscardButton = useCallback(
    (triggerProps: HTMLProps<HTMLButtonElement>) => (
      <Button
        {...triggerProps}
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-destructive hover:text-destructive"
        aria-label="Discard and delete"
        onClick={handleDiscardClick}
      >
        <Trash2 className="size-4" />
      </Button>
    ),
    [handleDiscardClick],
  )

  return (
    <div className="card-interactive flex items-center gap-2 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent/40">
      <Link href={`/parse/${job.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">
              {job.itemCount} draft{job.itemCount === 1 ? '' : 's'}
            </span>
            <Badge variant="secondary" className="text-[10px]">
              {BRAIN_DUMP_STATUS_LABEL[job.status]}
            </Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {job.collectionName?.trim() || job.sourceName || 'Unknown source'}
          </p>
          <Progress value={job.progress} className="mt-2 h-1" />
        </div>
        <ArrowRight className="card-icon size-4 shrink-0 text-muted-foreground" />
      </Link>
      <Tooltip>
        <TooltipTrigger render={renderDiscardButton} />
        <TooltipContent className="max-w-[260px]">
          Permanently delete this parse job and its drafts, and stop parsing. Your saved source stays in your stash
          to re-parse later.
        </TooltipContent>
      </Tooltip>
    </div>
  )
})

// In-progress split jobs (the /parse index list). Polls while any job is still processing so a
// background run that finishes elsewhere updates here without a manual refresh.
export function ParseJobList() {
  const { data, isLoading } = useActiveBrainDumpJobs()
  const discardJob = useDiscardBrainDumpJob()
  const invalidateJobs = useInvalidateBrainDumpJobs()
  const jobs = data?.jobs ?? []

  // The job the user is about to discard (drives the confirm dialog); null when closed.
  const [pendingDiscardId, setPendingDiscardId] = useState<string | null>(null)
  const [isDiscarding, setIsDiscarding] = useState(false)

  const handleDiscard = useCallback(async () => {
    if (!pendingDiscardId) return
    setIsDiscarding(true)
    const ok = await discardJob(pendingDiscardId)
    setIsDiscarding(false)
    if (ok) {
      toast.success('Parse job discarded')
      setPendingDiscardId(null)
      invalidateJobs()
    } else {
      toast.error('Failed to discard parse job')
    }
  }, [pendingDiscardId, discardJob, invalidateJobs])

  const handleDiscardRequest = useCallback((jobId: string) => {
    setPendingDiscardId(jobId)
  }, [])

  const handleConfirmDialogOpenChange = useCallback((open: boolean) => {
    if (!open) setPendingDiscardId(null)
  }, [])

  const handleConfirmDiscard = useCallback(() => {
    void handleDiscard()
  }, [handleDiscard])

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading jobs…
      </div>
    )
  }

  if (jobs.length === 0) {
    return <p className="text-sm text-muted-foreground">No splits awaiting review.</p>
  }

  return (
    <TooltipProvider delay={150}>
      <div className="flex flex-col gap-2">
        {jobs.map((job) => (
          <ParseJobRow key={job.id} job={job} onDiscardRequest={handleDiscardRequest} />
        ))}
      </div>

      <ConfirmDialog
        open={pendingDiscardId !== null}
        onOpenChange={handleConfirmDialogOpenChange}
        title="Discard and delete this parse job?"
        description="This permanently deletes the parse job and its drafts, and stops parsing. Your saved source stays in your stash (tagged brain-dump) so you can re-parse it later."
        confirmLabel="Discard and delete"
        onConfirm={handleConfirmDiscard}
        isPending={isDiscarding}
        cancelLabel="Cancel"
      />
    </TooltipProvider>
  )
}
