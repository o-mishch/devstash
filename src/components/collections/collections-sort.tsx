'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function CollectionsSort() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const sort = searchParams.get('sort') || 'recent'

  function onSortChange(value: string | null) {
    if (!value) return
    const params = new URLSearchParams(searchParams.toString())
    params.set('sort', value)
    router.push(`?${params.toString()}`)
  }

  return (
    <Select value={sort} onValueChange={onSortChange}>
      <SelectTrigger className="w-[140px] h-9 text-sm">
        <SelectValue placeholder="Sort by" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="recent">Recently updated</SelectItem>
        <SelectItem value="oldest">Oldest first</SelectItem>
        <SelectItem value="az">Name (A-Z)</SelectItem>
        <SelectItem value="za">Name (Z-A)</SelectItem>
      </SelectContent>
    </Select>
  )
}
