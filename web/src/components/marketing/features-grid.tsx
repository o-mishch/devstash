import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { FadeIn } from './fade-in'
import { GRADIENT_TEXT_CLASS, MARKETING_CONTAINER } from './gradient-cta'

interface Feature {
  icon: string
  title: string
  desc: string
  /** Accent-tinted gradient behind the card's 1px border ring. */
  cardBorder: string
  /** Accent-tinted radial glow revealed on card hover. */
  hoverGlow: string
  /** Accent-tinted chip behind the glyph icon. */
  iconChip: string
  pro?: boolean
}

// Accent colors are written as literal Tailwind arbitrary values rather than composed from a
// hex at runtime: the JIT scanner only sees complete class strings in the source, so a
// template-built class would never make it into the stylesheet.
const FEATURES: Feature[] = [
  {
    icon: '</>',
    title: 'Code Snippets',
    desc: 'Save reusable code with syntax highlighting, language detection, and instant copy.',
    cardBorder: 'bg-[linear-gradient(to_bottom,#3b82f650,transparent)]',
    hoverGlow: 'bg-[radial-gradient(circle_at_50%_0%,#3b82f620,transparent_70%)]',
    iconChip: 'bg-[#3b82f620] text-[#3b82f6]',
  },
  {
    icon: '✦',
    title: 'AI Prompts',
    desc: 'Build a personal prompt library. Stop rewriting the same prompts from scratch.',
    cardBorder: 'bg-[linear-gradient(to_bottom,#f59e0b50,transparent)]',
    hoverGlow: 'bg-[radial-gradient(circle_at_50%_0%,#f59e0b20,transparent_70%)]',
    iconChip: 'bg-[#f59e0b20] text-[#f59e0b]',
  },
  {
    icon: '⌕',
    title: 'Instant Search',
    desc: 'Full-text search across all your items by title, content, tags, and type.',
    cardBorder: 'bg-[linear-gradient(to_bottom,#06b6d450,transparent)]',
    hoverGlow: 'bg-[radial-gradient(circle_at_50%_0%,#06b6d420,transparent_70%)]',
    iconChip: 'bg-[#06b6d420] text-[#06b6d4]',
  },
  {
    icon: '$_',
    title: 'Commands',
    desc: 'Never google the same CLI command twice. Store and recall with a keystroke.',
    cardBorder: 'bg-[linear-gradient(to_bottom,#22c55e50,transparent)]',
    hoverGlow: 'bg-[radial-gradient(circle_at_50%_0%,#22c55e20,transparent_70%)]',
    iconChip: 'bg-[#22c55e20] text-[#22c55e]',
  },
  {
    icon: '📁',
    title: 'Files & Docs',
    desc: 'Upload context files, PDFs, and documents. Access them from anywhere.',
    cardBorder: 'bg-[linear-gradient(to_bottom,#64748b50,transparent)]',
    hoverGlow: 'bg-[radial-gradient(circle_at_50%_0%,#64748b20,transparent_70%)]',
    iconChip: 'bg-[#64748b20] text-[#64748b]',
    pro: true,
  },
  {
    icon: '⊞',
    title: 'Collections',
    desc: 'Group related items into collections. Build your React Patterns or DevOps Runbook.',
    cardBorder: 'bg-[linear-gradient(to_bottom,#ec489950,transparent)]',
    hoverGlow: 'bg-[radial-gradient(circle_at_50%_0%,#ec489920,transparent_70%)]',
    iconChip: 'bg-[#ec489920] text-[#ec4899]',
  },
]

export function FeaturesGrid(): ReactNode {
  return (
    <section id="features" className="py-24">
      <div className={MARKETING_CONTAINER}>
        <FadeIn>
          <div className="mb-16 text-center">
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Features
            </p>
            <h2 className="mb-4 text-4xl font-bold md:text-5xl">
              Everything you need to <span className={GRADIENT_TEXT_CLASS}>stay in flow</span>
            </h2>
            <p className="mx-auto max-w-xl text-lg text-muted-foreground">
              Seven item types covering every piece of developer knowledge, all in one place.
            </p>
          </div>
        </FadeIn>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <FadeIn key={f.title} index={i}>
              <div className={cn('h-full rounded-xl p-px', f.cardBorder)}>
                <div className="group relative flex h-full flex-col overflow-hidden rounded-[11px] bg-card p-6 transition-all duration-300 hover:-translate-y-1">
                  <div
                    aria-hidden
                    className={cn(
                      'pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100',
                      f.hoverGlow,
                    )}
                  />
                  {f.pro === true && (
                    <span className="absolute right-4 top-4 inline-flex items-center rounded-full border border-border bg-background/50 px-2.5 py-0.5 text-xs font-semibold text-foreground/80">
                      PRO
                    </span>
                  )}
                  <div
                    className={cn(
                      'relative mb-4 flex h-10 w-10 items-center justify-center rounded-lg font-mono text-sm font-bold',
                      f.iconChip,
                    )}
                  >
                    {f.icon}
                  </div>
                  <h3 className="relative mb-2 font-semibold">{f.title}</h3>
                  <p className="relative text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  )
}
