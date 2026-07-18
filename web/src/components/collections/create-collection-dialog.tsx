import type { MouseEvent, ReactNode, SyntheticEvent } from 'react'
import { useState } from 'react'
import { FolderPlus } from 'lucide-react'
import { useCreateCollection } from '@/hooks/use-collections'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ResponsiveFormDialog, morphOriginFromClick } from '@/components/ui/responsive-form-dialog'
import type { MorphOrigin } from '@/components/ui/responsive-form-dialog'

/**
 * The compact collection-create flow: a narrow morph-opening dialog on desktop, a resizable bottom
 * sheet on mobile (dragging the grab handle grows the sheet, and the description grows with it).
 * The unified New Item dialog can also create a collection; this is the direct entry point.
 */
export function CreateCollectionDialog(): ReactNode {
  const [open, setOpen] = useState(false)
  const [morphOrigin, setMorphOrigin] = useState<MorphOrigin | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const create = useCreateCollection()

  const trimmed = name.trim()

  const openDialog = (e: MouseEvent): void => {
    setMorphOrigin(morphOriginFromClick(e))
    setOpen(true)
  }

  const onSubmit = (e: SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault()
    if (trimmed.length === 0) return
    create.mutate(
      { body: { name: trimmed, description: description.trim() || undefined } },
      {
        onSuccess: () => {
          setName('')
          setDescription('')
          setOpen(false)
        },
      },
    )
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={openDialog}>
        <FolderPlus className="size-4" />
        New Collection
      </Button>

      <ResponsiveFormDialog
        open={open}
        onOpenChange={setOpen}
        title="New Collection"
        description="Group related items together."
        morphOrigin={morphOrigin}
        desktopClassName="sm:max-w-[440px]"
        mobileResizable
      >
        {() => (
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col gap-4 pt-2">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-0.5">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="collection-name">Name</Label>
                <Input
                  id="collection-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. React Patterns"
                  maxLength={100}
                  required
                />
              </div>
              {/* flex-1 so the description grows into the space a resize drag opens up. */}
              <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                <Label htmlFor="collection-description">Description</Label>
                <Textarea
                  id="collection-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What goes in this collection?"
                  maxLength={500}
                  className="min-h-20 flex-1"
                />
              </div>
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-border pt-3">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending || trimmed.length === 0}>
                {create.isPending ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </form>
        )}
      </ResponsiveFormDialog>
    </>
  )
}
