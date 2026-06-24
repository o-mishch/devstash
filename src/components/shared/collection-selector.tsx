'use client'

import { useRef, useState, type MouseEvent, type KeyboardEvent } from 'react'
import { X, ChevronsUpDown, Plus, Eraser } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { morphOriginFromClick, type MorphOrigin } from '@/components/ui/responsive-form-dialog'
import { CollectionCreateDialog } from '@/components/collections/collection-create-dialog'
import { useCollections } from '@/hooks/items/use-collections'

import type { CollectionPickerItem } from '@/types/collection'

interface CollectionSelectorProps {
  selectedIds: string[]
  onChange: (ids: string[]) => void
  // Explicit list to choose from. OMIT to self-source from the shared `useCollections` cache: every
  // selector shares one query + one request (TanStack dedupe), served from the SSR-seeded cache so
  // opening it reads cache with no fetch. Pass a list only to show a curated subset.
  collections?: CollectionPickerItem[]
  // Enable the inline "Create <name>" / "Clear" affordance. Self-contained: selecting Create opens the
  // collection dialog (morphing out of the row), eager-creates, and auto-selects the result.
  creatable?: boolean
  // Default candidate shown in the Create row when the search box is empty (e.g. a Brain Dump source
  // name). Without it, Create only appears once the user types a non-matching name.
  suggestedName?: string
  placeholder?: string
}

