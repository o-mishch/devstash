import { oc } from '@orpc/contract'
import { z } from 'zod'
import { searchResultSchema } from './common'

export const searchContract = {
  search: oc
    .route({ method: 'GET', path: '/search' })
    .input(z.object({ q: z.string().trim().min(1, 'Search query is required') }))
    .output(searchResultSchema),
}
