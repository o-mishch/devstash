import { redirect } from 'next/navigation'
import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { BrainDumpCard } from '@/components/parse/brain-dump-card'
import { ParseJobList } from '@/components/parse/parse-job-list'

// Brain Dump hub: the upload/paste entry card plus the user's in-progress splits. Auth is inherited
// from the (app) layout; the Pro gate is soft here (the card prompts to upgrade) so a free user can
// still see the feature.
export default async function ParseIndexPage() {
  const session = await getCachedSession()
  const userId = session?.user?.id
  if (!userId) redirect('/sign-in')

  const isPro = await getCachedVerifiedProAccess(userId)

  return (
    <div className="app-page gap-4 p-3 sm:gap-6 sm:p-6">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        <BrainDumpCard isPro={isPro} />
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">In progress</h2>
          <ParseJobList />
        </section>
      </div>
    </div>
  )
}
