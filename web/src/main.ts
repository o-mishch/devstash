// Throwaway F0 pre-flight smoke test: fetch the Go backend's /health and render it.
// Validates the Firebase Hosting -> CDN -> cross-origin -> Cloud Run seam before the
// real Vite + TanStack Router SPA replaces this file.

// Dev: same-origin via the Vite /api proxy. Prod: the Cloud Run domain directly
// (its origin must be in the backend's ALLOWED_ORIGINS for the CORS read to succeed).
const API_BASE = import.meta.env.DEV
  ? '/api'
  : (import.meta.env.VITE_API_BASE_URL ?? 'https://api.devstash.one')

const healthURL = `${API_BASE}/health`

const dot = document.querySelector<HTMLSpanElement>('#dot')!
const label = document.querySelector<HTMLSpanElement>('#label')!
const output = document.querySelector<HTMLPreElement>('#output')!
const target = document.querySelector<HTMLDivElement>('#target')!

target.textContent = `GET ${healthURL}`

function render(state: 'ok' | 'bad', text: string, body: string) {
  dot.className = `dot ${state}`
  label.textContent = text
  output.textContent = body
}

try {
  const res = await fetch(healthURL, { headers: { Accept: 'application/json' } })
  const body = await res.text()
  if (res.ok) {
    render('ok', `${res.status} OK`, body)
  } else {
    render('bad', `${res.status} ${res.statusText}`, body)
  }
} catch (err) {
  // A CORS block or network failure lands here — the response is opaque to JS.
  render('bad', 'request failed', String(err))
}
