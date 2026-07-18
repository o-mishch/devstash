import type { ReactNode } from 'react'
import { AlignLeft, Gauge, Lightbulb, Sparkles, Tag } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { UiSkin } from '@/lib/ui-skins'
import { SkinWidget } from './skins/skin-widget'

type SkinHeaderClassMap = Partial<Record<UiSkin, string>>

interface AiFeature {
  label: string
  icon: LucideIcon
}

// Per-skin header styling, mirroring what each skin passes to its own SkinWidget sections so the
// "AI Usage" header keeps each skin's identity.
const SKIN_HEADER_CLASS: SkinHeaderClassMap = {
  editorial: 'tracking-[0.1em] text-foreground',
  'neon-grid': 'font-mono tracking-[0.1em] text-primary',
}

const FEATURES: AiFeature[] = [
  { label: 'Optimize', icon: Sparkles },
  { label: 'Explain', icon: Lightbulb },
  { label: 'Tags', icon: Tag },
  { label: 'Description', icon: AlignLeft },
]

interface AiUsageWidgetProps {
  skin: UiSkin
}

/**
 * Per-skin AI Usage section (Pro-only). The AI features it meters are Backend Phase 6 (not migrated),
 * so this renders the real low-emphasis strip in a "coming soon" state — one slim card per AI feature
 * with a placeholder meter. Demoted to the foot of each skin like the live app. Non-Pro is gated by
 * the `{isPro && …}` call site in each skin.
 */
export function AiUsageWidget({ skin }: AiUsageWidgetProps): ReactNode {
  return (
    <SkinWidget
      icon={<Gauge />}
      title="AI Usage"
      headerClassName={SKIN_HEADER_CLASS[skin]}
      skin={skin}
    >
      <div className="grid grid-cols-2 gap-2.5 @md:grid-cols-4">
        {FEATURES.map(({ label, icon: Icon }) => (
          <div
            key={label}
            className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card/40 p-3"
          >
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon className="size-3.5" />
              {label}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-foreground/5">
              <div className="h-full w-1/3 rounded-full bg-muted-foreground/20" />
            </div>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
              Coming soon
            </span>
          </div>
        ))}
      </div>
    </SkinWidget>
  )
}
