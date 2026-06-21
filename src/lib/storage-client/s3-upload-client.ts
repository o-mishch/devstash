// Browser-only direct-to-S3 multipart upload against a presigned POST policy. Uses XMLHttpRequest
// (not fetch) because only XHR exposes upload progress events, which the file picker needs. Not an
// oRPC procedure — the request goes straight to S3, not to our API.

interface UploadToS3Options {
  onProgress?: (percent: number) => void
}

/** POSTs `formData` to a presigned S3 URL. Resolves true on a 2xx response, false otherwise. */
export function uploadToPresignedPost(url: string, formData: FormData, options: UploadToS3Options = {}): Promise<boolean> {
  const { onProgress } = options
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300)
    xhr.onerror = () => resolve(false)
    xhr.send(formData)
  })
}
