import { redirect } from 'next/navigation'

interface FavoritesPageProps {
  searchParams: Promise<{ skeleton?: string }>
}

// Index redirect to the default Items tab. Carry `?skeleton=true` through so the skeleton preview
// works at /favorites too (the destination renders the same skeleton its loading.tsx shows).
export default async function FavoritesPage({ searchParams }: FavoritesPageProps) {
  const target = (await searchParams).skeleton === 'true' ? '/favorites/items?skeleton=true' : '/favorites/items'
  redirect(target)
}
