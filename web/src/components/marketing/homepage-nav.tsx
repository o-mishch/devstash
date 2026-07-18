import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Menu, X, Hexagon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GRADIENT_PILL_CLASS, MARKETING_CONTAINER } from '@/components/marketing/gradient-cta'
import { useIntersectionObserver } from '@/hooks/use-intersection-observer'
import { scrollToTop } from '@/lib/scroll-to-section'
import { cn } from '@/lib/utils'

interface HomepageNavProps {
  isAuthenticated?: boolean
}

// Shared gradient pill used by both the "Go to Dashboard" and "Sign Up" nav CTAs — the nav's
// own shape/color tokens layered over the canonical GRADIENT_PILL_CLASS gradient+motion.
const NAV_CTA_CLASS = cn(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-4 h-9 sm:h-8 text-sm font-semibold text-white shadow-sm shadow-cyan-500/20',
  GRADIENT_PILL_CLASS,
)

export function HomepageNav({ isAuthenticated = false }: HomepageNavProps): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false)
  // The nav goes solid once the top sentinel scrolls out of view. `initialInView: true`
  // seeds the "at the top" state so there's no first-paint flash of the solid nav.
  const { ref: sentinelRef, inView } = useIntersectionObserver({
    rootMargin: '-1px 0px 0px 0px',
    initialInView: true,
  })
  const scrolled = !inView

  const toggleMenu = (): void => setMenuOpen((prev) => !prev)
  const closeMenu = (): void => setMenuOpen(false)

  return (
    <>
      <div
        ref={sentinelRef}
        className="absolute top-0 left-0 h-1 w-full -z-50 pointer-events-none"
        aria-hidden="true"
      />
      <nav
        className={cn(
          'fixed top-0 left-0 right-0 z-50 transition-all duration-300',
          scrolled ? 'bg-background/90 backdrop-blur-md border-b border-border' : 'bg-transparent',
        )}
      >
        <div className={MARKETING_CONTAINER}>
          <div className="flex items-center justify-between h-16">
            <Link
              to="/"
              onClick={scrollToTop}
              className="flex items-center gap-2 font-semibold text-lg"
            >
              <Hexagon className="size-5 text-blue-400 fill-blue-400/15" />
              <span>DevStash</span>
            </Link>

            <ul className="hidden md:flex items-center gap-8 list-none m-0 p-0">
              <li>
                <Link
                  to="/"
                  hash="features"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Features
                </Link>
              </li>
              <li>
                <Link
                  to="/"
                  hash="pricing"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Pricing
                </Link>
              </li>
            </ul>

            <div className="flex items-center gap-1.5 sm:gap-3">
              {isAuthenticated ? (
                <Link to="/dashboard" className={NAV_CTA_CLASS}>
                  <span className="hidden sm:inline">Go to Dashboard</span>
                  <span className="sm:hidden">Dashboard</span>
                </Link>
              ) : (
                <>
                  <Link
                    to="/sign-in"
                    className="hidden whitespace-nowrap px-2 py-2 text-sm font-medium text-muted-foreground hover:text-foreground sm:inline-block"
                  >
                    Sign In
                  </Link>
                  <Link to="/register" className={NAV_CTA_CLASS}>
                    Sign Up
                  </Link>
                </>
              )}

              <Button
                variant="ghost"
                size="icon"
                className="md:hidden -mr-1 text-muted-foreground hover:text-foreground"
                onClick={toggleMenu}
              >
                {menuOpen ? <X size={20} /> : <Menu size={20} />}
                <span className="sr-only">Toggle menu</span>
              </Button>
            </div>
          </div>
        </div>

        <div
          className={cn(
            'md:hidden fixed inset-0 top-16 z-40 bg-black/30 backdrop-blur-sm transition-opacity duration-300',
            menuOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
          onClick={closeMenu}
          aria-hidden="true"
        />
        <div
          className={cn(
            'md:hidden relative z-50 grid overflow-hidden border-border bg-background/95 backdrop-blur-md transition-all duration-300 ease-out',
            menuOpen
              ? 'grid-rows-[1fr] border-b opacity-100 shadow-lg'
              : 'grid-rows-[0fr] opacity-0',
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="flex flex-col gap-1 px-4 py-3">
              <Link
                to="/"
                hash="features"
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                onClick={closeMenu}
              >
                Features
              </Link>
              <Link
                to="/"
                hash="pricing"
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                onClick={closeMenu}
              >
                Pricing
              </Link>
              {!isAuthenticated && (
                <Link
                  to="/sign-in"
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground sm:hidden"
                  onClick={closeMenu}
                >
                  Sign In
                </Link>
              )}
            </div>
          </div>
        </div>
      </nav>
    </>
  )
}
