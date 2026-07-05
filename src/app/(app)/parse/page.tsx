import { redirect } from 'next/navigation'
import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { BrainDumpCard } from '@/components/parse/brain-dump-card'
import { ParseJobList } from '@/components/parse/parse-job-list'
import { ParseHistoryList } from '@/components/parse/parse-history-list'
import { CollapsibleSection } from '@/components/parse/collapsible-section'
import { ParseIndexSkeleton } from '@/components/parse/parse-index-skeleton'

interface ParseIndexPageProps {
  searchParams: Promise<{ skeleton?: string }>
}

// Brain Dump hub: the upload/paste entry card plus the user's in-progress splits. Auth is inherited
// from the (app) layout. Brain Dump is Pro-only: the edge proxy (auth.config.ts) redirects non-Pro
// users to /upgrade before this renders (removing the pre-redirect flash), and the server guard below
// is the durable belt-and-suspenders — a direct URL visit is denied even if the edge check is bypassed.
export default async function ParseIndexPage({ searchParams }: ParseIndexPageProps) {
  const session = await getCachedSession()
  const userId = session?.user?.id
  if (!userId) redirect('/sign-in')

  const { skeleton } = await searchParams
  // `?skeleton=true` preview, after the auth guard, before any read (see the nextjs-architecture rule).
  if (skeleton === 'true') return <ParseIndexSkeleton />

  const isPro = await getCachedVerifiedProAccess(userId)
  if (!isPro) redirect('/upgrade?gate=brain-dump')

  return (
    <div className="app-page gap-4 p-3 sm:gap-6 sm:p-6">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        <BrainDumpCard isPro={isPro} />
        <CollapsibleSection title="In progress">
          <ParseJobList />
        </CollapsibleSection>
        <CollapsibleSection title="History">
          <ParseHistoryList />
        </CollapsibleSection>
      </div>
    </div>
  )
}
