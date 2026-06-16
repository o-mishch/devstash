import { z } from 'zod'

// Request/response schemas for the upload endpoints (oRPC `oc.route()` wrappers stripped — bare Zod).
// `expiresAt` is already an ISO string from the handler — no date coercion. [C].

export const getUploadUrlInput = z.object({
  fileName: z.string().trim().min(1),
  fileSize: z.number().int().positive(),
})

// DELETE /upload binds `key` from the query string.
export const deleteUploadQuery = z.object({ key: z.string().trim().min(1) })

// Mirrors PresignedPostCredential.
const presignedPostCredentialSchema = z
  .object({
    url: z.string(),
    fields: z.record(z.string(), z.string()),
  })
  .meta({ id: 'PresignedPostCredential' })

// Mirrors UploadUrlResult.
export const uploadUrlResultSchema = z
  .object({
    original: presignedPostCredentialSchema,
    thumb: presignedPostCredentialSchema.nullable(),
    expiresAt: z.string(),
  })
  .meta({ id: 'UploadUrlResult' })
