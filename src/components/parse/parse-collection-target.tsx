'use client'

import { useState } from 'react'
import { FolderPlus } from 'lucide-react'
import { toast } from 'sonner'
import { useUpdateBrainDumpJobCollections } from '@/hooks/use-brain-dump'
import { CollapsibleCard } from '@/components/shared/collapsible-card'
import { CollectionSelector } from '@/components/shared/collection-selector'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { CollectionPickerItem } from '@/types/collection'

interface ParseCollectionTargetProps {
  jobId: string
  collections: CollectionPickerItem[]
  initialName: string | null
  initialIds: string[]
}

// Commit-time collection target for a Brain Dump job: a new collection (name defaults to the upload
// filename, editable, clearable) and/or one-or-more existing collections. Saved items join the union
// of both. The name persists on blur; the existing-collection selection persists on every change.
export function ParseCollectionTarget({ jobId, collections, initialName, initialIds }: ParseCollectionTargetProps) {
  const updateCollections = useUpdateBrainDumpJobCollections()
  const [name, setName] = useState(initialName ?? '')
  const [selectedIds, setSelectedIds] = useState<string[]>(initialIds)
  // Last value persisted to the server, so an unchanged blur is a no-op.
  const [savedName, setSavedName] = useState(initialName ?? '')

  const persistName = async () => {
    const next = name.trim()
    if (next === savedName) return
    const ok = await updateCollections(jobId, { collectionName: next || null })
    if (!ok) {
      toast.error('Could not save collection name')
      return
    }
    setSavedName(next)
  }

  const persistIds = async (ids: string[]) => {
    setSelectedIds(ids)
    const ok = await updateCollections(jobId, { collectionIds: ids })
    if (!ok) toast.error('Could not update collections')
  }

  return (
    <CollapsibleCard
      title="Save to collection"
      icon={<FolderPlus />}
      subtitle="Saved items are added to a new collection and/or any existing collections you pick."
      // Mirror the board's bento buckets: a translucent muted fill instead of the opaque tier-1 card
      // surface. Important modifiers override `card-tier-1`'s background (same @layer, defined later).
      className="bg-muted/20! hover:bg-muted/40!"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="parse-collection-name">New collection</Label>
          <Input
            id="parse-collection-name"
            className="card-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={persistName}
            placeholder="Leave blank to skip"
          />
        </div>
        <div className="space-y-1">
          <Label>Existing collections</Label>
          {collections.length > 0 ? (
            <CollectionSelector collections={collections} selectedIds={selectedIds} onChange={persistIds} />
          ) : (
            <p className="pt-2 text-xs text-muted-foreground">You have no collections yet.</p>
          )}
        </div>
      </div>
    </CollapsibleCard>
  )
}
