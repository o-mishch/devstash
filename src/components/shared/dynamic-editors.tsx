'use client'

import dynamic from 'next/dynamic'

export const CodeEditor = dynamic(
  () => import('@/components/ui/code-editor').then(m => m.CodeEditor),
  { ssr: false }
)

export const MarkdownEditor = dynamic(
  () => import('@/components/ui/markdown-editor').then(m => m.MarkdownEditor),
  { ssr: false }
)

export const MarkdownViewer = dynamic(
  () => import('@/components/ui/markdown-viewer').then(m => m.MarkdownViewer)
)
