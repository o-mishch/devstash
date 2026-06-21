import { cookies } from 'next/headers'
import { normalizeUiSkin } from '@/lib/utils/editor-preferences'
import { isProSkin } from '@/types/ui-skins'
import { DashboardSkinFallback } from '@/components/dashboard/skins/skeletons'

// Route-level loading state. The skin is read from the ds-skin cookie (written client-side by
// ThemeInitializer) rather than the DB: the cookie is available request-synchronously, so this
// resolves in a microtask and the skin skeleton paints on the first flush — a DB read here would
// suspend the stream and leave the content area blank while it resolves. page.tsx is authoritative
// (it re-resolves from the DB + Pro gate), so a stale cookie only means a brief skeleton mismatch,
// never wrong content. Falls back to the default skin on first ever load (no cookie yet).
//
// isPro: a Pro-only skin only ever loads for a Pro user (page.tsx downgrades a stored Pro skin to
// classic for free users), so those always assume Pro. The free skins (classic/aurora/editorial) can
// be used by Pro users too and the skin can't reveal that, so we read the ds-pro cookie written by
// AppUserFlagsInitializer to render the matching Pro/free layout. Until that cookie exists (first ever
// load) we assume free; page.tsx's own Suspense fallback always carries the real flag, so any mismatch
// is a brief first-paint flash only.
export default async function DashboardLoading() {
  const cookieStore = await cookies()
  const skin = normalizeUiSkin(cookieStore.get('ds-skin')?.value)
  const isPro = isProSkin(skin) || cookieStore.get('ds-pro')?.value === '1'
  return (
    <div className="app-page gap-4 p-3 sm:gap-6 sm:p-6" data-skin={skin}>
      <DashboardSkinFallback skin={skin} isPro={isPro} />
    </div>
  )
}
