'use client'

import { useState } from 'react'
import { FolderPlus } from 'lucide-react'
import { toast } from 'sonner'
import { useUpdateBrainDumpJobCollections } from '@/hooks/use-brain-dump'
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
    <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <FolderPlus className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Save to collection</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Saved items are added to a new collection and/or any existing collections you pick.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="parse-collection-name">New collection</Label>
          <Input
            id="parse-collection-name"
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
    </div>
  )
}
