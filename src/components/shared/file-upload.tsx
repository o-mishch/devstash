'use client'

import { useRef, useState, type DragEvent } from 'react'
import { Upload, X, FileIcon } from 'lucide-react'
import { cn } from '@/lib/utils/styles'
import { apiFetch, apiUpload } from '@/lib/api/api-fetch'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { FILE_UPLOAD_CONFIG, IMAGE_THUMBNAIL_MAX_WIDTH, IMAGE_THUMBNAIL_QUALITY } from '@/lib/utils/constants'
import { formatBytes } from '@/lib/utils/format'
import { getFileExtension } from '@/lib/utils/files'
import type { FileItemType } from '@/lib/utils/constants'

export interface UploadedFile {
  fileUrl: string
  fileName: string
  fileSize: number
  imageWidth: number | null
  imageHeight: number | null
}

interface UploadUrlResult {
  originalKey: string
  originalUrl: string
  thumbKey: string | null
  thumbUrl: string | null
  expiresAt: string
}

async function buildImageThumb(file: File): Promise<{ blob: Blob; width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const { width: natW, height: natH } = bitmap

    const scale = Math.min(1, IMAGE_THUMBNAIL_MAX_WIDTH / natW)
    const w = Math.round(natW * scale)
    const h = Math.round(natH * scale)

    const canvas = new OffscreenCanvas(w, h)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()

    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: IMAGE_THUMBNAIL_QUALITY / 100 })
    return { blob, width: natW, height: natH }
  } catch {
    return null
  }
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

    // Client-side guard: avoids the presigned URL round-trip for obvious violations.
    // Server validates declared fileSize too, but can't enforce it once the presigned URL is issued.
    if (file.size > config.maxBytes) {
      const maxMb = config.maxBytes / 1024 / 1024
      setProgress(null)
      setError(`File exceeds the ${maxMb}MB limit.`)
      return
    }

    const isSvg = getFileExtension(file.name) === 'svg'
    const isImageType = itemType === 'image'

    // Reads original dimensions and builds a 640px WebP thumb before any network calls.
    // thumb.width/height are the ORIGINAL image dimensions — that's what gets stored in the DB.
    let thumb: { blob: Blob; width: number; height: number } | null = null
    if (isImageType && !isSvg) {
      thumb = await buildImageThumb(file)
    }

    const urlResult = await apiFetch<UploadUrlResult>('/api/upload/url', {
      method: 'POST',
      body: { fileName: file.name, fileSize: file.size, itemType, hasThumb: thumb !== null },
    })

    if (urlResult.status !== 'ok' || !urlResult.data) {
      setProgress(null)
      setError(urlResult.message ?? 'Upload failed')
      return
    }

    const { originalKey, originalUrl, thumbUrl } = urlResult.data
    const contentType = file.type || 'application/octet-stream'

    // Both PUTs go directly to Filebase — zero bytes through Vercel.
    const uploads: Promise<boolean>[] = [apiUpload(originalUrl, file, contentType, setProgress)]
    if (thumb && thumbUrl) {
      uploads.push(apiUpload(thumbUrl, thumb.blob, 'image/webp'))
    }

    const results = await Promise.all(uploads)
    if (results.some((ok) => !ok)) {
      setProgress(null)
      setError('Upload failed. Please try again.')
      // Cleanup goes through our server (DELETE /api/upload → server calls Filebase), not direct S3.
      void apiFetch(`/api/upload?key=${encodeURIComponent(originalKey)}`, { method: 'DELETE' })
      return
    }

    setProgress(null)
    onUpload({
      fileUrl: originalKey,
      fileName: file.name,
      fileSize: file.size,              // actual bytes of the original file
      imageWidth: thumb?.width ?? null, // original image width (null for SVG / non-image)
      imageHeight: thumb?.height ?? null,
    })
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
          <p className="text-xs text-muted-foreground">{formatBytes(value.fileSize)}</p>
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
