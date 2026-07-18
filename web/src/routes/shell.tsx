import { createFileRoute, Navigate } from '@tanstack/react-router'

// Mask target for the SPA shell prerender (see vite.config.ts `spa.maskPath`). The
// prerender renders the router's PENDING fallback here (not this component) to produce
// `_shell.html` — the fallback Firebase serves for deep links. This path must be a
// matchable route (a non-route path 404s the shell prerender). A stray runtime visit
// just bounces into the app.
export const Route = createFileRoute('/shell')({
  component: () => <Navigate to="/dashboard" />,
})
