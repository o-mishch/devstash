import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { getParseJobSnapshot } from '@/lib/db/ai-parse-jobs'
import { getAllCollections } from '@/lib/db/collections'
import { ParseReviewBoard } from '@/components/parse/parse-review-board'
import { ParseSourceBanner } from '@/components/parse/parse-source-banner'
import { ParseBoardSkeleton } from '@/components/parse/parse-board-skeleton'

interface ParseJobPageProps {
  params: Promise<{ jobId: string }>
  searchParams: Promise<{ skeleton?: string; item?: string }>
}

// Review board for a single split job. Ownership is enforced server-side (the snapshot read is
// IDOR-scoped to the session user); a job that isn't the user's 404s. The board re-streams live via
// SSE, so it only needs the job id. Pro-gated: the splitter is Pro-only, so a user who downgraded
// after creating a job is sent back to /parse (which surfaces the upgrade prompt) rather than the board.
export default async function ParseJobPage({ params, searchParams }: ParseJobPageProps) {
  const { jobId } = await params
  const { skeleton, item: highlightItemId } = await searchParams
  const session = await getCachedSession()
  const userId = session?.user?.id
  if (!userId) redirect('/sign-in')

  const isPro = await getCachedVerifiedProAccess(userId)
  if (!isPro) redirect('/parse')

  // `?skeleton=true` preview: render the same skeleton loading.tsx shows. After the auth/Pro guards
  // (so it never leaks a protected page) but before the snapshot read (so it needs no real data).
  if (skeleton === 'true') return <ParseBoardSkeleton />

  const snapshot = await getParseJobSnapshot(userId, jobId)
  if (!snapshot) notFound()

  const collections = await getAllCollections(userId)

  return (
    <div className="app-page gap-4 p-3 sm:gap-6 sm:p-6">
      <Link
        href="/parse"
        className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Brain Dump
      </Link>
      <ParseReviewBoard
        jobId={jobId}
        collections={collections.map((collection) => ({ id: collection.id, name: collection.name }))}
        initialCollectionName={snapshot.collectionName}
        initialCollectionIds={snapshot.collectionIds}
        initialSnapshot={{
          status: snapshot.status,
          progress: snapshot.progress,
          error: snapshot.error,
          truncated: snapshot.truncated,
          committedCount: snapshot.committedCount,
          committedByType: snapshot.committedByType,
          items: snapshot.items,
        }}
        highlightItemId={highlightItemId}
        sourceBanner={
          <ParseSourceBanner
            sourceItemId={snapshot.sourceItemId}
            sourceName={snapshot.sourceName}
            truncated={snapshot.truncated}
          />
        }
      />
    </div>
  )
}
