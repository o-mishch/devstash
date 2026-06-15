import 'server-only'
import { implement, lazy } from '@orpc/server'
import { contract } from '../contract'

const os = implement(contract)

// Each domain is code-split via lazy() so it stays out of the catch-all function's cold-start
// working set until first hit. More domains are added here as they migrate.
export const router = os.router({
  collections: lazy(() => import('./collections').then((m) => ({ default: m.collectionsRouter }))),
  items: lazy(() => import('./items').then((m) => ({ default: m.itemsRouter }))),
  profile: lazy(() => import('./profile').then((m) => ({ default: m.profileRouter }))),
  ai: lazy(() => import('./ai').then((m) => ({ default: m.aiRouter }))),
  search: lazy(() => import('./search').then((m) => ({ default: m.searchRouter }))),
  upload: lazy(() => import('./upload').then((m) => ({ default: m.uploadRouter }))),
  billing: lazy(() => import('./billing').then((m) => ({ default: m.billingRouter }))),
  auth: lazy(() => import('./auth').then((m) => ({ default: m.authRouter }))),
  download: lazy(() => import('./download').then((m) => ({ default: m.downloadRouter }))),
})