export function CollectionSelector({ selectedIds, onChange, collections: collectionsProp, creatable = false, suggestedName, placeholder = 'Search and select collections...' }: CollectionSelectorProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  // Pointer position of the last press on the Create row, so the dialog can morph out of it (keyboard
  // selection leaves it null → the dialog falls back to the default zoom).
  const createOriginRef = useRef<MorphOrigin | null>(null)
  // The name handed to the create dialog; non-null opens it. Origin morphs the dialog out of the row.
  const [createName, setCreateName] = useState<string | null>(null)
  const [createOrigin, setCreateOrigin] = useState<MorphOrigin | null>(null)

  // Self-source from the shared cache when no explicit list is given (query disabled when one is, to
  // avoid an idle fetch). Deduped across every selector and seeded by the app chrome — reads cache.
  const selfSourced = useCollections({ enabled: collectionsProp === undefined })
  const collections: CollectionPickerItem[] =
    collectionsProp ?? selfSourced.collections.map((c) => ({ id: c.id, name: c.name }))

  const selectedCollections = collections.filter(c => selectedIds.includes(c.id))

  const toggleCollection = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter(sid => sid !== id))
    } else {
      onChange([...selectedIds, id])
    }
  }

  const unselect = (id: string, e: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    toggleCollection(id)
  }

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setSearch('')
  }

  // Auto-select the freshly created collection (it lands in the shared cache via the dialog's seeder, so
  // it also appears in `collections` here) and close the dialog.
  const handleCreated = (collection: CollectionPickerItem) => {
    setCreateName(null)
    if (!selectedIds.includes(collection.id)) onChange([...selectedIds, collection.id])
  }

  // The name a "Create" would use: the typed query, or the suggestion when the box is empty. Hidden when
  // it already names an existing collection (case-insensitive) so the matching row is the obvious target.
  const trimmedSearch = search.trim()
  const candidateName = trimmedSearch || (suggestedName?.trim() ?? '')
  const hasExactMatch = collections.some(c => c.name.toLowerCase() === candidateName.toLowerCase())
  const showCreate = creatable && candidateName.length > 0 && !hasExactMatch

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          nativeButton={false}
          render={
            <Button
              render={<div />}
              nativeButton={false}
              variant="outline"
              role="combobox"
              // touch:h-auto + touch:min-h-11 override the Button's default `touch:h-11` (a fixed
              // 44px tap height): on mobile that fixed height clipped this multiselect so several
              // wrapped collection badges overflowed the box and spilled over the label above. We
              // keep the 44px floor as a min-height so an empty trigger stays an easy tap target.
              className="@container/collection-trigger w-full min-h-9 h-auto touch:h-auto touch:min-h-11 justify-between font-normal hover:bg-transparent"
            />
          }
        >
          <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {selectedCollections.length === 0 ? (
              <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">{placeholder}</span>
            ) : (
              <>
                <span className="flex min-w-0 flex-1 flex-wrap gap-1.5 @max-[22rem]/collection-trigger:hidden">
                  {selectedCollections.map((col) => (
                    <Badge
                      key={col.id}
                      variant="outline"
                      className="px-2 py-0.5 text-xs font-medium bg-foreground/10 text-foreground border-foreground/20"
                    >
                      {col.name}
                      <div
                        role="button"
                        tabIndex={0}
                        className="ml-1.5 cursor-pointer rounded-full outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2 hover:bg-foreground/10 p-0.5"
                        onClick={(e) => unselect(col.id, e)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            unselect(col.id, e)
                          }
                        }}
                      >
                        <X className="size-3" />
                        <span className="sr-only">Remove {col.name}</span>
                      </div>
                    </Badge>
                  ))}
                </span>
                <span className="hidden min-w-0 flex-1 truncate text-left text-foreground @max-[22rem]/collection-trigger:block">
                  {selectedCollections.length} collection{selectedCollections.length === 1 ? '' : 's'} selected
                </span>
              </>
            )}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </PopoverTrigger>
        {/* Match the trigger width (Base UI's --anchor-width) so the dropdown lines up under the
            field and never spills past the dialog's right edge when the field is in a right column.
            On a mobile bottom sheet this field sits near the bottom, so the popup flips upward over
            the form: bound it to Base UI's --available-height (the list scrolls within) and give it a
            strong shadow + solid border so it reads as a distinct floating menu over the dark sheet
            instead of a murky overlap. */}
        <PopoverContent
          className="w-(--anchor-width) min-w-48 max-h-(--available-height) overflow-hidden border border-border p-0 shadow-xl"
          align="start"
          sideOffset={6}
          // On touch/pen, don't move focus to the search input on open — auto-focusing it pops the
          // mobile keyboard, which lifts/resizes the bottom sheet and drags this anchored popover
          // upward (a jump). Desktop keeps default focus for type-to-search.
          initialFocus={(openType) => openType !== 'touch' && openType !== 'pen'}
        >
          <Command>
            <CommandInput placeholder="Search or name a collection..." value={search} onValueChange={setSearch} />
            <CommandList>
              {/* In creatable mode the Create row IS the empty-state affordance, so the bare "not found"
                  message is suppressed (it would read as a dead end above an actionable Create). */}
              {!creatable && <CommandEmpty>No collection found.</CommandEmpty>}
              {collections.length > 0 && (
                <CommandGroup>
                  {collections.map((col) => {
                    const isSelected = selectedIds.includes(col.id)
                    return (
                      <CommandItem
                        key={col.id}
                        value={col.name}
                        onSelect={() => toggleCollection(col.id)}
                        data-checked={isSelected || undefined}
                      >
                        {col.name}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              )}
              {showCreate && (
                <>
                  {collections.length > 0 && <CommandSeparator alwaysRender />}
                  <CommandGroup forceMount>
                    <CommandItem
                      forceMount
                      value={`__create__${candidateName}`}
                      onPointerDown={(e) => {
                        createOriginRef.current = morphOriginFromClick(e)
                      }}
                      onSelect={() => {
                        setCreateOrigin(createOriginRef.current)
                        createOriginRef.current = null
                        setCreateName(candidateName)
                        handleOpenChange(false)
                      }}
                    >
                      <Plus className="text-muted-foreground" />
                      Create “{candidateName}”
                    </CommandItem>
                    {trimmedSearch.length > 0 && (
                      <CommandItem forceMount value="__clear__" onSelect={() => setSearch('')}>
                        <Eraser className="text-muted-foreground" />
                        Clear
                      </CommandItem>
                    )}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {creatable && (
        <CollectionCreateDialog
          open={createName !== null}
          onOpenChange={(o) => {
            if (!o) setCreateName(null)
          }}
          defaultName={createName ?? ''}
          morphOrigin={createOrigin}
          onCreated={handleCreated}
        />
      )}
    </>
  )
}
