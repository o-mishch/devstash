import type { ReactNode } from 'react'
import Link from 'next/link'
import type { WithChildren } from '@/types/common'
import { Archive, ArrowLeft, CircleCheck, CircleX, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

// ---------------------------------------------------------------------------
// Shared base
// ---------------------------------------------------------------------------

export function AuthPageBase({ children }: WithChildren) {
  return (
    <>
      {/* Ambient glow blobs and dot grid to match marketing homepage */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        {/* Dot grid */}
        <div className="absolute inset-0 [background-image:radial-gradient(rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:24px_24px]" />
        
        {/* Glow blobs */}
        <div className="absolute left-1/2 top-[-10%] h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="absolute right-1/4 top-[10%] h-[300px] w-[400px] rounded-full bg-cyan-500/10 blur-3xl" />
      </div>

      <div className="w-full max-w-sm space-y-4 sm:space-y-6">
        {/* Back arrow sits inline with the brand on one row (mobile only); being part of
         * this column it stays above the page content and is reliably tappable. */}
        <div className="relative flex items-center justify-center">
          <Link
            href="/"
            className="absolute left-0 flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground md:hidden"
            aria-label="Back to home"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <div className="flex items-center gap-2">
            <Archive className="size-5 text-blue-400" aria-hidden="true" />
            <span className="text-2xl font-bold tracking-tight bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">DevStash</span>
          </div>
        </div>
        {children}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// AuthFormLayout — for sign-in, register, reset-password forms
// ---------------------------------------------------------------------------

interface AuthFormLayoutProps {
  title: string
  description: ReactNode
  children: ReactNode
}

export function AuthFormLayout({ title, description, children }: AuthFormLayoutProps) {
  return (
    <AuthPageBase>
      <Card className="border-white/10 bg-card/50 backdrop-blur-sm shadow-xl">
        <CardContent className="space-y-5 p-5 sm:space-y-6 sm:p-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-2xl font-bold">{title}</h1>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          {children}
        </CardContent>
      </Card>
    </AuthPageBase>
  )
}

// ---------------------------------------------------------------------------
// AuthStatusPage — for verify-email, reset-password errors, post-register states
// ---------------------------------------------------------------------------

type Variant = 'success' | 'error'

const iconWrapperVariants: Record<Variant, string> = {
  success: 'bg-emerald-500/10',
  error: 'bg-destructive/10',
}

const iconVariants: Record<Variant, string> = {
  success: 'text-emerald-500',
  error: 'text-destructive',
}

const icons: Record<Variant, LucideIcon> = {
  success: CircleCheck,
  error: CircleX,
}

interface StatusAction {
  label: string
  href: string
}

const DEFAULT_ACTION: StatusAction = { label: 'Back to sign in', href: '/sign-in' }

interface AuthStatusPageProps {
  variant: Variant
  title: string
  description: ReactNode
  action?: StatusAction
  footer?: ReactNode
}

export function AuthStatusPage({
  variant,
  title,
  description,
  action = DEFAULT_ACTION,
  footer,
}: AuthStatusPageProps) {
  const Icon = icons[variant]

  return (
    <AuthPageBase>
      <Card className="border-white/10 bg-card/50 backdrop-blur-sm shadow-xl">
        <CardContent className="flex flex-col items-center gap-5 p-8 text-center">
          <div className={cn('flex size-14 items-center justify-center rounded-full', iconWrapperVariants[variant])}>
            <Icon className={cn('size-7', iconVariants[variant])} />
          </div>
          <div className="space-y-1.5">
            <p className="font-semibold">{title}</p>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          <Link href={action.href} className={buttonVariants({ variant: 'outline', className: 'w-full' })}>
            {action.label}
          </Link>
          {footer}
        </CardContent>
      </Card>
    </AuthPageBase>
  )
}

interface MissingTokenPageProps {
  noun?: string
}

export function MissingTokenPage({ noun = 'token' }: MissingTokenPageProps) {
  return (
    <AuthStatusPage
      variant="error"
      title="Missing token"
      description={`No ${noun} was provided.`}
    />
  )
}

interface ExpiredTokenPageProps {
  noun?: string
  action?: StatusAction
  footer?: ReactNode
}

export function ExpiredTokenPage({ noun = 'link', action, footer }: ExpiredTokenPageProps) {
  return (
    <AuthStatusPage
      variant="error"
      title="Link expired"
      description={`This ${noun} has expired or was already used. Please try again.`}
      action={action}
      footer={footer}
    />
  )
}
