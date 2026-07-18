import type { ReactNode } from 'react'
import { createFormHook, createFormHookContexts } from '@tanstack/react-form'
import { Loader2 } from 'lucide-react'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

/**
 * TanStack Form composition setup (the idiomatic "form hook" pattern). Field/form
 * components bind to the form via context — no `form`/`field` prop threading — so each
 * auth route just declares `defaultValues` + a Zod schema and lists its fields. All the
 * value/onChange/onBlur/error wiring lives here, once, instead of per form.
 */
export const { fieldContext, useFieldContext, formContext, useFormContext } =
  createFormHookContexts()

/**
 * Standard-Schema (Zod) field errors arrive as issue objects (`{ message }`); a plain
 * function validator returns a string. Normalize both to a display string without
 * tripping the `no-unsafe-*` rules on the loosely-typed error array.
 */
function firstErrorMessage(errors: readonly unknown[]): string | undefined {
  const first = errors[0]
  if (first == null) return undefined
  if (typeof first === 'string') return first
  if (typeof first === 'object' && 'message' in first) {
    const { message } = first
    return typeof message === 'string' ? message : 'Invalid value'
  }
  return 'Invalid value'
}

interface TextFieldProps {
  label: string
  type?: string
  autoComplete?: string
  placeholder?: string
}

/** Bound text field: reads its state from field context, renders the UI-kit control. */
function TextField({ label, type = 'text', autoComplete, placeholder }: TextFieldProps): ReactNode {
  const field = useFieldContext<string>()
  // Only surface a validation error once the field has been interacted with, so a
  // pristine form doesn't render red before the user has typed anything.
  const showError = field.state.meta.isTouched && field.state.meta.errors.length > 0
  const message = showError ? firstErrorMessage(field.state.meta.errors) : undefined

  return (
    <Field data-invalid={showError ? 'true' : undefined}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Input
        id={field.name}
        name={field.name}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={field.state.value}
        onChange={(e) => field.handleChange(e.target.value)}
        onBlur={field.handleBlur}
        aria-invalid={showError}
      />
      {message != null && <FieldError>{message}</FieldError>}
    </Field>
  )
}

/**
 * Email field preset. `autoComplete` is a contract with the browser's password manager,
 * not styling — a single page typo'ing it degrades autofill invisibly, so it is not left
 * to each call site to retype.
 */
function EmailField(): ReactNode {
  return <TextField label="Email" type="email" autoComplete="email" placeholder="you@example.com" />
}

interface PasswordFieldProps {
  label: string
  /**
   * `current-password` when re-authenticating an existing secret, `new-password` when
   * setting one. This is what tells a password manager whether to offer a saved value or
   * to generate a fresh one; getting it backwards breaks both.
   */
  autoComplete: 'current-password' | 'new-password'
  placeholder?: string
}

/** Password field preset — label and placeholder genuinely differ per page, the rest doesn't. */
function PasswordField({ label, autoComplete, placeholder }: PasswordFieldProps): ReactNode {
  return (
    <TextField
      label={label}
      type="password"
      autoComplete={autoComplete}
      placeholder={placeholder}
    />
  )
}

interface SubmitButtonProps {
  label: string
}

/** Bound submit button: disabled/loading tracks the form's own submission state. */
function SubmitButton({ label }: SubmitButtonProps): ReactNode {
  const form = useFormContext()
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting && <Loader2 className="size-4 animate-spin" />}
          {label}
        </Button>
      )}
    </form.Subscribe>
  )
}

export const { useAppForm } = createFormHook({
  fieldComponents: { TextField, EmailField, PasswordField },
  formComponents: { SubmitButton },
  fieldContext,
  formContext,
})

/**
 * Await a submit without rethrowing.
 *
 * `mutateAsync` rejects on a failed request, and TanStack Form would surface that as an
 * unhandled rejection — but the mutation's own `isError` already drives the alert, so the
 * throw carries no information the UI isn't showing. Swallowing it here rather than at
 * each call site keeps the reason in one place.
 *
 * The plain non-throwing `mutate` is NOT the simpler alternative: it resolves
 * `handleSubmit` immediately, which drops `isSubmitting` while the request is still in
 * flight, re-enables `SubmitButton`, and reopens double-submit.
 */
export async function submitting(request: Promise<unknown>): Promise<void> {
  try {
    await request
  } catch {
    /* surfaced via the mutation's own isError */
  }
}
