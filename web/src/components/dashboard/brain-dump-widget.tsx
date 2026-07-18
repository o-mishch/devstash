import type { ReactNode } from 'react'
import { ArrowRight, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface BrainDumpWidgetProps {
  /** Wrapper override so a skin can tighten the gap to the row below it. */
  className?: string
}

/**
 * Pro-only Brain Dump banner shown at the top of each dashboard skin. Brain Dump is the AI
 * brain-dump feature whose backend is Backend Phase 6 (not migrated yet), so this renders the
 * real premium strip in a "coming soon" state — a gradient card with the Sparkles brand and a CTA
 * that announces it's not live (mirrors the sidebar Brain Dump entry) rather than navigating to a
 * route that doesn't exist. Non-Pro is gated by the `{isPro && …}` call site in each skin.
 */
export function BrainDumpWidget({ className }: BrainDumpWidgetProps): ReactNode {
  return (
    <button
      type="button"
      onClick={() => {
        toast('Brain Dump is coming soon.')
      }}
      className={cn(
        'group relative flex w-full items-center gap-4 overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/10 via-primary/[0.04] to-transparent px-5 py-4 text-left transition-colors hover:from-primary/15',
        className,
      )}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
        <Sparkles className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold">Brain Dump</h3>
          <span className="rounded-full border border-primary/30 px-1.5 py-0 font-mono text-[0.6rem] tracking-widest text-primary">
            PRO
          </span>
          <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Coming soon
          </span>
        </div>
        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
          Paste a wall of notes — AI splits it into clean, tagged items.
        </p>
      </div>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}
