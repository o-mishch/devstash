import type { WithChildren } from '@/types/common'

export default function AuthLayout({ children }: WithChildren) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-zinc-950 px-4 py-8">
      {/* Subtle radial gradient to avoid pure black */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900/40 via-zinc-950 to-zinc-950" />
      {/* Subtle dot grid */}
      <div aria-hidden className="pointer-events-none absolute inset-0 [background-image:radial-gradient(rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:24px_24px]" />

      <div className="relative z-10 w-full max-w-sm">
        {children}
      </div>
    </div>
  )
}
