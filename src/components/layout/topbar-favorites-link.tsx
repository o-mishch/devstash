
import Link from 'next/link'
import { Star } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'

export function TopbarFavoritesLink() {
  return (
    <TooltipProvider delay={400}>
      <Tooltip>
        <TooltipTrigger render={
          <Link
            href="/favorites"
            aria-label="Favorites"
            className="card-interactive flex size-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          >
            <Star className="size-4" />
          </Link>
        } />
        <TooltipContent>Favorites</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
