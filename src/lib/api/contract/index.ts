import { collectionsContract } from './collections'
import { itemsContract } from './items'
import { profileContract } from './profile'
import { aiContract } from './ai'
import { searchContract } from './search'
import { uploadContract } from './upload'
import { billingContract } from './billing'
import { authContract } from './auth'
import { downloadContract } from './download'

// The single source of truth shared by the server router and the browser client.
export const contract = {
  collections: collectionsContract,
  items: itemsContract,
  profile: profileContract,
  ai: aiContract,
  search: searchContract,
  upload: uploadContract,
  billing: billingContract,
  auth: authContract,
  download: downloadContract,
}
