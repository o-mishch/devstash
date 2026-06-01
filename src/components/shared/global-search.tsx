'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'
import debounce from 'lodash.debounce'
import {
  Command,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'
import { useItemsStore } from '@/context/items-store-context'
import { useItemDrawer } from '@/context/item-drawer-context'
import { globalSearchAction, type SearchResult } from '@/actions/search'
import type { CollectionWithTypes } from '@/types/collection'
import type { LightItem } from '@/types/item'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'

interface GlobalSearchProps {
  collections: CollectionWithTypes[]
}

export function GlobalSearch({ collections }: GlobalSearchProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [remoteResults, setRemoteResults] = useState<SearchResult>({ items: [], collections: [] })
  
  const { state: itemsStore } = useItemsStore()
  const { openDrawer, closeDrawer } = useItemDrawer()
  const router = useRouter()

  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
        closeDrawer()
      }
      if (e.key === 'Escape') {
        setOpen(false)
        inputRef.current?.blur()
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [closeDrawer])

  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', click)
    return () => document.removeEventListener('mousedown', click)
  }, [])

  // Debounced search for backend
  const debouncedSearch = useMemo(
    () =>
      debounce(async (q: string) => {
        if (!q.trim()) {
          setRemoteResults({ items: [], collections: [] })
          setLoading(false)
          return
        }
        setLoading(true)
        const res = await globalSearchAction({ query: q })
        if (res.status === 'ok' && res.data) {
          setRemoteResults(res.data)
        }
        setLoading(false)
      }, 300),
    []
  )

  useEffect(() => {
    debouncedSearch(query)
    return () => debouncedSearch.cancel()
  }, [query, debouncedSearch])

  // Local filtering
  const lowerQuery = query.toLowerCase()
  
  const localItems = useMemo(() => {
    if (!lowerQuery) return itemsStore.items.slice(0, 10)
    return itemsStore.items.filter(
      (item) =>
        item.title.toLowerCase().includes(lowerQuery) ||
        item.descriptionPreview?.toLowerCase().includes(lowerQuery) ||
        item.tags.some(t => t.toLowerCase().includes(lowerQuery))
    )
  }, [itemsStore.items, lowerQuery])

  const localCollections = useMemo(() => {
    if (!lowerQuery) return collections.slice(0, 10)
    return collections.filter(
      (col) =>
        col.name.toLowerCase().includes(lowerQuery) ||
        col.description?.toLowerCase().includes(lowerQuery)
    )
  }, [collections, lowerQuery])

  // Merge local and remote
  const displayItems = useMemo(() => {
    const map = new Map<string, LightItem>()
    localItems.forEach((i) => map.set(i.id, i))
    remoteResults.items.forEach((i) => map.set(i.id, i))
    return Array.from(map.values())
  }, [localItems, remoteResults.items])

  const displayCollections = useMemo(() => {
    const map = new Map<string, CollectionWithTypes>()
    localCollections.forEach((c) => map.set(c.id, c))
    remoteResults.collections.forEach((c) => map.set(c.id, c))
    return Array.from(map.values())
  }, [localCollections, remoteResults.collections])

  const handleSelect = useCallback((type: 'item' | 'collection', id: string) => {
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
    
    if (type === 'item') {
      const item = displayItems.find(i => i.id === id)
      if (item) {
        router.push(`/items/${item.itemType.name}s`)
        openDrawer(item)
      }
    } else {
      router.push(`/collections/${id}`)
    }
  }, [router, displayItems, openDrawer])

  const showList = open && (query.trim().length > 0 || displayItems.length > 0 || displayCollections.length > 0)

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
          <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden sm:flex items-center gap-1 opacity-50">
            <kbd className="pointer-events-none inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
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
                    <ItemTypeIcon iconName={item.itemType.icon} color={item.itemType.color} className="mr-2 size-4" />
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
                      <div className="size-2 rounded-full" style={{ backgroundColor: col.dominantColor || 'currentColor' }} />
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
