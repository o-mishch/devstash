import { toast } from 'sonner'

export function toastError(error: unknown, fallback: string): void {
  toast.error(error instanceof Error ? error.message : fallback)
}

export function showFileNotFoundToast(message?: string | null): void {
  toast.error(message ?? 'File not found in storage.', {
    id: 'file-not-found',
  })
}
