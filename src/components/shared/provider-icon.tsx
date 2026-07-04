import githubSvg from '@/assets/icons/github.svg'
import googleSvg from '@/assets/icons/google.svg'
import { SvgIcon } from '@/components/icons/svg-icon'
import type { OAuthProvider } from '@/lib/utils/constants'
import { Globe } from 'lucide-react'

interface ProviderIconProps {
  // `string & {}` keeps OAuthProvider autocomplete while still accepting any provider id.
  provider: OAuthProvider | (string & {})
  className?: string
}

export function ProviderIcon({ provider, className }: ProviderIconProps) {
  if (provider === 'github') {
    return <SvgIcon src={githubSvg} className={className} />
  }
  if (provider === 'google') {
    return <SvgIcon src={googleSvg} className={className} />
  }
  return <Globe className={className} />
}
