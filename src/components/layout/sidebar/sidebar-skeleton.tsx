import { cn } from '@/lib/utils'

export function SidebarSkeleton({ collapsible = false }: { collapsible?: boolean }) {
  return (
    <aside
      className={cn(
        "hidden flex-col border-r border-border bg-muted/30 lg:flex w-56 overflow-hidden h-full shrink-0",
      )}
    >
      <div className="flex h-full flex-col overflow-hidden py-3">
        {/* Toggle Panel Button Placeholder (only if collapsible) */}
        {collapsible && (
          <div className="flex h-14 shrink-0 items-center px-3">
            <div className="size-8 rounded-md bg-foreground/5 animate-pulse" />
          </div>
        )}
        
        {/* Scrollable area */}
        <div className="flex-1 min-h-0 space-y-6 px-4">
          {/* Types Section */}
          <div className="space-y-2.5">
            <div className="h-3 w-16 bg-foreground/10 rounded animate-pulse mb-4" />
            {[...Array(7)].map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="size-4 rounded-md bg-foreground/5 animate-pulse shrink-0" />
                <div className="h-3.5 w-24 bg-foreground/5 rounded animate-pulse" />
                <div className="ml-auto h-3 w-6 bg-foreground/5 rounded animate-pulse pr-2" />
              </div>
            ))}
          </div>

          <div className="border-t border-border/50 my-4" />

          {/* Collections Section */}
          <div className="space-y-2.5">
            <div className="h-3 w-24 bg-foreground/10 rounded animate-pulse mb-4" />
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="size-2 rounded-full bg-foreground/5 animate-pulse shrink-0" />
                <div className="h-3.5 w-28 bg-foreground/5 rounded animate-pulse" />
                <div className="ml-auto h-3 w-4 bg-foreground/5 rounded animate-pulse pr-2" />
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-border/50 my-4" />

        {/* User Profile Footer */}
        <div className="shrink-0 p-3 flex items-center gap-2">
          <div className="size-9 rounded-full bg-foreground/5 animate-pulse shrink-0" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3 w-20 bg-foreground/5 rounded animate-pulse" />
            <div className="h-2.5 w-32 bg-foreground/5 rounded animate-pulse" />
          </div>
        </div>
      </div>
    </aside>
  )
}
