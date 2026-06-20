import { cookies } from 'next/headers'
import { normalizeUiSkin } from '@/lib/utils/editor-preferences'
import { DashboardSkinFallback } from '@/components/dashboard/skins/skeletons'

// Route-level loading state. The skin is read from the ds-skin cookie (written client-side by
// ThemeInitializer) rather than the DB: the cookie is available request-synchronously, so this
// resolves in a microtask and the skin skeleton paints on the first flush — a DB read here would
// suspend the stream and leave the content area blank while it resolves. page.tsx is authoritative
// (it re-resolves from the DB + Pro gate), so a stale cookie only means a brief skeleton mismatch,
// never wrong content. Falls back to the default skin on first ever load (no cookie yet).
export default async function DashboardLoading() {
  const skin = normalizeUiSkin((await cookies()).get('ds-skin')?.value)
  return (
    <div className="app-page gap-4 p-3 sm:gap-6 sm:p-6" data-skin={skin}>
      <DashboardSkinFallback skin={skin} />
    </div>
  )
}
