import { EditorWindowDots } from '@/components/ui/editor-window-dots'

interface PlainTextFallbackProps {
  content: string
}

export function PlainTextFallback({ content }: PlainTextFallbackProps) {
  return (
    <div className="flex flex-col rounded-lg border bg-[#1E1E1E] text-card-foreground shadow-sm overflow-hidden ring-1 ring-white/10 ring-inset">
      <div className="flex items-center px-4 py-2 border-b border-white/10 bg-[#2D2D2D]">
        <EditorWindowDots />
      </div>
      <pre className="flex-1 min-h-0 overflow-auto p-3 text-xs leading-relaxed whitespace-pre text-white/90 font-mono">
        {content}
      </pre>
    </div>
  )
}
