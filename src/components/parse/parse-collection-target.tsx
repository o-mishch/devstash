'use client'

import { useItemDetail } from '@/hooks/items/use-item-detail'
import { CollectionSelector } from '@/components/shared/collection-selector'
import { deriveCollectionName } from '@/lib/utils/derive-source-label'
import type { CollectionPickerItem } from '@/types/collection'

interface ParseCollectionTargetProps {
  collections: CollectionPickerItem[]
  // Source item id — its live title is the truest basis for the "create a collection" suggestion (the
  // file name, or the dated "Brain dump …" label for a paste), beating the job's denormalized sourceName
  // which for a paste is the first content line.
  sourceItemId: string | null
  // Server fallback used until the live title loads / if the source is gone (file name or dated label).
  suggestedName: string
  // Controlled by the board (it owns the job's target so the draft drawers can show it read-only).
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

// Commit-time collection target for a Brain Dump job: saved items join every collection picked here.
// A single creatable combobox replaces the old name-input + multiselect pair — the selector itself owns
// the create flow (Create row → prefilled dialog → eager-create → auto-select). Lives in the source
// widget. The only Brain-Dump-specific bit here is seeding the suggestion from the live source title.
export function ParseCollectionTarget({ collections, sourceItemId, suggestedName, selectedIds, onChange }: ParseCollectionTargetProps) {
  // Shared cache with the source banner's reader (same key) — no extra fetch. The live title tracks
  // renames and is the dated label for a paste, so it's a better suggestion than the stored sourceName.
  const liveTitle = useItemDetail(sourceItemId).data?.title
  const suggestion = (liveTitle && deriveCollectionName(liveTitle)) || suggestedName

  return (
    <div>
      <CollectionSelector
        creatable
        collections={collections}
        selectedIds={selectedIds}
        onChange={onChange}
        suggestedName={suggestion}
        placeholder="Save items to collection"
      />
    </div>
  )
}
