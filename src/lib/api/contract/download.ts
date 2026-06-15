import { oc } from '@orpc/contract'
import { z } from 'zod'
import { signedDownloadUrlResponseSchema } from './common'

export const downloadContract = {
  // `id` binds from the path; `preview` from the query string. The 3xx redirect route
  // (GET /download/{id}) stays an explicit exempt route — only this JSON endpoint is oRPC.
  getSignedUrl: oc
    .route({ method: 'GET', path: '/download/{id}/url' })
    // `preview` arrives as the query string 'true'/'false'. z.coerce.boolean() is Boolean(value),
    // so 'false' would coerce to `true` and serve a thumbnail for a full download — accept a real
    // boolean (client) or the literal strings, mapping 'false' → false explicitly.
    .input(
      z.object({
        id: z.string(),
        preview: z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]).optional(),
      }),
    )
    .output(signedDownloadUrlResponseSchema),
}
