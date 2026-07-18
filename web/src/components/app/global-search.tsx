import type { ReactElement } from 'react'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { FolderOpen, Search } from 'lucide-react'
import { globalSearchOptions } from '@/client/@tanstack/react-query.gen'
import { itemTypeMeta } from '@/lib/item-types'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

/** Topbar search field that opens the ⌘K command palette. */
export function GlobalSearch(): ReactElement {
  const [open, setOpen] = useState(false)

  // ⌘K / Ctrl-K opens search from anywhere. A document-level keydown listener is the only way
  // to catch a global shortcut that isn't scoped to a focused element (no React alternative).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', onKey)
    return (): void => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full max-w-xl items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/60"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search items…</span>
        <kbd className="hidden rounded border border-border bg-background px-1.5 font-mono text-[0.65rem] sm:inline">
          ⌘K
        </kbd>
      </button>
      <SearchDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

interface SearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function SearchDialog({ open, onOpenChange }: SearchDialogProps): ReactElement {
  const [q, setQ] = useState('')
  const term = q.trim()
  const search = useQuery({
    ...globalSearchOptions({ query: { q: term } }),
    enabled: open && term.length >= 2,
  })

  const items = search.data?.items ?? []
  const collections = search.data?.collections ?? []
  const hasResults = items.length > 0 || collections.length > 0
  const close = (): void => onOpenChange(false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-24 max-w-xl translate-y-0 gap-0 p-0" showCloseButton={false}>
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search items and collections…"
            className="h-11 border-0 bg-transparent px-0 focus-visible:ring-0"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {term.length < 2 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              Type at least 2 characters to search.
            </p>
          )}
          {term.length >= 2 && search.isError && (
            <p className="px-2 py-6 text-center text-sm text-destructive">
              Search failed. Please try again.
            </p>
          )}
          {term.length >= 2 && !search.isError && !hasResults && !search.isFetching && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No results for “{term}”.
            </p>
          )}
          {collections.length > 0 && (
            <div className="mb-1">
              <p className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground/60">
                Collections
              </p>
              {collections.map((c) => (
                <Link
                  key={c.id}
                  to="/collections/$id"
                  params={{ id: c.id }}
                  onClick={close}
                  className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <FolderOpen className="size-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="font-mono text-xs text-muted-foreground/70">{c.itemCount}</span>
                </Link>
              ))}
            </div>
          )}
          {items.length > 0 && (
            <div>
              <p className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground/60">Items</p>
              {items.map((item) => {
                const meta = itemTypeMeta(item.itemType.name)
                const Icon = meta?.icon ?? Search
                return (
                  <Link
                    key={item.id}
                    to="/items/$type"
                    params={{ type: item.itemType.name }}
                    onClick={close}
                    className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <Icon className={cn('size-4', meta ? meta.accent : 'text-muted-foreground')} />
                    <span className="flex-1 truncate">{item.title}</span>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
