// Standard no-flash technique used by next-themes and all major theme libraries.
// This Server Component renders a blocking inline script (no 'use client' needed)
// that runs synchronously before first paint, reads the ds-theme cookie, and applies
// data-theme + class to <html> — so the user's actual theme is visible from frame 1.
export function ThemeScript() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)ds-theme=([^;]+)/);if(m){var p=decodeURIComponent(m[1]).split('|');p[0]&&document.documentElement.setAttribute('data-theme',p[0]);p[1]==='light'?(document.documentElement.classList.remove('dark'),document.documentElement.classList.add('light')):(document.documentElement.classList.remove('light'),document.documentElement.classList.add('dark'))}}catch(e){}})()`
      }}
    />
  )
}
