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
// isPro is derived from the skin (there is no Pro cookie): a Pro-only skin only ever loads for a Pro
// user — page.tsx downgrades a stored Pro skin to classic for free users — so the skeleton can assume
// Pro. For the free skins (classic/aurora/editorial) Pro is unknown here, so the non-Pro layout is
// assumed; page.tsx's own Suspense fallback carries the real flag for the streaming render, making any
// mismatch a brief first-paint flash only.
export default async function DashboardLoading() {
  const skin = normalizeUiSkin((await cookies()).get('ds-skin')?.value)
  return (
    <div className="app-page gap-4 p-3 sm:gap-6 sm:p-6" data-skin={skin}>
      <DashboardSkinFallback skin={skin} isPro={isProSkin(skin)} />
    </div>
  )
}
