import { notFound, redirect } from 'next/navigation'
import { getCurrentUserId } from '@/lib/session'
import { loadProfileContext } from '@/lib/app/profile-helpers'
import { ProfileContent } from '@/components/profile/profile-content'
import { type ToastCode } from '@/components/profile/profile-toast'
import ProfileLoading from './loading'

interface ProfilePageProps {
  searchParams: Promise<{ toast?: string; skeleton?: string }>
}

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const params = await searchParams
  const flash = params.toast as ToastCode | undefined
  const userId = await getCurrentUserId()
  if (!userId) redirect('/sign-in')

  if (params.skeleton === 'true') return <ProfileLoading />

  // Seed the client cache from SSR so the profile page paints instantly (no skeleton flash, no extra
  // fetch) — the same shape GET /profile returns.
  const initialData = await loadProfileContext(userId)
  if (!initialData) notFound()

  return <ProfileContent initialData={initialData} toast={flash} />
}
