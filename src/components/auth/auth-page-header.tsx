import Link from 'next/link'
import { Archive, CircleCheck, CircleX, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

// ---------------------------------------------------------------------------
// Shared base
// ---------------------------------------------------------------------------

export function AuthPageBase({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="flex justify-center">
        <div className="flex items-center gap-2">
          <Archive className="size-5 text-primary" />
          <span className="text-xl font-semibold tracking-tight">DevStash</span>
        </div>
      </div>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AuthFormLayout — for sign-in, register, reset-password forms
// ---------------------------------------------------------------------------

interface AuthFormLayoutProps {
  title: string
  description: React.ReactNode
  children: React.ReactNode
}

export function AuthFormLayout({ title, description, children }: AuthFormLayoutProps) {
  return (
    <AuthPageBase>
      <Card>
        <CardContent className="space-y-6 p-6">
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
  description: React.ReactNode
  action?: StatusAction
  footer?: React.ReactNode
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
      <Card>
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
