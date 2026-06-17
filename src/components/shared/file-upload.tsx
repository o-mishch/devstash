'use client'

import { useRef, useState, useEffect, type DragEvent } from 'react'
import { Upload, X, FileIcon } from 'lucide-react'
import { cn } from '@/lib/utils/styles'
import { api } from '@/lib/api/client'
import { uploadToPresignedPost } from '@/lib/storage/s3-upload-client'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { FILE_UPLOAD_CONFIG, IMAGE_THUMBNAIL_MAX_WIDTH, IMAGE_THUMBNAIL_QUALITY } from '@/lib/utils/constants'
import { formatBytes } from '@/lib/utils/format'
import { getFileExtension } from '@/lib/utils/files'
import type { FileItemType } from '@/lib/utils/constants'

export interface UploadedFile {
  /** S3 object key — used as the pending-upload token by POST /api/items and for orphan cleanup. */
  key: string
  fileName: string
  fileSize: number
  imageWidth: number | null
  imageHeight: number | null
  /** Local ObjectURL for immediate preview — WebP thumbnail blob for raster images, raw File blob for SVGs. */
  localPreviewUrl?: string
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

  const prevLocalPreviewUrl = useRef<string | undefined>(undefined)
  useEffect(() => {
    const prev = prevLocalPreviewUrl.current
    const current = value?.localPreviewUrl
    // Only revoke the old blob URL when it's replaced by a different one (user re-uploaded).
    // Do NOT revoke on unmount — the blob URL is seeded into the preview cache and must
    // stay alive until the cache TTL expires (5 min), otherwise the card gets ERR_FILE_NOT_FOUND.
    if (prev && current && prev !== current) URL.revokeObjectURL(prev)
    prevLocalPreviewUrl.current = current
  }, [value?.localPreviewUrl])

  async function uploadFile(file: File) {
    setError(null)
    setProgress(0)

    const isSvg = getFileExtension(file.name) === 'svg'
    const isImageType = itemType === 'image'

    // Reads original dimensions and builds a 640px WebP thumb before any network calls.
    // thumb.width/height are the ORIGINAL image dimensions — that's what gets stored in the DB.
    let thumb: { blob: Blob; width: number; height: number } | null = null
    if (isImageType && !isSvg) {
      thumb = await buildImageThumb(file)
    }

    const { data: urlData, error: urlError } = await api.POST('/upload/url', {
      body: { fileName: file.name, fileSize: file.size },
    })

    if (urlError) {
      setProgress(null)
      setError(urlError.message || 'Upload failed')
      return
    }

    const { original, thumb: thumbCredential } = urlData
    const originalKey = original.fields['key']

    // POST multipart to S3 using the presigned policy credential.
    // Per S3 POST spec, policy fields must come before the file.
    // Content-Type is carried as a form field inside original.fields — do NOT set it as an HTTP header
    // (the browser auto-sets multipart/form-data + boundary for FormData bodies).
    const formData = new FormData()
    Object.entries(original.fields).forEach(([k, v]) => formData.append(k, v))
    formData.append('file', file)

    // Thumb uses a presigned POST policy — same pattern as the original upload.
    // S3 enforces both Content-Type and content-length-range via the signed policy.
    const uploads: Promise<boolean>[] = [
      uploadToPresignedPost(original.url, formData, { onProgress: setProgress }),
    ]
    if (thumb && thumbCredential) {
      const thumbForm = new FormData()
      Object.entries(thumbCredential.fields).forEach(([k, v]) => thumbForm.append(k, v))
      thumbForm.append('file', thumb.blob)
      uploads.push(uploadToPresignedPost(thumbCredential.url, thumbForm))
    }

    const results = await Promise.all(uploads)
    if (results.some((ok) => !ok)) {
      setProgress(null)
      setError('Upload failed. Please try again.')
      // Cleanup goes through our server (DELETE /api/upload → server calls S3), not direct S3.
      void api.DELETE('/upload', { params: { query: { key: originalKey } } })
      return
    }

    setProgress(null)
    let localPreviewUrl: string | undefined
    if (isSvg && isImageType) localPreviewUrl = URL.createObjectURL(file)
    else if (thumb) localPreviewUrl = URL.createObjectURL(thumb.blob)
    onUpload({
      key: originalKey,
      fileName: file.name,
      fileSize: file.size,
      imageWidth: thumb?.width ?? null,
      imageHeight: thumb?.height ?? null,
      localPreviewUrl,
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
    const fileMeta = (
      <>
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
      </>
    )

    // Images get a real preview (the locally-generated WebP thumb / SVG blob) above the
    // file meta so the upload is immediately recognizable; other file types keep the chip.
    if (itemType === 'image' && value.localPreviewUrl) {
      return (
        <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
          {/* Local blob/object URL — next/image can't optimize it, so a plain <img> is correct here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value.localPreviewUrl}
            alt={value.fileName}
            className="max-h-[320px] w-full bg-[repeating-conic-gradient(#0000000d_0%_25%,transparent_0%_50%)] bg-[length:20px_20px] object-contain"
          />
          <div className="flex items-center gap-3 border-t border-border bg-muted/50 px-3 py-2.5">
            {fileMeta}
          </div>
        </div>
      )
    }

    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2.5">
        {fileMeta}
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
