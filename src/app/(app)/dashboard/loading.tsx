import { Loader2 } from 'lucide-react'

export default function DashboardLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <Loader2 className="size-8 animate-spin text-muted-foreground/50" />
    </div>
  )
}
