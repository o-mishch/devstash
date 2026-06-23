'use client'

// Blocking inline script — runs synchronously before first paint.
// Reads ds-theme (color theme) and ds-layout (sidebar collapse state) cookies and applies them to
// <html> attributes/classes so the page renders correctly from frame 1, no flash.
//
// `type` is the executable `text/javascript` on the server (the browser runs it during HTML parse,
// before hydration — that's what kills the flash) but inert `text/plain` on the client, so React's
// reconciler never sees an "executable" <script> during client render and skips its
// "Scripts inside React components are never executed…" warning. `suppressHydrationWarning` absorbs
// the resulting type-attribute mismatch; the script has already run from the SSR HTML, so flipping
// the type on the client never re-executes it. This is the Next.js-documented no-flash pattern.
export function ThemeScript() {
  return (
    <script
      type={typeof window === 'undefined' ? 'text/javascript' : 'text/plain'}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{
        __html: `(function(){try{var r=document.documentElement;var t=document.cookie.match(/(?:^|;\\s*)ds-theme=([^;]+)/);if(t){var p=decodeURIComponent(t[1]).split('|');p[0]&&r.setAttribute('data-theme',p[0]);p[1]==='light'?(r.classList.remove('dark'),r.classList.add('light')):(r.classList.remove('light'),r.classList.add('dark'))}var l=document.cookie.match(/(?:^|;\\s*)ds-layout=([^;]+)/);if(l){var q=JSON.parse(decodeURIComponent(l[1]));if(typeof q.sidebar==='boolean')r.setAttribute('data-sidebar-collapsed',q.sidebar?'1':'0')}}catch(e){}})()`
      }}
    />
  )
}
