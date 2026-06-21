'use client'

import Link from 'next/link'
import { ArrowRight, Loader2 } from 'lucide-react'
import { useActiveBrainDumpJobs } from '@/hooks/use-brain-dump'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'

// In-progress split jobs (the /parse index list). Polls while any job is still processing so a
// background run that finishes elsewhere updates here without a manual refresh.
export function ParseJobList() {
  const { data, isLoading } = useActiveBrainDumpJobs()
  const jobs = data?.jobs ?? []

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
    <div className="flex flex-col gap-2">
      {jobs.map((job) => (
        <Link
          key={job.id}
          href={`/parse/${job.id}`}
          className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent/40"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {job.itemCount} draft{job.itemCount === 1 ? '' : 's'}
              </span>
              <Badge variant="secondary" className="text-[10px]">
                {job.status}
              </Badge>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {job.sourceName ?? 'Unknown source'}
            </p>
            <Progress value={job.progress} className="mt-2 h-1" />
          </div>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      ))}
    </div>
  )
}
