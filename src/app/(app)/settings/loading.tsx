import { type ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'

interface CardSkelProps {
  titleWidth: string
  subtitleWidth: string
  children: ReactNode
}

// CollapsibleCard chrome: trigger row (icon + title + subtitle + chevron) + body.
// Mirrors card-surface card-hover rounded-xl border + CollapsibleTrigger p-3 sm:p-4 + CollapsibleContent px-3 pb-3 sm:px-4 sm:pb-4.
function CardSkel({ titleWidth, subtitleWidth, children }: CardSkelProps) {
  return (
    <div className="rounded-xl border">
      {/* CollapsibleTrigger: icon + title + optional subtitle + chevron */}
      <div className="flex w-full items-center gap-2 p-3 sm:p-4">
        <Skeleton className="size-4 shrink-0 rounded-sm" />
        <div className="min-w-0 flex-1 space-y-1">
          <Skeleton className={`h-[14px] ${titleWidth}`} />
          <Skeleton className={`h-3 ${subtitleWidth}`} />
        </div>
        <Skeleton className="ml-1 size-4 shrink-0 rounded-sm" />
      </div>
      {/* CollapsibleContent: px-3 pb-3 sm:px-4 sm:pb-4 */}
      <div className="px-3 pb-3 sm:px-4 sm:pb-4">{children}</div>
    </div>
  )
}

export default function SettingsLoading() {
  return (
    <div className="app-page gap-6 p-6">
      {/* Header: back arrow + title + subtitle */}
      <div className="flex items-start gap-3">
        <Skeleton className="mt-0.5 size-5 shrink-0 rounded-sm" />
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {/* Dashboard Skin card — grid-cols-2 sm:grid-cols-3 lg:grid-cols-3, 9 skins, each h-14 swatch + 2 text lines */}
        <CardSkel titleWidth="w-32" subtitleWidth="w-72">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3">
            {Array.from({ length: 9 }, (_, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-lg border-2 border-border p-3">
                <Skeleton className="h-14 w-full rounded-md" />
                <div className="space-y-1">
                  <Skeleton className="h-[11px] w-3/4" />
                  <Skeleton className="h-[10px] w-full" />
                </div>
              </div>
            ))}
          </div>
        </CardSkel>

        {/* App Theme card — max-h-[256px] overflow-y-auto grid, then Color Mode footer */}
        <CardSkel titleWidth="w-24" subtitleWidth="w-64">
          <div className="space-y-6">
            <div className="max-h-[256px] overflow-y-hidden">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
                {Array.from({ length: 14 }, (_, i) => (
                  <div key={i} className="flex flex-col items-center gap-2 rounded-lg border-2 border-border p-3">
                    <Skeleton className="size-10 rounded-full shrink-0" />
                    <div className="w-full space-y-1">
                      <Skeleton className="h-[11px] w-full" />
                      <Skeleton className="h-[10px] w-3/4 mx-auto" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Color Mode footer: Label + DarkLightSwitch + Reset button */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
              <Skeleton className="h-4 w-24" />
              <div className="flex items-center gap-3">
                <Skeleton className="h-6 w-24 rounded-full" />
                <Skeleton className="h-8 w-20 rounded-md" />
              </div>
            </div>
          </div>
        </CardSkel>

        {/* Editor Settings card — 5 PreferenceRows, each: left label+desc, right control */}
        <CardSkel titleWidth="w-36" subtitleWidth="w-80">
          <div className="space-y-6">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-[14px] w-56" />
                </div>
                <Skeleton className="h-9 w-full rounded-md sm:w-[180px]" />
              </div>
            ))}
          </div>
        </CardSkel>
      </div>
    </div>
  )
}
