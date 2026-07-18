import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { Check, Copy, FileText, Pin, Trash2 } from 'lucide-react'
import type { LightItem } from '@/client'
import { itemTypeMeta } from '@/lib/item-types'
import { relativeTime } from '@/lib/date'
import { CARD_SURFACE, cn, hasText } from '@/lib/utils'
import { FavoriteStar } from '@/components/ui/favorite-star'
import {
  fetchItemContent,
  useDeleteItem,
  useToggleItemFavorite,
  useToggleItemPinned,
} from '@/hooks/use-items'
import { useItemDrawerStore } from '@/stores/item-drawer'

interface ItemCardProps {
  item: LightItem
}

export function ItemCard({ item }: ItemCardProps): ReactNode {
  const meta = itemTypeMeta(item.itemType.name)
  const Icon = meta?.icon ?? FileText

  const openDrawer = useItemDrawerStore((s) => s.openDrawer)
  const favorite = useToggleItemFavorite()
  const pinned = useToggleItemPinned()
  const remove = useDeleteItem()

  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const confirmResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear pending timeouts if the card unmounts first (no setState on unmounted).
  useEffect(() => {
    return (): void => {
      if (copyResetRef.current !== null) clearTimeout(copyResetRef.current)
      if (confirmResetRef.current !== null) clearTimeout(confirmResetRef.current)
    }
  }, [])

  async function handleCopy(): Promise<void> {
    let text = item.url ?? ''
    if (!text) {
      try {
        text = await fetchItemContent(item.id)
      } catch {
        // Never fall back to `contentPreview` — it's a LEFT(content,150) truncation, so
        // copying it would hand the user 150 characters of a 400-line snippet under a ✓.
        toast.error('Couldn’t load the full content')
        return
      }
    }
    if (!text) {
      toast.error('Nothing to copy')
      return
    }
    // navigator.clipboard: no framework-level alternative for copy-to-clipboard.
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (copyResetRef.current !== null) clearTimeout(copyResetRef.current)
      copyResetRef.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked (e.g. insecure context) — surface it rather than failing silently.
      toast.error('Couldn’t copy to clipboard')
    }
  }

  return (
    // Stretched-button pattern: a full-bleed overlay <button> opens the detail drawer, so the whole
    // card is one keyboard-focusable target without nesting the action buttons inside it. The action
    // row sits above the overlay via z-10 so its own controls stay independently clickable.
    <div className={cn('group relative flex flex-col gap-3', CARD_SURFACE)}>
      <button
        type="button"
        aria-label={`Open ${item.title}`}
        onClick={() => openDrawer(item)}
        className="absolute inset-0 rounded-xl"
      />
      <div className="flex items-center gap-2">
        <Icon className={cn('size-4', meta?.accent ?? 'text-muted-foreground')} />
        <span className="font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground">
          {meta?.label ?? item.itemType.name}
        </span>
        {item.isPinned && <Pin className="size-3 text-primary" fill="currentColor" />}
        <span className="ml-auto font-mono text-[0.65rem] text-muted-foreground/60">
          {relativeTime(item.createdAt)}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <h3 className="text-sm font-medium leading-snug text-card-foreground">{item.title}</h3>
        <ItemPreview item={item} />
      </div>

      {item.tags && item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {item.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] text-muted-foreground"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      <div className="relative z-10 mt-auto flex items-center gap-1 pt-1">
        <IconAction label="Copy" onClick={() => void handleCopy()} active={copied}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </IconAction>
        {/* Disabled while in flight: there is no optimistic update, so `item.isFavorite`
            stays stale for the whole round trip and a second click would re-send the
            identical body — a duplicate toast and a wasted rate-limit token. */}
        <IconAction
          label="Favorite"
          active={item.isFavorite}
          disabled={favorite.isPending}
          onClick={() =>
            favorite.mutate({
              path: { id: item.id },
              body: { isFavorite: !item.isFavorite },
            })
          }
        >
          <FavoriteStar isFavorite={item.isFavorite} />
        </IconAction>
        <IconAction
          label="Pin"
          active={item.isPinned}
          disabled={pinned.isPending}
          onClick={() =>
            pinned.mutate({
              path: { id: item.id },
              body: { isPinned: !item.isPinned },
            })
          }
        >
          <Pin
            className={cn('size-4', item.isPinned && 'text-primary')}
            fill={item.isPinned ? 'currentColor' : 'none'}
          />
        </IconAction>

        <div className="ml-auto flex items-center gap-1">
          {confirming ? (
            <>
              <button
                type="button"
                disabled={remove.isPending}
                onClick={() => {
                  if (confirmResetRef.current !== null) clearTimeout(confirmResetRef.current)
                  // On success the card unmounts; on failure disarm it, or it stays red
                  // forever with no auto-revert (the timeout was just cleared).
                  remove.mutate({ path: { id: item.id } }, { onError: () => setConfirming(false) })
                }}
                className="rounded-md px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false)
                  if (confirmResetRef.current !== null) clearTimeout(confirmResetRef.current)
                }}
                className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
            </>
          ) : (
            <IconAction
              label="Delete"
              onClick={() => {
                setConfirming(true)
                if (confirmResetRef.current !== null) clearTimeout(confirmResetRef.current)
                confirmResetRef.current = setTimeout(() => setConfirming(false), 5000)
              }}
            >
              <Trash2 className="size-4" />
            </IconAction>
          )}
        </div>
      </div>
    </div>
  )
}

interface ItemPreviewProps {
  item: LightItem
}

// A stored `link` URL is only rendered as a live anchor when it is http(s). A value saved with
// a `javascript:`/`data:` scheme (self-XSS today since items are owner-scoped, cross-user once
// sharing ships) parses to some other protocol and renders as inert text instead.
function safeHttpUrl(url: string | null | undefined): string | null {
  if (!hasText(url)) return null
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function ItemPreview({ item }: ItemPreviewProps): ReactNode {
  if (hasText(item.url)) {
    const safeUrl = safeHttpUrl(item.url)
    if (safeUrl === null) {
      return <span className="truncate font-mono text-xs text-muted-foreground">{item.url}</span>
    }
    return (
      <a
        href={safeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="truncate font-mono text-xs text-primary hover:underline"
      >
        {safeUrl}
      </a>
    )
  }
  if (hasText(item.contentPreview)) {
    return (
      <pre className="line-clamp-3 overflow-hidden whitespace-pre-wrap break-words rounded-md bg-background/60 p-2 font-mono text-xs text-muted-foreground">
        {item.contentPreview}
      </pre>
    )
  }
  if (hasText(item.descriptionPreview)) {
    return <p className="line-clamp-2 text-xs text-muted-foreground">{item.descriptionPreview}</p>
  }
  if (hasText(item.fileName)) {
    return <p className="truncate font-mono text-xs text-muted-foreground">{item.fileName}</p>
  }
  return null
}

interface IconActionProps {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}

function IconAction({ label, active, disabled, onClick, children }: IconActionProps): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
        active === true && 'text-foreground',
      )}
    >
      {children}
    </button>
  )
}
