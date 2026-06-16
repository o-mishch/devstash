import { z } from 'zod'

// Request/response schemas for the signed-download-URL endpoint (oRPC `oc.route()` stripped — bare
// Zod). The 3xx redirect route (GET /download/{id}) stays an explicit exempt route — only this JSON
// endpoint migrates. [C].

// OpenAPI/client query shape — the client passes a real boolean; openapi-fetch serializes it to the
// 'true'/'false' query string the handler then parses with `downloadQueryParse`.
export const downloadQueryParam = z.object({ preview: z.boolean().optional() })

// Handler-side parse: query params always arrive as strings. z.coerce.boolean() is Boolean(value),
// so 'false' would coerce to `true` and serve a thumbnail for a full download — map the literal
// strings explicitly instead.
export const downloadQueryParse = z.object({
  preview: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
})

// Mirrors SignedDownloadUrlResponse (expiresAt is already an ISO string — no coercion).
export const signedDownloadUrlSchema = z
  .object({ url: z.string(), expiresAt: z.string() })
  .meta({ id: 'SignedDownloadUrl' })
