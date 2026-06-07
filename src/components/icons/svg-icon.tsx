import type { SVGProps } from 'react'

interface SvgIconProps extends Omit<SVGProps<SVGSVGElement>, 'dangerouslySetInnerHTML'> {
  src: string
}

/** Renders a raw SVG string inline. `src` must be a statically-imported SVG module — never user-supplied or remotely-fetched content. */
export function SvgIcon({ src, ...props }: SvgIconProps) {
  if (src.toLowerCase().includes('<script')) {
    throw new Error('SvgIcon must not contain <script> tags.')
  }

  const viewBox = src.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 24 24'
  const inner = src.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')

  return (
    <svg
      viewBox={viewBox}
      fill="currentColor"
      {...props}
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  )
}
