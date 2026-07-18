import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Hexagon } from 'lucide-react'
import { scrollToTop } from '@/lib/scroll-to-section'
import { MARKETING_CONTAINER } from './gradient-cta'

export function MarketingFooter(): ReactNode {
  return (
    <footer className="border-t border-white/10 py-16">
      <div className={MARKETING_CONTAINER}>
        <div className="mb-12 grid gap-12 md:grid-cols-[1fr_auto]">
          <div>
            <Link
              to="/"
              onClick={scrollToTop}
              className="mb-3 inline-flex items-center gap-2 text-lg font-semibold"
            >
              <Hexagon className="size-5 fill-blue-400/15 text-blue-400" />
              <span>DevStash</span>
            </Link>
            <p className="max-w-xs text-sm text-muted-foreground">
              Your developer knowledge hub. One place for everything you build with.
            </p>
          </div>

          <div className="flex gap-12">
            <div className="flex flex-col gap-3">
              <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Product
              </h4>
              <Link
                to="/"
                hash="features"
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Features
              </Link>
              <Link
                to="/"
                hash="pricing"
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Pricing
              </Link>
              <span className="text-sm text-muted-foreground">Changelog</span>
            </div>
            <div className="flex flex-col gap-3">
              <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Company
              </h4>
              <span className="text-sm text-muted-foreground">About</span>
              <span className="text-sm text-muted-foreground">Blog</span>
              <span className="text-sm text-muted-foreground">Contact</span>
            </div>
            <div className="flex flex-col gap-3">
              <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Legal
              </h4>
              {/* Inert until the pages ship — no /privacy or /terms route exists, so a live
                  link would dead-end on the SPA 404 (matches Changelog/About/Blog/Contact). */}
              <span className="text-sm text-muted-foreground">Privacy</span>
              <span className="text-sm text-muted-foreground">Terms</span>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 pt-8">
          {/* No year: this route is prerendered, so a build-time year would freeze in the
              static HTML (and differ pre/post-hydration) until someone redeploys. */}
          <p className="text-center text-sm text-muted-foreground">
            © DevStash. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
