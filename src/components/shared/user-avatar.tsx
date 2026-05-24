import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

interface UserAvatarProps {
  name: string | null | undefined
  image: string | null | undefined
  className?: string
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '?'
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')
}

export function UserAvatar({ name, image, className }: UserAvatarProps) {
  return (
    <Avatar className={cn('size-8', className)}>
      {image && <AvatarImage src={image} alt={name ?? 'User avatar'} />}
      <AvatarFallback className="bg-primary text-primary-foreground text-xs font-medium">
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  )
}
