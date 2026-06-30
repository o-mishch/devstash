// Browser-only direct-to-S3 upload against a presigned PUT URL. Uses XMLHttpRequest
// (not fetch) because only XHR exposes upload progress events. The file is sent as
// the raw request body — no FormData wrapper. Not an API route call; the request
// goes straight to S3/GCS.
//
// PUT (not POST) because GCS S3-interop rejects presigned POST policy forms
// (x-amz-* form fields). Presigned PUT query-string signing works on both real
// AWS S3 and GCS. The Content-Type header is enforced by the signed URL condition.

interface UploadToS3Options {
  onProgress?: (percent: number) => void
}

export interface PresignedPutResult {
  ok: boolean
  // HTTP status of the direct-S3 PUT; 0 on a network-level failure (onerror). Surfaced so the
  // caller can distinguish a GCS/S3 signature or size rejection (403/400) from a dropped
  // connection — the most likely failure modes of the presigned-PUT path.
  status: number
}

/** PUTs `file` directly to a presigned S3 URL. Resolves `ok: true` on a 2xx response. */
export function uploadToPresignedPut(
  url: string,
  file: Blob,
  contentType: string,
  options: UploadToS3Options = {},
): Promise<PresignedPutResult> {
  const { onProgress } = options
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', contentType)
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status })
    xhr.onerror = () => resolve({ ok: false, status: 0 })
    xhr.send(file)
  })
}
