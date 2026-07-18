import 'react'

// Allow CSS custom properties (`--foo`) in inline `style` objects. React's CSSProperties rejects
// arbitrary `--*` keys, so without this every `style={{ '--item-color': hex }}` would need an
// `as CSSProperties` cast (which the lint config bans). Augmenting the type once is the clean,
// cast-free fix — the dashboard skins set per-item / per-stat accent colors this way.
declare module 'react' {
  interface CSSProperties {
    [key: `--${string}`]: string | number | undefined
  }
}
