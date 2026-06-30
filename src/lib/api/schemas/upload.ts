import { z } from 'zod'

// Request/response schemas for the upload endpoints (oRPC `oc.route()` wrappers stripped — bare Zod).
// `expiresAt` is already an ISO string from the handler — no date coercion. [C].

export const getUploadUrlInput = z.object({
  fileName: z.string().trim().min(1),
  fileSize: z.number().int().positive(),
  // Exact byte size of the client-generated WebP thumbnail, sent only for raster images.
  // The server signs it into the thumb's presigned PUT (ContentLength) so S3/GCS enforce
  // the exact size — the presigned-PUT equivalent of the POST content-length-range cap.
  thumbSize: z.number().int().positive().optional(),
})

// DELETE /upload binds `key` from the query string.
export const deleteUploadQuery = z.object({ key: z.string().trim().min(1) })

// Mirrors PresignedPutCredential.
const presignedPutCredentialSchema = z
  .object({
    url: z.string(),
    // Server-authoritative S3 object key the URL is signed for — used verbatim client-side
    // (item creation + cleanup) so the key never has to be parsed back out of `url`.
    key: z.string(),
    contentType: z.string(),
  })
  .meta({ id: 'PresignedPutCredential' })

// Mirrors UploadUrlResult.
export const uploadUrlResultSchema = z
  .object({
    original: presignedPutCredentialSchema,
    thumb: presignedPutCredentialSchema.nullable(),
    expiresAt: z.string(),
  })
  .meta({ id: 'UploadUrlResult' })
