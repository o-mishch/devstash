import type { WithChildren } from '@/types/common'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function AuthLayout({ children }: WithChildren) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      {/* Subtle radial gradient to avoid pure black */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900/40 via-zinc-950 to-zinc-950" />
      {/* Subtle dot grid */}
      <div aria-hidden className="pointer-events-none absolute inset-0 [background-image:radial-gradient(rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:24px_24px]" />
      
      <Link 
        href="/"
        className="absolute left-4 top-4 z-10 flex items-center justify-center size-10 rounded-lg text-muted-foreground hover:bg-foreground/5 hover:text-foreground transition-colors md:hidden"
        aria-label="Back to home"
      >
        <ArrowLeft className="size-5" />
      </Link>
      
      <div className="relative z-10 w-full max-w-sm">
        {children}
      </div>
    </div>
  )
}
