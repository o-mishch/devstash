import type { SVGProps } from 'react'

interface SvgIconProps extends Omit<SVGProps<SVGSVGElement>, 'dangerouslySetInnerHTML'> {
  src: string
}

/**
 * Renders a raw SVG string as an inline <svg> element.
 * IMPORTANT: `src` must only be a statically-imported SVG module string.
 * Never pass user-supplied or remotely-fetched content — there is no sanitization.
 */
export function SvgIcon({ src, ...props }: SvgIconProps) {
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
