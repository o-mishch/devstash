import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent } from "@/components/ui/card"

export default function ItemsLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <Skeleton className="mb-1.5 h-7 w-32" />
        <Skeleton className="h-4 w-24" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <Card key={i} className="h-20 border border-border">
            <CardContent className="flex h-full items-center p-4">
              <div className="flex w-full items-center gap-3">
                <Skeleton className="size-8 shrink-0 rounded-md" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="ml-2 h-3 w-12 shrink-0" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
