import { Card, CardContent } from '@/components/ui/card'

interface EmptyCardProps {
  message: string
}

export function EmptyCard({ message }: EmptyCardProps) {
  return (
    <Card className="h-20">
      <CardContent className="flex h-full items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  )
}
