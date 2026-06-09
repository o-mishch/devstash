import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

export default function SettingsLoading() {
  return (
    <div className="app-page gap-6 p-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Skeleton className="mt-0.5 size-5 shrink-0 rounded-sm" />
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {/* Billing Card Skeleton */}
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-40 mb-2" />
            <Skeleton className="h-4 w-72" />
          </CardHeader>
          <CardContent className="space-y-6">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-10 w-32" />
          </CardContent>
        </Card>

        {/* App Theme Card Skeleton */}
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32 mb-2" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent>
            <div className="app-grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-[90px] w-full rounded-lg" />
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Code Editor Card Skeleton */}
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-36 mb-2" />
            <Skeleton className="h-4 w-80" />
          </CardHeader>
          <CardContent className="space-y-6">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="space-y-1.5">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-4 w-56" />
                </div>
                <Skeleton className="h-9 w-[180px] rounded-md" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
