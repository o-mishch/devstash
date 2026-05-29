'use client'

import type { MouseEvent } from 'react'
import { Copy, Download, File, FileCode, FileImage, FileText, FileJson } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useItemDrawer } from '@/context/item-drawer-context'
import { formatDate, formatBytes } from '@/lib/utils/format'
import {
  ALLOWED_IMAGE_EXTS,
  FILE_ICON_CODE_EXTS,
  FILE_ICON_JSON_EXTS,
  FILE_ICON_TEXT_EXTS,
} from '@/lib/utils/constants'
import type { Item } from '@/types/item'

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
  item: Item
}

export function FileRow({ item }: FileRowProps) {
  const { openDrawer } = useItemDrawer()

  function handleCopy(e: MouseEvent) {
    e.stopPropagation()
    navigator.clipboard.writeText(`${location.origin}/api/download/${item.id}`).then(() => toast.success('Copied to clipboard'))
  }

  function handleDownload(e: MouseEvent) {
    e.stopPropagation()
    const a = document.createElement('a')
    a.href = `/api/download/${item.id}`
    a.download = item.fileName ?? item.title
    a.click()
  }

  return (
    <div
      className="group/card flex cursor-pointer items-center gap-3 rounded-lg border border-border px-4 py-3 transition-colors hover:bg-accent"
      onClick={() => openDrawer(item.id)}
    >
      <FileTypeIcon fileName={item.fileName} className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{item.title}</p>
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
      <Button
        size="icon"
        variant="ghost"
        className="size-8 shrink-0 opacity-0 transition-opacity group-hover/card:opacity-100"
        onClick={handleCopy}
        title="Copy"
      >
        <Copy className="size-4" />
      </Button>
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
