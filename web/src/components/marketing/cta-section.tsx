import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FadeIn } from './fade-in'
import { GradientCta, GLOW_BLOB, GRADIENT_TEXT_CLASS, MARKETING_CONTAINER } from './gradient-cta'

export function CtaSection(): ReactNode {
  return (
    <FadeIn>
      <section className="py-24">
        <div className={MARKETING_CONTAINER}>
          <div className="rounded-2xl p-px bg-[linear-gradient(135deg,rgba(59,130,246,0.4),rgba(6,182,212,0.3),var(--border))]">
            <div className="relative overflow-hidden rounded-[15px] bg-card/80 px-8 py-20 text-center backdrop-blur-sm">
              <div aria-hidden className="pointer-events-none absolute inset-0">
                <div
                  className={cn(
                    GLOW_BLOB,
                    'left-1/2 top-1/2 h-[300px] w-[600px] -translate-x-1/2 -translate-y-1/2 bg-cyan-500/8',
                  )}
                />
              </div>
              <div className="relative">
                <h2 className="mb-4 text-4xl font-bold md:text-5xl">
                  Ready to organize your{' '}
                  <span className={GRADIENT_TEXT_CLASS}>developer knowledge?</span>
                </h2>
                <p className="mx-auto mb-10 max-w-lg text-lg text-muted-foreground">
                  Join developers who stopped losing their work and started building faster.
                </p>
                <GradientCta href="/register">
                  Start for Free — No Card Required
                  <ArrowRight size={15} />
                </GradientCta>
              </div>
            </div>
          </div>
        </div>
      </section>
    </FadeIn>
  )
}
