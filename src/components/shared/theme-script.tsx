// Blocking inline script — runs synchronously before first paint.
// Reads ds-theme (color theme) and ds-layout (dashboard section + sidebar collapse state) cookies
// and applies them to <html> attributes/classes so the page renders correctly from frame 1, no flash.
export function ThemeScript() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `(function(){try{var r=document.documentElement;var t=document.cookie.match(/(?:^|;\\s*)ds-theme=([^;]+)/);if(t){var p=decodeURIComponent(t[1]).split('|');p[0]&&r.setAttribute('data-theme',p[0]);p[1]==='light'?(r.classList.remove('dark'),r.classList.add('light')):(r.classList.remove('light'),r.classList.add('dark'))}var l=document.cookie.match(/(?:^|;\\s*)ds-layout=([^;]+)/);if(l){var q=JSON.parse(decodeURIComponent(l[1]));if(typeof q.collections==='boolean')r.setAttribute('data-section-collections',q.collections?'1':'0');if(typeof q.pinned==='boolean')r.setAttribute('data-section-pinned',q.pinned?'1':'0');if(typeof q.recent==='boolean')r.setAttribute('data-section-recent',q.recent?'1':'0');if(typeof q.sidebar==='boolean')r.setAttribute('data-sidebar-collapsed',q.sidebar?'1':'0')}}catch(e){}})()`
      }}
    />
  )
}
