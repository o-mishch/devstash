import { api } from '@/lib/api/client'
import { uploadToPresignedPost } from './s3-upload-client'

export interface UploadFileItemInput {
  file: File
  title: string
  tags?: string[]
  onProgress?: (pct: number) => void
}

export type UploadFileItemResult =
  | { ok: true; itemId: string }
  | { ok: false; message: string }

/** Presign → direct S3 POST → createItem type `file`. Cleans up the S3 object on failure. */
export async function uploadFileItem(input: UploadFileItemInput): Promise<UploadFileItemResult> {
  const { file, title, tags = [], onProgress } = input
  const { data: presign, error: presignError } = await api.POST('/upload/url', {
    body: { fileName: file.name, fileSize: file.size },
  })
  if (presignError || !presign) {
    return { ok: false, message: presignError?.message ?? 'Could not start the upload' }
  }

  const key = presign.original.fields['key']
  const formData = new FormData()
  Object.entries(presign.original.fields).forEach(([k, v]) => formData.append(k, v))
  formData.append('file', file)

  const uploaded = await uploadToPresignedPost(presign.original.url, formData, { onProgress })
  if (!uploaded) {
    void api.DELETE('/upload', { params: { query: { key } } })
    return { ok: false, message: 'Upload failed. Please try again.' }
  }

  const { data: item, error: itemError } = await api.POST('/items', {
    body: { title, itemTypeName: 'file', fileUrl: key, tags },
  })
  if (itemError || !item) {
    void api.DELETE('/upload', { params: { query: { key } } })
    return { ok: false, message: itemError?.message ?? 'Could not save the file' }
  }

  return { ok: true, itemId: item.id }
}
