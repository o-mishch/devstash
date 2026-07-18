import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Check, Copy, ExternalLink, FileText, FolderOpen, Pencil, Pin, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { CollectionRef, LightItem } from '@/client'
import { itemTypeMeta, typeHasCodeEditor } from '@/lib/item-types'
import { relativeTime } from '@/lib/date'
import { cn, hasText } from '@/lib/utils'
import { normalizeColorMode } from '@/lib/theme'
import { useItemDrawerStore } from '@/stores/item-drawer'
import { useDeleteItem, useToggleItemFavorite, useToggleItemPinned } from '@/hooks/use-items'
import { useEditorPreferences } from '@/hooks/use-preferences'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { FavoriteStar } from '@/components/ui/favorite-star'
import { LazyCodeEditor } from './code-editor-lazy'

interface ItemDrawerViewProps {
  item: LightItem
  description: string | null
  collections: CollectionRef[] | null
  updatedAt: string | null
  content: string | null
  language: string | null
  hasContent: boolean
  contentLoading: boolean
  onEdit: () => void
  onClose: () => void
}

/** Read-only view pane of the item drawer: content, metadata, tags, collections, and the action bar. */
export function ItemDrawerView({
  item,
  description,
  collections,
  updatedAt,
  content,
  language,
  hasContent,
  contentLoading,
  onEdit,
  onClose,
}: ItemDrawerViewProps): ReactNode {
  const meta = itemTypeMeta(item.itemType.name)
  const Icon = meta?.icon ?? FileText
  const { data: prefs } = useEditorPreferences()
  const colorMode = normalizeColorMode(prefs?.colorMode)

  const favorite = useToggleItemFavorite()
  const pinned = useToggleItemPinned()
  const remove = useDeleteItem()
  // The toggles refresh the item lists but not this drawer's snapshot, so patch it on success.
  const patchItem = useItemDrawerStore((s) => s.patchItem)
  const [copied, setCopied] = useState(false)

  // Reset the "copied" affordance after a delay, clearing the timer on unmount
  // so a fast close/reopen can't fire setState on an unmounted component.
  useEffect(() => {
    if (!copied) return undefined
    const id = setTimeout(() => setCopied(false), 1500)
    return (): void => clearTimeout(id)
  }, [copied])

  const copyText = hasText(item.url) ? item.url : (content ?? '')

  async function handleCopy(): Promise<void> {
    if (!hasText(copyText)) {
      toast.error('Nothing to copy')
      return
    }
    try {
      // navigator.clipboard: no framework-level alternative for copy-to-clipboard.
      await navigator.clipboard.writeText(copyText)
      setCopied(true)
    } catch {
      toast.error('Couldn’t copy to clipboard')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-3 border-b border-border p-5 pr-14">
        <div className="flex items-center gap-2">
          <Icon className={cn('size-4', meta?.accent ?? 'text-muted-foreground')} />
          <span className="font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground">
            {meta?.label ?? item.itemType.name}
          </span>
          {item.isPinned && <Pin className="size-3 text-primary" fill="currentColor" />}
          {item.isFavorite && <FavoriteStar isFavorite />}
        </div>
        <h2 className="text-lg font-semibold leading-snug">{item.title}</h2>
        <p className="font-mono text-[0.7rem] text-muted-foreground/70">
          Created {relativeTime(item.createdAt)}
          {hasText(updatedAt) && ` · updated ${relativeTime(updatedAt)}`}
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
        {hasText(item.url) && <ItemUrl url={item.url} />}

        {hasContent && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">Content</p>
            <ContentBlock
              loading={contentLoading}
              content={content}
              language={typeHasCodeEditor(item.itemType.name) ? language : null}
              colorMode={colorMode}
              fontSize={prefs?.fontSize ?? 14}
              tabSize={prefs?.tabSize ?? 2}
              wordWrap={prefs?.wordWrap === 'on'}
            />
          </div>
        )}

        {hasText(description) && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">Description</p>
            <p className="whitespace-pre-wrap text-sm text-foreground">{description}</p>
          </div>
        )}

        {item.tags !== null && item.tags.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">Tags</p>
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
          </div>
        )}

        {collections !== null && collections.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">Collections</p>
            <div className="flex flex-wrap gap-1.5">
              {collections.map((c) => (
                <Link
                  key={c.id}
                  to="/collections/$id"
                  params={{ id: c.id }}
                  onClick={onClose}
                  className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs transition-colors hover:bg-accent"
                >
                  <FolderOpen className="size-3 text-muted-foreground" />
                  {c.name}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 border-t border-border p-3">
        <Button variant="ghost" size="sm" onClick={() => void handleCopy()}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          Copy
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={favorite.isPending}
          onClick={() =>
            favorite.mutate(
              { path: { id: item.id }, body: { isFavorite: !item.isFavorite } },
              { onSuccess: () => patchItem({ isFavorite: !item.isFavorite }) },
            )
          }
        >
          <FavoriteStar isFavorite={item.isFavorite} />
          {item.isFavorite ? 'Favorited' : 'Favorite'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pinned.isPending}
          onClick={() =>
            pinned.mutate(
              { path: { id: item.id }, body: { isPinned: !item.isPinned } },
              { onSuccess: () => patchItem({ isPinned: !item.isPinned }) },
            )
          }
        >
          <Pin
            className={cn('size-4', item.isPinned && 'text-primary')}
            fill={item.isPinned ? 'currentColor' : 'none'}
          />
          {item.isPinned ? 'Pinned' : 'Pin'}
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="size-4" />
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={remove.isPending}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => remove.mutate({ path: { id: item.id } }, { onSuccess: onClose })}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

interface ContentBlockProps {
  loading: boolean
  content: string | null
  language: string | null
  colorMode: 'dark' | 'light'
  fontSize: number
  tabSize: number
  wordWrap: boolean
}

/** The drawer's content region: a skeleton while loading, the code viewer when present, else a note. */
function ContentBlock({
  loading,
  content,
  language,
  colorMode,
  fontSize,
  tabSize,
  wordWrap,
}: ContentBlockProps): ReactNode {
  if (loading) return <Skeleton className="h-40 w-full" />
  if (!hasText(content)) return <p className="text-sm text-muted-foreground">No content.</p>
  return (
    <LazyCodeEditor
      value={content}
      language={language}
      colorMode={colorMode}
      fontSize={fontSize}
      tabSize={tabSize}
      wordWrap={wordWrap}
    />
  )
}

interface ItemUrlProps {
  url: string
}

function ItemUrl({ url }: ItemUrlProps): ReactNode {
  const safeUrl = safeHttpUrl(url)
  if (safeUrl === null) {
    return <span className="break-all font-mono text-xs text-muted-foreground">{url}</span>
  }
  return (
    <a
      href={safeUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 break-all font-mono text-xs text-primary hover:underline"
    >
      <ExternalLink className="size-3.5 shrink-0" />
      {safeUrl}
    </a>
  )
}

/** Only http(s) URLs render as live anchors; anything else renders as inert text. */
function safeHttpUrl(url: string): string | null {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:' ? url : null
  } catch {
    return null
  }
}
