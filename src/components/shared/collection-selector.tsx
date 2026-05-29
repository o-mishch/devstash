'use client'

import { useState, type MouseEvent } from 'react'
import { X, ChevronsUpDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

import type { CollectionWithTypes } from '@/types/collection'

interface CollectionSelectorProps {
  collections: CollectionWithTypes[]
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

  const unselect = (id: string, e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    toggleCollection(id)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            className="w-full min-h-9 h-auto justify-between font-normal hover:bg-transparent"
          />
        }
      >
        <span className="flex flex-wrap gap-1.5 flex-1 min-w-0">
          {selectedCollections.length === 0 ? (
            <span className="text-muted-foreground">Search and select collections...</span>
          ) : (
            selectedCollections.map((col) => (
              <Badge
                key={col.id}
                variant="outline"
                className="px-2 py-0.5 text-xs font-medium bg-foreground/10 text-foreground border-foreground/20"
              >
                {col.name}
                <button
                  type="button"
                  className="ml-1.5 rounded-full outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2 hover:bg-foreground/10 p-0.5"
                  onClick={(e) => unselect(col.id, e)}
                >
                  <X className="size-3" />
                  <span className="sr-only">Remove {col.name}</span>
                </button>
              </Badge>
            ))
          )}
        </span>
        <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
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
