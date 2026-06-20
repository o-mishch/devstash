import { cookies } from 'next/headers'
import { normalizeUiSkin } from '@/lib/utils/editor-preferences'
import { DashboardSkinFallback } from '@/components/dashboard/skins/skeletons'

// Route-level loading state. The skin can't be read from the DB synchronously here, so it comes
// from the ds-skin cookie (written client-side by ThemeInitializer) — letting the loading skeleton
// match the selected skin instead of always showing the classic one. Falls back to the default skin
// on first ever load (no cookie yet).
//
// Note: this is a pure no-flash hint and is NOT Pro-gated (the cookie has no plan info). page.tsx is
// authoritative — it applies resolveAccessibleSkin. The only mismatch is a Pro→free downgrade with a
// stale cookie naming a Pro skin: the skeleton briefly shows that skin before page.tsx renders the
// classic fallback. Cosmetic and self-correcting (ThemeInitializer rewrites the cookie post-hydration).
export default async function DashboardLoading() {
  const skin = normalizeUiSkin((await cookies()).get('ds-skin')?.value)
  return (
    <div className="app-page gap-4 p-3 sm:gap-6 sm:p-6" data-skin={skin}>
      <DashboardSkinFallback skin={skin} />
    </div>
  )
}
