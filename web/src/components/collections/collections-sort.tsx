import type { ReactNode } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { COLLECTION_SORTS, COLLECTION_SORT_LABELS, toCollectionSort } from '@/lib/collection-sort'
import type { CollectionSort } from '@/lib/collection-sort'

interface CollectionsSortProps {
  value: CollectionSort
  onChange: (value: CollectionSort) => void
}

/** Sort dropdown for the collections index. The selection is owned by the route's search param. */
export function CollectionsSort({ value, onChange }: CollectionsSortProps): ReactNode {
  return (
    <Select value={value} onValueChange={(next) => onChange(toCollectionSort(next))}>
      <SelectTrigger size="sm" className="w-[160px]" aria-label="Sort collections">
        {/* Render function maps the stored value ('recent') to its human label; a bare
            <SelectValue /> would show the raw value. */}
        <SelectValue>
          {(selected) => COLLECTION_SORT_LABELS[toCollectionSort(selected)]}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {COLLECTION_SORTS.map((sort) => (
          <SelectItem key={sort} value={sort}>
            {COLLECTION_SORT_LABELS[sort]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
