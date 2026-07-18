import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FadeIn } from './fade-in'
import { GradientCta, GLOW_BLOB, GRADIENT_TEXT_CLASS, MARKETING_CONTAINER } from './gradient-cta'

export function HeroText(): ReactNode {
  return (
    <FadeIn>
      <section className="relative overflow-hidden pb-20 pt-32 text-center">
        {/* Ambient glow blobs */}
        <div
          aria-hidden
          className={cn(
            GLOW_BLOB,
            'left-1/2 top-0 h-[500px] w-[700px] -translate-x-1/2 bg-blue-500/10',
          )}
        />
        <div
          aria-hidden
          className={cn(GLOW_BLOB, 'right-1/4 top-24 h-[300px] w-[400px] bg-cyan-500/10')}
        />

        <div className={cn(MARKETING_CONTAINER, 'relative')}>
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-blue-500/25 bg-blue-500/10 px-4 py-1.5 text-sm font-medium text-blue-400">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
            Developer Knowledge Hub
          </div>

          <h1 className="mb-6 text-5xl font-bold leading-tight tracking-tight md:text-6xl lg:text-7xl">
            Stop Losing Your
            <br />
            <span className={GRADIENT_TEXT_CLASS}>Developer Knowledge</span>
          </h1>

          <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
            Your snippets are in VS Code. Your prompts are buried in chat history. Your bookmarks
            live in 6 different browsers. DevStash brings everything into one fast, searchable hub.
          </p>

          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <GradientCta href="/register">
              Start for Free
              <ArrowRight size={15} />
            </GradientCta>
            <Link
              to="/"
              hash="features"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-foreground/5 px-6 text-sm font-semibold text-foreground transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-foreground/10 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              See Features
            </Link>
          </div>

          <div className="mt-16 flex flex-col items-center justify-center gap-4 border-t border-white/5 pt-8 opacity-60">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Trusted by 500+ developers
            </p>
          </div>
        </div>
      </section>
    </FadeIn>
  )
}
