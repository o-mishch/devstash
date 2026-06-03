# Homepage

## Overview

Convert the static prototype in `prototypes/homepage/` into a proper Next.js marketing homepage at `src/app/(marketing)/page.tsx`. The homepage is public (no auth required) and replaces the current root `page.tsx`.

## Route & Layout

- Route: `/` → `src/app/(marketing)/page.tsx`
- New route group `(marketing)` with its own `layout.tsx` — no sidebar, no app shell
- Existing `src/app/page.tsx` replaced or moved

## Sections

### 1. Navbar — `HomepageNav` (Client Component)
- Logo (⬡ DevStash) links to `/`
- Nav links: Features → `#features`, Pricing → `#pricing`
- CTA buttons: "Sign In" → `/sign-in`, "Get Started" → `/register`
- Becomes opaque/blurred on scroll (scroll event listener)
- Mobile: hamburger button toggles a dropdown menu
- Sticky, `z-50`

### 2. Hero Text — Server Component
- Badge: "Developer Knowledge Hub"
- H1 with gradient text span
- Subheading paragraph
- Buttons: "Start for Free" → `/register`, "See Features" → `#features`

### 3. Hero Visual — Server Component (canvas child is client)
- Two-panel layout: chaos box + arrow + dashboard mockup
- **`ChaosCanvas`** (Client Component): `<canvas>` with rAF physics animation — 8 floating tool icons, bounce, mouse repulsion, rotation/scale pulse. Port logic directly from `prototypes/homepage/script.js`
- Pulsing CSS arrow between panels
- Dashboard mockup: static sidebar + 4 item cards (pure HTML/Tailwind, no JS)
- On mobile: panels stack vertically, arrow rotates 90°

### 4. Features Grid — Server Component
- Section id: `features`
- 6 feature cards in a responsive grid (1 col → 2 col → 3 col)
- Each card: icon, title, description, accent color border
- Files & Docs card has a PRO badge (`Badge` from shadcn with variant `outline`)
- Scroll fade-in via `IntersectionObserver` — extract into a `FadeIn` client wrapper component used throughout

### 5. AI Section — Server Component
- Side-by-side layout (stacks on mobile)
- Left: "Pro Feature" badge, headline, checklist with ✓ items
- Right: static code mockup (macOS dots header, `<pre>` code block, AI tags bar below)
- Pure Tailwind, no JS

### 6. Pricing — `PricingSection` (Client Component)
- Section id: `pricing`
- Monthly / Yearly toggle buttons (local `useState`)
  - Monthly: $8/mo
  - Yearly: $6/mo (billed as $72/year)
- Two cards: Free and Pro (Pro card highlighted with ring/glow)
- Free CTA: "Get Started Free" → `/register`
- Pro CTA: "Start Pro Trial" → `/register`

### 7. CTA Section — Server Component
- Full-width centered box
- Headline + subtext
- Button: "Start for Free — No Card Required" → `/register`

### 8. Footer — Server Component
- Brand column: logo + tagline
- Product links: Features → `#features`, Pricing → `#pricing`, Changelog → `#` (placeholder)
- Company links: About, Blog, Contact → `#` placeholders
- Legal links: Privacy, Terms → `#` placeholders
- Bottom bar: dynamic copyright year via `new Date().getFullYear()`

## Scroll Animations

- `FadeIn` client wrapper component using `IntersectionObserver` (threshold 0.1, rootMargin `-40px`)
- Adds `opacity-0 translate-y-4` initial state, transitions to `opacity-100 translate-y-0` on intersect
- Staggered delay via `index` prop (0, 80ms, 160ms, … up to 5 steps)
- Wrap sections and individual feature/pricing cards

## Styling Notes

- Dark background (`bg-background`) matching app theme
- Gradient text: `bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent`
- Use Tailwind throughout — no custom CSS files
- Use shadcn `Badge` for PRO labels
- Use shadcn `Button` for all CTAs
- `container` class with `max-w-6xl mx-auto px-4`

## File Structure

```
src/app/(marketing)/
  layout.tsx           # bare layout, no sidebar
  page.tsx             # composes all sections
src/components/marketing/
  HomepageNav.tsx      # client
  ChaosCanvas.tsx      # client
  PricingSection.tsx   # client
  FadeIn.tsx           # client wrapper
```

## Notes

- No auth checks needed — page is fully public
- No data fetching — all content is static
- `'use client'` only on components that need browser APIs or `useState`
- All internal links use Next.js `<Link>`, external placeholder links use `<a href="#">`
