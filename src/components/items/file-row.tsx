'use client'

import type { MouseEvent } from 'react'
import { Download, File, FileCode, FileImage, FileText, FileJson, Pin, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/shared/copy-button'
import { useItemDrawer } from '@/context/item-drawer-context'
import { formatDate, formatBytes } from '@/lib/utils/format'
import { getBaseUrl } from '@/lib/utils/url'
import {
  ALLOWED_IMAGE_EXTS,
  FILE_ICON_CODE_EXTS,
  FILE_ICON_JSON_EXTS,
  FILE_ICON_TEXT_EXTS,
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
  const { openDrawer } = useItemDrawer()

  function handleDownload(e: MouseEvent) {
    e.stopPropagation()
    // Programmatic anchor is the only way to trigger a named file download in the browser
    const a = document.createElement('a')
    a.href = `/api/download/${item.id}`
    a.download = item.fileName ?? item.title
    a.click()
  }

  return (
    <div
      className="group/card flex cursor-pointer items-center gap-3 rounded-lg border border-border px-4 py-3 transition-colors hover:bg-accent"
      onClick={() => openDrawer(item)}
    >
      <FileTypeIcon fileName={item.fileName} className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium">{item.title}</p>
          <div className="flex shrink-0 items-center gap-1">
            {item.isPinned && <Pin className="size-3.5 fill-primary text-primary" />}
            {item.isFavorite && <Star className="size-3.5 fill-yellow-500 text-yellow-500" />}
          </div>
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
        value={`${getBaseUrl()}/api/download/${item.id}`}
        className="size-8 shrink-0 opacity-0 transition-opacity group-hover/card:opacity-100"
        stopPropagation
      />
      <Button
        size="icon"
        variant="ghost"
        className="size-8 shrink-0"
        onClick={handleDownload}
        title="Download"
      >
        <Download className="size-4" />
      </Button>
    </div>
  )
}
