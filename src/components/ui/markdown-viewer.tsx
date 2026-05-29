import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

interface MarkdownViewerProps {
  value: string
  className?: string
}

export function MarkdownViewer({ value, className }: MarkdownViewerProps) {
  return (
    <div className={cn("overflow-auto max-h-[400px] p-4", className)}>
      {value ? (
        <div className="prose prose-invert prose-sm max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {value}
          </ReactMarkdown>
        </div>
      ) : (
        <p className="text-sm text-white/30 italic">Nothing to preview.</p>
      )}
    </div>
  )
}
