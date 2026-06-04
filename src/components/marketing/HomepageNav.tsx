'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function HomepageNav({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setScrolled(!entry.isIntersecting);
      },
      { rootMargin: '-1px 0px 0px 0px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinelRef} className="absolute top-0 left-0 h-1 w-full -z-50 pointer-events-none" aria-hidden="true" />
      <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? 'bg-background/90 backdrop-blur-md border-b border-border' : 'bg-transparent'
      }`}
    >
      <div className="container max-w-6xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2 font-semibold text-lg">
            <span className="text-blue-400">⬡</span>
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
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 px-3 sm:px-4 h-7 sm:h-8 text-xs sm:text-sm font-semibold text-white shadow-sm shadow-cyan-500/20 transition-all hover:from-blue-400 hover:to-cyan-400 hover:-translate-y-0.5 active:scale-95"
              >
                <span className="hidden sm:inline">Go to Dashboard</span>
                <span className="sm:hidden">Dashboard</span>
              </Link>
            ) : (
              <>
                <Link href="/sign-in" className="text-xs sm:text-sm font-medium text-muted-foreground hover:text-foreground px-1 sm:px-2">
                  Sign In
                </Link>
                <Link
                  href="/register"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 px-3 sm:px-4 h-7 sm:h-8 text-xs sm:text-sm font-semibold text-white shadow-sm shadow-cyan-500/20 transition-all hover:from-blue-400 hover:to-cyan-400 hover:-translate-y-0.5 active:scale-95"
                >
                  Sign Up
                </Link>
              </>
            )}

            <button
              className="md:hidden p-1.5 -mr-1.5 text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Toggle menu"
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </div>

      {menuOpen && (
        <>
          <div 
            className="md:hidden fixed inset-0 top-16 z-40 bg-black/20 backdrop-blur-sm"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="md:hidden relative z-50 bg-background border-b border-border px-4 py-4 flex flex-col gap-4 shadow-lg">
            <a
              href="#features"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setMenuOpen(false)}
            >
              Features
            </a>
            <a
              href="#pricing"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setMenuOpen(false)}
            >
              Pricing
            </a>
          </div>
        </>
      )}
    </nav>
    </>
  );
}
