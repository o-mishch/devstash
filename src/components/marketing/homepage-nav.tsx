'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { Menu, X, Hexagon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface HomepageNavProps {
  isAuthenticated?: boolean
}

export function HomepageNav({ isAuthenticated = false }: HomepageNavProps) {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        setScrolled(!entry.isIntersecting)
      },
      { rootMargin: '-1px 0px 0px 0px' }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Functional update means these never depend on `menuOpen`/other changing
  // values, so an empty dep array keeps the reference stable across renders.
  const toggleMenu = useCallback(() => setMenuOpen((prev) => !prev), [])
  const closeMenu = useCallback(() => setMenuOpen(false), [])

  return (
    <>
      <div ref={sentinelRef} className="absolute top-0 left-0 h-1 w-full -z-50 pointer-events-none" aria-hidden="true" />
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'bg-background/90 backdrop-blur-md border-b border-border' : 'bg-transparent'
          }`}
      >
        <div className="container max-w-6xl mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-2 font-semibold text-lg">
              <Hexagon className="size-5 text-blue-400 fill-blue-400/15" />
              <span>DevStash</span>
            </Link>

            <ul className="hidden md:flex items-center gap-8 list-none m-0 p-0">
              <li>
                <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Features
                </a>
              </li>
              <li>
                <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Pricing
                </a>
              </li>
            </ul>

            <div className="flex items-center gap-1.5 sm:gap-3">
              {isAuthenticated ? (
                <Link
                  href="/dashboard"
                  className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 px-4 h-9 sm:h-8 text-sm font-semibold text-white shadow-sm shadow-cyan-500/20 transition-all hover:from-blue-400 hover:to-cyan-400 hover:-translate-y-0.5 active:scale-95"
                >
                  <span className="hidden sm:inline">Go to Dashboard</span>
                  <span className="sm:hidden">Dashboard</span>
                </Link>
              ) : (
                <>
                  {/* Hidden on the smallest screens to avoid a cramped bar — surfaced in the mobile menu instead */}
                  <Link href="/sign-in" className="hidden whitespace-nowrap px-2 py-2 text-sm font-medium text-muted-foreground hover:text-foreground sm:inline-block">
                    Sign In
                  </Link>
                  <Link
                    href="/register"
                    className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 px-4 h-9 sm:h-8 text-sm font-semibold text-white shadow-sm shadow-cyan-500/20 transition-all hover:from-blue-400 hover:to-cyan-400 hover:-translate-y-0.5 active:scale-95"
                  >
                    Sign Up
                  </Link>
                </>
              )}

              <Button
                variant="ghost"
                size="icon"
                className="md:hidden -mr-1 text-muted-foreground hover:text-foreground"
                onClick={toggleMenu}
                aria-label="Toggle menu"
              >
                {menuOpen ? <X size={20} /> : <Menu size={20} />}
              </Button>
            </div>
          </div>
        </div>

        {/* Backdrop — fades with the menu */}
        <div
          className={cn(
            'md:hidden fixed inset-0 top-16 z-40 bg-black/30 backdrop-blur-sm transition-opacity duration-300',
            menuOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
          onClick={closeMenu}
          aria-hidden="true"
        />
        {/* Panel — smooth slide-down via animating grid-template-rows (0fr -> 1fr) */}
        <div
          className={cn(
            'md:hidden relative z-50 grid overflow-hidden border-border bg-background/95 backdrop-blur-md transition-all duration-300 ease-out',
            menuOpen ? 'grid-rows-[1fr] border-b opacity-100 shadow-lg' : 'grid-rows-[0fr] opacity-0',
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="flex flex-col gap-1 px-4 py-3">
              <a
                href="#features"
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                onClick={closeMenu}
              >
                Features
              </a>
              <a
                href="#pricing"
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                onClick={closeMenu}
              >
                Pricing
              </a>
              {!isAuthenticated && (
                <Link
                  href="/sign-in"
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
