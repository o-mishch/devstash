'use client'

import { Download, File, FileCode, FileImage, FileText, FileJson, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/shared/copy-button'
import { ItemStatusIcons } from '@/components/shared/item-status-icons'
import { useItemDrawer } from '@/context/item-drawer-context'
import { useRestrictedDownload } from '@/hooks/use-restricted-download'
import { formatDate, formatBytes } from '@/lib/utils/format'
import { getDownloadUrl } from '@/lib/utils/url'
import {
  ALLOWED_IMAGE_EXTS,
  FILE_ICON_CODE_EXTS,
  FILE_ICON_JSON_EXTS,
  FILE_ICON_TEXT_EXTS,
  PRO_ITEM_TYPE_NAMES,
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
  const { openDrawer, isPro } = useItemDrawer()
  const isRestricted = !isPro && PRO_ITEM_TYPE_NAMES.has(item.itemType.name)
  const { handleDownload, showError } = useRestrictedDownload(
    getDownloadUrl(item.id),
    item.fileName ?? item.title,
    isRestricted,
    true
  )

  return (
    <div
      className="card-interactive group/card flex items-center gap-3 rounded-lg border border-border px-4 py-3"
      onClick={() => openDrawer(item)}
    >
      <FileTypeIcon fileName={item.fileName} className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium">{item.title}</p>
          <ItemStatusIcons isPinned={item.isPinned} isFavorite={item.isFavorite} />
        </div>
        <p className="truncate text-xs text-muted-foreground sm:hidden">
          {item.fileName ?? '—'} · {item.fileSize ? formatBytes(item.fileSize) : '—'} · {formatDate(item.createdAt)}
        </p>
      </div>
      <p className="hidden max-w-[200px] shrink-0 truncate text-sm text-muted-foreground sm:block">
        {item.fileName ?? '—'}
      </p>
      <p className="hidden w-20 shrink-0 text-right text-sm text-muted-foreground sm:block">
        {item.fileSize ? formatBytes(item.fileSize) : '—'}
      </p>
      <p className="hidden w-24 shrink-0 text-right text-sm text-muted-foreground sm:block">
        {formatDate(item.createdAt)}
      </p>
      <CopyButton
        value={getDownloadUrl(item.id, true)}
        className="size-8 shrink-0 opacity-0 transition-opacity group-hover/card:opacity-100"
        stopPropagation
        isRestricted={isRestricted}
      />
      <Button
        size="icon"
        variant="ghost"
        className="size-8 shrink-0"
        onClick={handleDownload}
        title="Download"
      >
        {showError ? <XCircle className="size-4 text-destructive" /> : <Download className="size-4" />}
      </Button>
    </div>
  )
}
