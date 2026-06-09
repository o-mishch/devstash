import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

export default function ProfileLoading() {
  return (
    <div className="app-page gap-5 p-6">
      <div className="flex items-start gap-3">
        <Skeleton className="mt-0.5 size-5 shrink-0 rounded-sm" />
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>

      <Card>
        <CardContent className="pt-5 space-y-4">
          <div className="flex items-center gap-4">
            <Skeleton className="size-14 shrink-0 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-40" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-[52px] w-full rounded-lg" />
            <Skeleton className="h-[52px] w-full rounded-lg" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-4 w-16" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="app-grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Skeleton className="h-[74px] w-full rounded-lg" />
            <Skeleton className="h-[74px] w-full rounded-lg" />
          </div>
          <Separator />
          <div className="app-grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>

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
