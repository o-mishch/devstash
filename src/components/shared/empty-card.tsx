import { ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface EmptyCardProps {
  message?: string
  action?: ReactNode
  className?: string
}

export function EmptyCard({ message, action, className }: EmptyCardProps) {
  return (
    <Card className={cn("h-24 border-dashed bg-transparent shadow-none", className)}>
      <CardContent className="flex h-full items-center justify-center p-4">
        {action ? (
          action
        ) : (
          <p className="text-sm text-muted-foreground">{message}</p>
        )}
      </CardContent>
    </Card>
  )
}
