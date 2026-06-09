'use client'

import { useRef, useState, type DragEvent } from 'react'
import { Upload, X, FileIcon } from 'lucide-react'
import { cn } from '@/lib/utils/styles'
import { apiUpload } from '@/lib/api/api-fetch'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { FILE_UPLOAD_CONFIG } from '@/lib/utils/constants'
import { formatBytes } from '@/lib/utils/format'
import { getImageDimensionsFromFile } from '@/lib/utils/image-dimensions.client'
import type { FileItemType } from '@/lib/utils/constants'

export interface UploadedFile {
  fileUrl: string
  fileName: string
  fileSize: number
  imageWidth?: number
  imageHeight?: number
}

interface FileUploadProps {
  itemType: FileItemType
  onUpload: (result: UploadedFile) => void
  value?: UploadedFile | null
  onClear?: () => void
}

export function FileUpload({ itemType, onUpload, value, onClear }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const config = FILE_UPLOAD_CONFIG[itemType]

  async function uploadFile(file: File) {
    setError(null)
    setProgress(0)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('itemType', itemType)

    const dimensions = itemType === 'image' ? await getImageDimensionsFromFile(file) : null
    const result = await apiUpload<UploadedFile>('/api/upload', formData, setProgress)

    setProgress(null)

    if (result.status === 'created' && result.data) {
      onUpload({
        ...result.data,
        ...(dimensions
          ? { imageWidth: dimensions.width, imageHeight: dimensions.height }
          : {}),
      })
    } else {
      setError(result.message ?? 'Upload failed')
    }
  }

  function handleFiles(files: FileList | null) {
    const file = files?.[0]
    if (file) void uploadFile(file)
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2.5">
        <FileIcon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{value.fileName}</p>
          <p className="text-xs text-muted-foreground">
            {formatBytes(value.fileSize)}
            {value.imageWidth != null && value.imageHeight != null
              ? ` · ${value.imageWidth} × ${value.imageHeight}`
              : ''}
          </p>
        </div>
        {onClear && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onClear}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={0}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors',
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-border/80 hover:bg-muted/30',
          progress !== null && 'pointer-events-none opacity-60'
        )}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <Upload className="size-5 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">
            {isDragging ? 'Drop to upload' : 'Click or drag to upload'}
          </p>
          <p className="text-xs text-muted-foreground">
            {config.acceptLabel} — max {config.maxBytes / 1024 / 1024}MB
          </p>
        </div>
      </div>

      {progress !== null && (
        <div className="space-y-1">
          <Progress value={progress} className="h-1.5" />
          <p className="text-right text-xs text-muted-foreground">{progress}%</p>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept={config.accept}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  )
}
