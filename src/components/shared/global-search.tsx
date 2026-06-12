'use client'

import { useState, useCallback, useRef, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { Command as CommandPrimitive } from 'cmdk'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'
import {
  Command,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'
import { useItemsStore } from '@/stores/items'
import { useItemDrawerStore } from '@/stores/item-drawer'
import type { SidebarCollection } from '@/types/collection'
import { searchResultToLightItem, isSearchResultItem } from '@/types/item'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'

import { useGlobalSearch } from '@/hooks/use-global-search'
import { useGlobalSearchShortcuts } from '@/hooks/use-global-search-shortcuts'

interface GlobalSearchProps {
  collections: SidebarCollection[]
}

export function GlobalSearch({ collections }: GlobalSearchProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const storeItems = useItemsStore((state) => state.items)
  const items = useMemo(() => Array.from(storeItems.values()), [storeItems])
  const { openDrawer, closeDrawer } = useItemDrawerStore()
  const router = useRouter()

  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useGlobalSearchShortcuts({ inputRef, containerRef, setOpen, closeDrawer })
  const { loading, displayItems, displayCollections } = useGlobalSearch(query, items, collections)

  const handleSelect = useCallback((type: 'item' | 'collection', id: string) => {
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()

    if (type === 'item') {
      const storeItem = items.find(i => i.id === id)
      const displayHit = displayItems.find(i => i.id === id)
      const item = storeItem ?? (displayHit && isSearchResultItem(displayHit)
        ? searchResultToLightItem(displayHit)
        : displayHit ?? undefined)
      if (item && 'tags' in item) {
        flushSync(() => openDrawer(item))
        router.push(`/items/${item.itemType.name}s`)
      }
    } else {
      router.push(`/collections/${id}`)
    }
  }, [router, displayItems, items, openDrawer])

  const hasQuery = query.trim().length > 0
  const hasResults = displayItems.length > 0 || displayCollections.length > 0
  const showList = open && (hasQuery || hasResults)

  return (
    <div ref={containerRef} className="relative mx-auto min-w-0 flex-1 max-w-sm">
    <Command shouldFilter={false} className="overflow-visible bg-transparent">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <CommandPrimitive.Input
          ref={inputRef}
          value={query}
          onValueChange={setQuery}
          onFocus={() => setOpen(true)}
          placeholder="Search items..."
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 pl-8"
          suppressHydrationWarning
        />
        {query.length > 0 ? (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center size-6 text-muted-foreground hover:text-foreground rounded-sm hover:bg-muted"
            onClick={(e) => {
              e.stopPropagation()
              setQuery('')
              inputRef.current?.focus()
            }}
          >
            <X className="size-4" />
          </button>
        ) : (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden sm:flex items-center gap-1">
            <kbd className="pointer-events-none inline-flex h-5 items-center gap-1 rounded border border-border/50 bg-muted-foreground/10 px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
              <span className="text-xs">⌘</span>K
            </kbd>
          </div>
        )}
      </div>

      {showList && (
        <div className="absolute top-full left-0 z-50 mt-1.5 w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 slide-in-from-top-2">
          <CommandList className="max-h-[60vh] overflow-y-auto p-1">
            {loading && (
              <CommandPrimitive.Loading>
                <div className="py-2 text-center text-xs text-muted-foreground">Searching...</div>
              </CommandPrimitive.Loading>
            )}
            <CommandEmpty className="py-6 text-center text-sm">No results found.</CommandEmpty>

            {displayItems.length > 0 && (
              <CommandGroup heading="Items">
                {displayItems.map((item) => (
                  <CommandItem 
                    key={item.id}
                    value={`item-${item.id}`}
                    onSelect={() => handleSelect('item', item.id)}
                  >
                    <ItemTypeIcon typeName={item.itemType.name} className="mr-2 size-4" />
                    <span className="flex-1 truncate">{item.title}</span>
                    {item.descriptionPreview && (
                      <span className="text-xs text-muted-foreground truncate max-w-[120px] ml-2 hidden sm:inline-block">
                        {item.descriptionPreview}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {displayCollections.length > 0 && (
              <CommandGroup heading="Collections">
                {displayCollections.map((col) => (
                  <CommandItem 
                    key={col.id}
                    value={`col-${col.id}`}
                    onSelect={() => handleSelect('collection', col.id)}
                  >
                    <div className="mr-2 flex size-4 items-center justify-center rounded-sm bg-primary/10">
                      <div className="size-2 rounded-full bg-primary/50" />
                    </div>
                    <span className="flex-1 truncate">{col.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {col.itemCount} item{col.itemCount !== 1 ? 's' : ''}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </div>
      )}
    </Command>
    </div>
  )
}
