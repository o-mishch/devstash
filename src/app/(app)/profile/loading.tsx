import { type ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'

interface CardSkelProps {
  titleWidth: string
  children: ReactNode
}

// CollapsibleCard chrome: trigger row (icon + title + optional subtitle + chevron) + body.
// Mirrors card-surface rounded-xl border + CollapsibleTrigger p-3 sm:p-4 + CollapsibleContent px-3 pb-3 sm:px-4 sm:pb-4.
function CardSkel({ titleWidth, children }: CardSkelProps) {
  return (
    <div className="rounded-xl border">
      <div className="flex w-full items-center gap-2 p-3 sm:p-4">
        <Skeleton className="size-4 shrink-0 rounded-sm" />
        <div className="min-w-0 flex-1">
          <Skeleton className={`h-[14px] ${titleWidth}`} />
        </div>
        <Skeleton className="ml-1 size-4 shrink-0 rounded-sm" />
      </div>
      <div className="px-3 pb-3 sm:px-4 sm:pb-4">{children}</div>
    </div>
  )
}

export default function ProfileLoading() {
  return (
    <div className="app-page gap-5 p-6">
      {/* Header: back arrow + title + subtitle */}
      <div className="flex items-start gap-3">
        <Skeleton className="mt-0.5 size-5 shrink-0 rounded-sm" />
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>

      {/* Account Information — avatar + name/type, email section row */}
      <CardSkel titleWidth="w-40">
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Skeleton className="size-14 shrink-0 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
      </CardSkel>

      {/* Sign-in Methods — 2 connected account rows */}
      <CardSkel titleWidth="w-32">
        <div className="space-y-2">
          <Skeleton className="h-[52px] w-full rounded-lg" />
          <Skeleton className="h-[52px] w-full rounded-lg" />
        </div>
      </CardSkel>

      {/* Usage — 2-col stat grid + separator + 4-col type grid */}
      <CardSkel titleWidth="w-16">
        <div className="space-y-4">
          <div className="app-grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Skeleton className="h-[74px] w-full rounded-lg" />
            <Skeleton className="h-[74px] w-full rounded-lg" />
          </div>
          <Separator />
          <div className="app-grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded-lg" />
            ))}
          </div>
        </div>
      </CardSkel>

      {/* Danger zone */}
      <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1.5 w-full">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-9 w-32 rounded-md shrink-0" />
        </div>
      </div>
    </div>
  )
}
