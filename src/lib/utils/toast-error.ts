import { toast } from 'sonner'

export function toastError(error: unknown, fallback: string): void {
  toast.error(error instanceof Error ? error.message : fallback)
}
