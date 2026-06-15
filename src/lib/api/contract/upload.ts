import { oc } from '@orpc/contract'
import { z } from 'zod'
import { uploadUrlResultSchema } from './common'

export const uploadContract = {
  getUploadUrl: oc
    .route({ method: 'POST', path: '/upload/url' })
    .input(z.object({ fileName: z.string().trim().min(1), fileSize: z.number().int().positive() }))
    .output(uploadUrlResultSchema),

  // `key` is the S3 object key to delete; bound from the query string for DELETE.
  deleteUpload: oc
    .route({ method: 'DELETE', path: '/upload' })
    .input(z.object({ key: z.string().trim().min(1) })),
}
