import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Pin } from 'lucide-react'
import { CollectionCardSkeleton } from '@/components/shared/skeletons'

interface DashboardListSkeletonProps {
  count?: number
}

function DashboardListSkeleton({ count = 3 }: DashboardListSkeletonProps) {
  return (
    <div className='flex flex-col gap-3'>
      {[...Array(count)].map((_, i) => (
        <div key={i} className='app-row h-14 gap-3 rounded-xl px-2 ring-1 ring-foreground/10'>
          <Skeleton className='size-7 shrink-0 rounded-md' />
          <div className='min-w-0 flex-1 space-y-1.5'>
            <Skeleton className='h-4 w-40' />
            <Skeleton className='h-3 w-64' />
          </div>
          <div className='flex shrink-0 items-center gap-2'>
            <Skeleton className='hidden h-5 w-12 rounded-full sm:block' />
            <Skeleton className='h-3 w-12' />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function DashboardLoading() {
  return (
    <div className='app-page gap-4 p-3 sm:gap-6 sm:p-6'>
      <div>
        <Skeleton className='mb-1.5 h-7 w-32' />
        <Skeleton className='h-4 w-48' />
      </div>

      <div className='app-grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <Skeleton className='h-4 w-20' />
              <Skeleton className='size-4 rounded-full' />
            </CardHeader>
            <CardContent>
              <Skeleton className='h-7 w-12' />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className='flex flex-row items-center justify-between pb-3'>
          <CardTitle className='text-sm font-semibold'>
            <Skeleton className='h-5 w-24' />
          </CardTitle>
          <Skeleton className='h-4 w-12' />
        </CardHeader>
        <CardContent>
          <div className='app-grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'>
            {[...Array(6)].map((_, i) => (
              <CollectionCardSkeleton key={i} />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='pb-3'>
          <CardTitle className='flex items-center gap-1.5 text-sm font-semibold'>
            <Pin className='size-3.5 text-muted-foreground' />
            <Skeleton className='h-5 w-16' />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DashboardListSkeleton count={3} />
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className='pb-3'>
          <CardTitle className='text-sm font-semibold'>
            <Skeleton className='h-5 w-24' />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DashboardListSkeleton count={3} />
        </CardContent>
      </Card>
    </div>
  )
}
