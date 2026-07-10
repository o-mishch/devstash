'use client'

import { Download, File, FileCode, FileImage, FileText, FileJson, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/shared/copy-button'
import { ItemStatusIcons } from '@/components/shared/item-status-icons'
import { useItemDrawerStore } from '@/stores/item-drawer-store'
import { useIsPro } from '@/hooks/profile/use-user-profile'
import { useRestrictedDownload } from '@/hooks/billing/use-restricted'
import { formatDate, formatBytes } from '@/lib/utils/format'
import { getDownloadUrl } from '@/lib/utils/url'
import { useCallback, useMemo, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import {
  ALLOWED_IMAGE_EXTS,
  FILE_ICON_CODE_EXTS,
  FILE_ICON_JSON_EXTS,
  FILE_ICON_TEXT_EXTS,
  PRO_ITEM_TYPE_NAMES,
  SYSTEM_TYPE_COLORS,
} from '@/lib/utils/constants'
import type { LightItem } from '@/types/item'

interface FileIconProps {
  fileName: string | null
  className?: string
}

function FileTypeIcon({ fileName, className }: FileIconProps) {
  const ext = fileName?.split('.').pop()?.toLowerCase() ?? ''
  if (ALLOWED_IMAGE_EXTS.has(ext)) return <FileImage className={className} />
  if (FILE_ICON_CODE_EXTS.has(ext)) return <FileCode className={className} />
  if (FILE_ICON_JSON_EXTS.has(ext)) return <FileJson className={className} />
  if (FILE_ICON_TEXT_EXTS.has(ext)) return <FileText className={className} />
  return <File className={className} />
}

interface FileRowProps {
  item: LightItem
}

export function FileRow({ item }: FileRowProps) {
  const { openDrawer } = useItemDrawerStore()
  const isPro = useIsPro()
  const isRestricted = !isPro && PRO_ITEM_TYPE_NAMES.has(item.itemType.name)
  const { handleDownload, showError } = useRestrictedDownload(
    item.id,
    isRestricted,
    true,
  )

  // This row is rendered once per item inside a virtualized infinite-scroll list
  // (TanStackVirtualGrid); the list re-renders on every scroll frame as virtualItems
  // recompute, so memoizing the per-row style/handlers avoids re-allocating them for
  // every visible row on every scroll frame.
  const rowStyle = useMemo(
    () => ({ '--item-color': SYSTEM_TYPE_COLORS[item.itemType.name] }) as CSSProperties,
    [item.itemType.name],
  )
  const handleRowClick = useCallback(() => openDrawer(item), [item, openDrawer])
  const handleRowKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openDrawer(item)
      }
    },
    [item, openDrawer],
  )
  const handleDownloadClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => void handleDownload(e),
    [handleDownload],
  )

  return (
    <div
      // Can't be a real <button>: it wraps a nested <CopyButton> and a real <Button> (Download) —
      // HTML forbids nested interactive controls. Keyboard access is already handled via tabIndex +
      // onKeyDown below.
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="button"
      tabIndex={0}
      className="card-interactive group/card flex h-full w-full min-w-0 items-center gap-3 rounded-xl border-l-2 border-l-[var(--item-color)] bg-card px-4 py-2.5 ring-1 ring-border focus-visible:ring-2 focus-visible:ring-ring"
      style={rowStyle}
      onClick={handleRowClick}
      onKeyDown={handleRowKeyDown}
    >
      <FileTypeIcon fileName={item.fileName} className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium">{item.title}</p>
          <ItemStatusIcons isPinned={item.isPinned} isFavorite={item.isFavorite} />
        </div>
        <p className="truncate text-xs text-muted-foreground lg:hidden">
          {item.fileName ?? '—'} · {item.fileSize ? formatBytes(item.fileSize) : '—'} · {formatDate(item.createdAt)}
        </p>
      </div>
      <p className="hidden max-w-[200px] shrink-0 truncate text-sm text-muted-foreground lg:block">
        {item.fileName ?? '—'}
      </p>
      <p className="hidden w-20 shrink-0 text-right text-sm text-muted-foreground lg:block">
        {item.fileSize ? formatBytes(item.fileSize) : '—'}
      </p>
      <p className="hidden w-24 shrink-0 text-right text-sm text-muted-foreground lg:block">
        {formatDate(item.createdAt)}
      </p>
      <CopyButton
        value={getDownloadUrl(item.id, true)}
        className="size-8 shrink-0 opacity-0 transition-opacity group-hover/card:opacity-100 touch:opacity-100"
        stopPropagation
        isRestricted={isRestricted}
      />
      <Button
        size="icon"
        variant="ghost"
        className="size-8 shrink-0"
        onClick={handleDownloadClick}
        title="Download"
      >
        {showError ? <XCircle className="size-4 text-destructive" /> : <Download className="size-4" />}
      </Button>
    </div>
  )
}
