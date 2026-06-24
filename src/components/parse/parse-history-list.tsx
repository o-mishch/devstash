'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowRight, Loader2, Trash2 } from 'lucide-react'
import {
  useClosedBrainDumpJobs,
  useDiscardBrainDumpJob,
  useInvalidateBrainDumpJobs,
} from '@/hooks/items/use-brain-dump'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'

// Closed (committed) Brain Dump jobs — the /parse "History" section. Each row links to its read-only
// History board and offers a per-row delete-with-confirm. Deleting a closed job removes the history
// record (and any leftover trashed drafts); the committed items and the source item stay in the stash.
export function ParseHistoryList() {
  const { data, isLoading } = useClosedBrainDumpJobs()
  const jobs = data?.jobs ?? []

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading history…
      </div>
    )
  }

  if (jobs.length === 0) {
    return <p className="text-sm text-muted-foreground">No committed Brain Dumps yet.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {jobs.map((job) => (
        <HistoryRow
          key={job.id}
          jobId={job.id}
          sourceName={job.sourceName}
          committedCount={job.committedCount ?? 0}
          leftoverTrash={job.itemCount}
        />
      ))}
    </div>
  )
}

interface HistoryRowProps {
  jobId: string
  sourceName: string | null
  committedCount: number
  // Trashed drafts still attached to the closed job (committable from the History board until deleted).
  leftoverTrash: number
}

function HistoryRow({ jobId, sourceName, committedCount, leftoverTrash }: HistoryRowProps) {
  const deleteJob = useDiscardBrainDumpJob()
  const invalidateJobs = useInvalidateBrainDumpJobs()
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const onConfirmDelete = async () => {
    setDeleting(true)
    const ok = await deleteJob(jobId)
    setDeleting(false)
    if (!ok) {
      toast.error('Could not delete the history record')
      return
    }
    setOpen(false)
    invalidateJobs()
    toast.success('History record deleted. Your committed items stay in your stash.')
  }

  return (
    <div className="card-surface card-hover group flex items-center gap-3 rounded-lg border border-border bg-card p-3">
      <Link href={`/parse/${jobId}`} className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {committedCount} item{committedCount === 1 ? '' : 's'} saved
          </span>
          {leftoverTrash > 0 && <span className="text-xs text-muted-foreground">· {leftoverTrash} in trash</span>}
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">{sourceName ?? 'Unknown source'}</p>
      </Link>
      <ArrowRight className="card-icon size-4 shrink-0 text-muted-foreground" />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={
            <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive">
              <Trash2 className="size-4 text-destructive" />
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this history record?</DialogTitle>
            <DialogDescription>
              This removes the Brain Dump record{leftoverTrash > 0 ? ' and discards its trashed drafts' : ''}. Your
              committed items and the source stay in your stash.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Keep
            </Button>
            <Button variant="destructive" size="sm" onClick={onConfirmDelete} disabled={deleting}>
              {deleting ? <Loader2 className="size-4 animate-spin" /> : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
