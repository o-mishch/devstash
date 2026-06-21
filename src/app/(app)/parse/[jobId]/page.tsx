import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { getParseJobSnapshot } from '@/lib/db/ai-parse-jobs'
import { getAllCollections } from '@/lib/db/collections'
import { ParseReviewBoard } from '@/components/parse/parse-review-board'
import { ParseSourceBanner } from '@/components/parse/parse-source-banner'

interface ParseJobPageProps {
  params: Promise<{ jobId: string }>
}

// Review board for a single split job. Ownership is enforced server-side (the snapshot read is
// IDOR-scoped to the session user); a job that isn't the user's 404s. The board re-streams live via
// SSE, so it only needs the job id. Pro-gated: the splitter is Pro-only, so a user who downgraded
// after creating a job is sent back to /parse (which surfaces the upgrade prompt) rather than the board.
export default async function ParseJobPage({ params }: ParseJobPageProps) {
  const { jobId } = await params
  const session = await getCachedSession()
  const userId = session?.user?.id
  if (!userId) redirect('/sign-in')

  const isPro = await getCachedVerifiedProAccess(userId)
  if (!isPro) redirect('/parse')

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
      <ParseSourceBanner
        sourceItemId={snapshot.sourceItemId}
        sourceItemType={snapshot.sourceItemType}
        sourceName={snapshot.sourceName}
        truncated={snapshot.truncated}
      />
      <ParseReviewBoard
        jobId={jobId}
        collections={collections.map((collection) => ({ id: collection.id, name: collection.name }))}
        initialCollectionName={snapshot.collectionName}
        initialCollectionIds={snapshot.collectionIds}
      />
    </div>
  )
}
