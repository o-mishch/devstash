import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Archive } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn, hasText } from '@/lib/utils'
import { apiErrorMessage } from '@/lib/api/errors'

/** Circular status badge variants (mirrors the live reset/verify status pages). */
type StatusVariant = 'success' | 'error' | 'info'

const STATUS_WRAP: Record<StatusVariant, string> = {
  success: 'bg-emerald-500/10',
  error: 'bg-destructive/10',
  info: 'bg-primary/10',
}

const STATUS_ICON: Record<StatusVariant, string> = {
  success: 'text-emerald-500',
  error: 'text-destructive',
  info: 'text-primary',
}

interface AuthShellProps {
  title: string
  subtitle?: string
  children?: ReactNode
  footer?: ReactNode
  /** Optional status glyph rendered in a tinted circle above the title. */
  icon?: LucideIcon
  iconVariant?: StatusVariant
  /** Spin the status glyph (e.g. an in-progress verification). */
  iconSpin?: boolean
}

/** Centered card layout shared by every auth page. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  icon: Icon,
  iconVariant = 'info',
  iconSpin = false,
}: AuthShellProps): ReactNode {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      {/* Ambient backdrop — dot grid + blue/cyan glow blobs. Pointer-transparent. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 [background-image:radial-gradient(rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:24px_24px]" />
        <div className="absolute left-1/2 top-[-10%] h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="absolute right-1/4 top-[10%] h-[300px] w-[400px] rounded-full bg-cyan-500/10 blur-3xl" />
      </div>

      <div className="w-full max-w-sm space-y-6">
        {/* Centered brand lockup: archive glyph + blue→cyan gradient wordmark. */}
        <Link to="/" className="flex items-center justify-center gap-2">
          <Archive className="size-5 text-blue-400" aria-hidden="true" />
          <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-2xl font-bold tracking-tight text-transparent">
            DevStash
          </span>
        </Link>

        <div className="rounded-xl border border-white/10 bg-card/50 p-6 shadow-xl backdrop-blur-sm">
          {Icon && (
            <div className="mb-5 flex justify-center">
              <div
                className={cn(
                  'flex size-14 items-center justify-center rounded-full',
                  STATUS_WRAP[iconVariant],
                )}
              >
                <Icon
                  className={cn('size-7', STATUS_ICON[iconVariant], iconSpin && 'animate-spin')}
                />
              </div>
            </div>
          )}
          <div className="flex flex-col items-center gap-1.5 text-center">
            <h1 className="text-2xl font-bold text-card-foreground">{title}</h1>
            {hasText(subtitle) && <p className="text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          {children != null && <div className="mt-6">{children}</div>}
        </div>

        {footer != null && (
          <div className="text-center text-sm text-muted-foreground">{footer}</div>
        )}
      </div>
    </div>
  )
}

interface AuthAlertProps {
  message: string
}

/** Inline error banner for failed submissions. */
export function AuthAlert({ message }: AuthAlertProps): ReactNode {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </div>
  )
}

/** The slice of a TanStack mutation result `AuthForm` reads for its error banner. */
interface MutationLike {
  isError: boolean
  error: unknown
}

/**
 * The auth pages' inline/footer link style.
 *
 * A constant rather than a `<Link>` wrapper on purpose: wrapping would mean re-declaring
 * `to`/`search`, and a wrapper that widens either one silently erases TanStack's
 * compile-time route checking — the same hole that let a CTA ship pointing at a route
 * that did not exist. This gets the one-place-to-restyle benefit at no type cost.
 */
export const AUTH_LINK_CLASS = 'text-primary hover:underline'

/** The slice of a TanStack Form instance `AuthForm` drives. */
interface SubmittableForm {
  handleSubmit: () => Promise<void>
}

interface AuthFormProps {
  form: SubmittableForm
  mutation: MutationLike
  className?: string
  children: ReactNode
}

/**
 * The auth pages' form shell: cancel the native submit, hand off to TanStack Form, and
 * show the mutation's error above the fields. Every auth form needs all three, and the
 * `void` on `handleSubmit` is a `no-floating-promises` requirement — having one component
 * own it means a new page cannot forget any of it.
 */
export function AuthForm({ form, mutation, className, children }: AuthFormProps): ReactNode {
  return (
    <form
      className={cn('flex flex-col gap-4', className)}
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
    >
      {mutation.isError && <AuthAlert message={apiErrorMessage(mutation.error)} />}
      {children}
    </form>
  )
}
