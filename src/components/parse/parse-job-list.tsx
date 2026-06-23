'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  useActiveBrainDumpJobs,
  useDiscardBrainDumpJob,
  useInvalidateBrainDumpJobs,
  BRAIN_DUMP_STATUS_LABEL,
} from '@/hooks/use-brain-dump'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'

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

  async function handleDiscard() {
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
  }

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
          <div
            key={job.id}
            className="card-interactive flex items-center gap-2 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent/40"
          >
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
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-destructive hover:text-destructive"
                    aria-label="Discard and delete"
                    onClick={() => setPendingDiscardId(job.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                }
              />
              <TooltipContent className="max-w-[260px]">
                Permanently delete this parse job and its drafts, and stop parsing. Your saved source stays in your
                stash to re-parse later.
              </TooltipContent>
            </Tooltip>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={pendingDiscardId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDiscardId(null)
        }}
        title="Discard and delete this parse job?"
        description="This permanently deletes the parse job and its drafts, and stops parsing. Your saved source stays in your stash (tagged brain-dump) so you can re-parse it later."
        confirmLabel="Discard and delete"
        onConfirm={handleDiscard}
        isPending={isDiscarding}
        cancelLabel="Cancel"
      />
    </TooltipProvider>
  )
}
