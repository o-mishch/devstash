import type { SVGProps } from 'react'
import DOMPurify from 'isomorphic-dompurify'

interface SvgIconProps extends Omit<SVGProps<SVGSVGElement>, 'dangerouslySetInnerHTML'> {
  src: string
}

/**
 * Renders a raw SVG string as an inline <svg> element.
 * IMPORTANT: `src` must only be a statically-imported SVG module string.
 */
export function SvgIcon({ src, ...props }: SvgIconProps) {
  const viewBox = src.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 24 24'
  const inner = src.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
  const cleanSvg = DOMPurify.sanitize(inner, { USE_PROFILES: { svg: true } })

  return (
    <svg
      viewBox={viewBox}
      fill="currentColor"
      {...props}
      dangerouslySetInnerHTML={{ __html: cleanSvg }}
    />
  )
}
