import type { ReactNode } from 'react'
import { itemTypeMeta } from '@/lib/item-types'
import { cn } from '@/lib/utils'
import { ChaosCanvas } from './chaos-canvas'
import { FadeIn } from './fade-in'
import { MARKETING_CONTAINER } from './gradient-cta'

interface MockupType {
  name: string
  active?: boolean
}

// Curated marketing subset (icon/color/label all derive from the ITEM_TYPES source).
const MOCKUP_TYPES: MockupType[] = [
  { name: 'snippet', active: true },
  { name: 'prompt' },
  { name: 'command' },
  { name: 'note' },
  { name: 'image' },
  { name: 'link' },
]

interface MockupCard {
  typeName: string
  title: string
  sub: string
}

const MOCKUP_CARDS: MockupCard[] = [
  { typeName: 'snippet', title: 'useAuth hook', sub: 'React · TypeScript' },
  { typeName: 'prompt', title: 'GPT-4 Code Review', sub: 'AI · Prompt' },
  { typeName: 'command', title: 'git reset --hard', sub: 'Git · Terminal' },
  { typeName: 'note', title: 'Deploy checklist', sub: 'Markdown · Note' },
]

type HeroVisualProps = Record<string, never>

export function HeroVisual(_props: HeroVisualProps): ReactNode {
  return (
    <FadeIn>
      <section className="pb-24">
        <div className={MARKETING_CONTAINER}>
          <div className="flex flex-col items-center gap-6 md:grid md:grid-cols-[1fr_auto_1fr]">
            <div className="w-full overflow-hidden rounded-2xl border border-border bg-card/50 backdrop-blur-sm">
              <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
                Your knowledge today...
              </div>
              <div className="relative h-60">
                <ChaosCanvas />
              </div>
            </div>

            <div className="flex items-center justify-center" aria-hidden>
              <span className="block animate-pulse text-4xl text-blue-400 rotate-90 md:rotate-0">
                →
              </span>
            </div>

            <div className="w-full overflow-hidden rounded-2xl border border-white/10 bg-card backdrop-blur-sm">
              <div className="border-b border-white/10 px-4 py-2 text-xs text-muted-foreground">
                ...with DevStash
              </div>
              <div className="flex h-60">
                <div className="flex w-28 flex-col gap-0.5 border-r border-white/10 px-2 py-3">
                  {MOCKUP_TYPES.map((t) => {
                    const meta = itemTypeMeta(t.name)
                    if (!meta) return null
                    const Icon = meta.icon
                    return (
                      <div
                        key={t.name}
                        className={cn(
                          'flex items-center gap-1.5 rounded px-2 py-1 text-xs',
                          t.active === true ? 'bg-accent text-foreground' : 'text-muted-foreground',
                        )}
                      >
                        <Icon className={cn('size-3 flex-shrink-0', meta.accent)} />
                        {meta.plural}
                      </div>
                    )
                  })}
                </div>
                <div className="flex flex-1 flex-col gap-1.5 overflow-hidden p-2">
                  {MOCKUP_CARDS.map((c) => (
                    <div
                      key={c.title}
                      className={cn(
                        'rounded-lg border border-white/8 border-t-2 px-2 py-1.5',
                        itemTypeMeta(c.typeName)?.border,
                      )}
                    >
                      <div className="truncate text-xs font-medium">{c.title}</div>
                      <div className="text-xs text-muted-foreground">{c.sub}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </FadeIn>
  )
}
