import { Suspense, lazy } from 'react'
import type { ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import type { CodeEditorProps } from './code-editor'

// CodeMirror is heavy — load it only when a content item's drawer opens (view or edit), not on
// every app page. Shared by the drawer's view and edit panes so it's one chunk, one Suspense shell.
const Lazy = lazy(async () => {
  const m = await import('./code-editor')
  return { default: m.CodeEditor }
})

export function LazyCodeEditor(props: CodeEditorProps): ReactNode {
  return (
    <Suspense fallback={<Skeleton className="h-40 w-full" />}>
      <Lazy {...props} />
    </Suspense>
  )
}
