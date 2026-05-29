import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Pin } from "lucide-react"
import { DashboardListSkeleton } from "@/components/dashboard/dashboard-list-skeleton"

export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <Skeleton className="mb-1.5 h-7 w-32" />
        <Skeleton className="h-4 w-48" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="size-4 rounded-full" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-7 w-12" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm font-semibold">
            <Skeleton className="h-5 w-24" />
          </CardTitle>
          <Skeleton className="h-4 w-12" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <Card key={i} className="border border-border">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="size-3.5 rounded-full" />
                  </div>
                  <Skeleton className="mt-1 h-3 w-16" />
                  <Skeleton className="mt-2 h-3 w-full" />
                  <div className="mt-3 flex gap-1.5">
                    <Skeleton className="size-3.5 rounded-full" />
                    <Skeleton className="size-3.5 rounded-full" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
            <Pin className="size-3.5 text-muted-foreground" />
            <Skeleton className="h-5 w-16" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DashboardListSkeleton count={3} />
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">
            <Skeleton className="h-5 w-24" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DashboardListSkeleton count={3} />
        </CardContent>
      </Card>
    </div>
  )
}
