'use client'

import { useState, type MouseEvent, type KeyboardEvent } from 'react'
import { X, ChevronsUpDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

import type { CollectionPickerItem } from '@/types/collection'

interface CollectionSelectorProps {
  collections: CollectionPickerItem[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

export function CollectionSelector({ collections, selectedIds, onChange }: CollectionSelectorProps) {
  const [open, setOpen] = useState(false)

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

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
            className="w-full min-h-9 h-auto touch:h-auto touch:min-h-11 justify-between font-normal hover:bg-transparent"
          />
        }
      >
        <span className="flex flex-wrap gap-1.5 flex-1 min-w-0">
          {selectedCollections.length === 0 ? (
            <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">Search and select collections...</span>
          ) : (
            selectedCollections.map((col) => (
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
            ))
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
      >
        <Command>
          <CommandInput placeholder="Search collections..." />
          <CommandList>
            <CommandEmpty>No collection found.</CommandEmpty>
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
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
