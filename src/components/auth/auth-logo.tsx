import { Archive } from 'lucide-react'

export function AuthLogo() {
  return (
    <div className="flex items-center gap-2">
      <Archive className="size-5 text-primary" />
      <span className="text-xl font-semibold tracking-tight">DevStash</span>
    </div>
  )
}
