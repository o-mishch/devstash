import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ChaosCanvas } from '@/components/marketing/ChaosCanvas';
import { PricingSection } from '@/components/marketing/PricingSection';
import { FadeIn } from '@/components/marketing/FadeIn';
import { GradientCta } from '@/components/marketing/GradientCta';

// ─── Hero Text ────────────────────────────────────────────────────────────────

function HeroText() {
  return (
    <FadeIn>
      <section className="relative overflow-hidden pb-20 pt-32 text-center">
        {/* Dot grid */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [background-image:radial-gradient(rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:24px_24px]"
        />
        {/* Ambient glow blobs */}
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-blue-500/10 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute right-1/4 top-24 h-[300px] w-[400px] rounded-full bg-cyan-500/10 blur-3xl" />
        {/* Bottom fade */}
        <div aria-hidden className="pointer-events-none absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-b from-transparent to-background" />

        <div className="container relative mx-auto max-w-6xl px-4">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-blue-500/25 bg-blue-500/10 px-4 py-1.5 text-sm font-medium text-blue-400">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
            Developer Knowledge Hub
          </div>

          <h1 className="mb-6 text-5xl font-bold leading-tight tracking-tight md:text-6xl lg:text-7xl">
            Stop Losing Your
            <br />
            <span className="bg-gradient-to-r from-blue-600 to-indigo-400 bg-clip-text text-transparent">
              Developer Knowledge
            </span>
          </h1>

          <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
            Your snippets are in VS Code. Your prompts are buried in chat history. Your bookmarks live
            in 6 different browsers. DevStash brings everything into one fast, searchable hub.
          </p>

          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <GradientCta href="/register">
              Start for Free
              <ArrowRight size={15} />
            </GradientCta>
            <a
              href="#features"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-6 text-sm font-semibold text-foreground transition-all hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/10 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              See Features
            </a>
          </div>
        </div>
      </section>
    </FadeIn>
  );
}

// ─── Hero Visual ──────────────────────────────────────────────────────────────

const MOCKUP_TYPES = [
  { color: '#3b82f6', label: 'Snippets', active: true },
  { color: '#f59e0b', label: 'Prompts' },
  { color: '#06b6d4', label: 'Commands' },
  { color: '#22c55e', label: 'Notes' },
  { color: '#ec4899', label: 'Images' },
  { color: '#6366f1', label: 'Links' },
];

const MOCKUP_CARDS = [
  { color: '#3b82f6', title: 'useAuth hook',      sub: 'React · TypeScript' },
  { color: '#f59e0b', title: 'GPT-4 Code Review', sub: 'AI · Prompt' },
  { color: '#06b6d4', title: 'git reset --hard',  sub: 'Git · Terminal' },
  { color: '#22c55e', title: 'Deploy checklist',  sub: 'Markdown · Note' },
];

function HeroVisual() {
  return (
    <FadeIn>
      <section className="pb-24">
        <div className="container mx-auto max-w-6xl px-4">
          <div className="flex flex-col items-center gap-6 md:grid md:grid-cols-[1fr_auto_1fr]">

            <div className="w-full overflow-hidden rounded-2xl border border-white/10 bg-card/50 backdrop-blur-sm">
              <div className="border-b border-white/10 px-4 py-2 text-xs text-muted-foreground">
                Your knowledge today...
              </div>
              <div className="relative h-60">
                <ChaosCanvas />
              </div>
            </div>

            <div className="flex items-center justify-center" aria-hidden>
              <span className="block animate-pulse text-4xl text-blue-400 rotate-90 md:rotate-0">→</span>
            </div>

            <div className="w-full overflow-hidden rounded-2xl border border-white/10 bg-card backdrop-blur-sm">
              <div className="border-b border-white/10 px-4 py-2 text-xs text-muted-foreground">
                ...with DevStash
              </div>
              <div className="flex h-60">
                <div className="flex w-28 flex-col gap-0.5 border-r border-white/10 px-2 py-3">
                  {MOCKUP_TYPES.map(t => (
                    <div
                      key={t.label}
                      className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs ${
                        t.active ? 'bg-accent text-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: t.color }} />
                      {t.label}
                    </div>
                  ))}
                </div>
                <div className="flex flex-1 flex-col gap-1.5 overflow-hidden p-2">
                  {MOCKUP_CARDS.map(c => (
                    <div
                      key={c.title}
                      className="rounded-lg border border-white/8 border-t-2 px-2 py-1.5"
                      style={{ borderTopColor: c.color }}
                    >
                      <div className="truncate text-xs font-medium">{c.title}</div>
                      <div className="text-xs text-muted-foreground">{c.sub}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>
    </FadeIn>
  );
}

// ─── Features Grid ────────────────────────────────────────────────────────────

interface Feature {
  icon: string;
  title: string;
  desc: string;
  accent: string;
  pro?: boolean;
}

const FEATURES: Feature[] = [
  {
    icon: '</>',
    title: 'Code Snippets',
    desc: 'Save reusable code with syntax highlighting, language detection, and instant copy.',
    accent: '#3b82f6',
  },
  {
    icon: '✦',
    title: 'AI Prompts',
    desc: 'Build a personal prompt library. Stop rewriting the same prompts from scratch.',
    accent: '#f59e0b',
  },
  {
    icon: '⌕',
    title: 'Instant Search',
    desc: 'Full-text search across all your items by title, content, tags, and type.',
    accent: '#06b6d4',
  },
  {
    icon: '$_',
    title: 'Commands',
    desc: 'Never google the same CLI command twice. Store and recall with a keystroke.',
    accent: '#22c55e',
  },
  {
    icon: '📁',
    title: 'Files & Docs',
    desc: 'Upload context files, PDFs, and documents. Access them from anywhere.',
    accent: '#64748b',
    pro: true,
  },
  {
    icon: '⊞',
    title: 'Collections',
    desc: 'Group related items into collections. Build your React Patterns or DevOps Runbook.',
    accent: '#ec4899',
  },
];

function FeaturesGrid() {
  return (
    <section id="features" className="py-24">
      <div className="container mx-auto max-w-6xl px-4">
        <FadeIn>
          <div className="mb-16 text-center">
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Features
            </p>
            <h2 className="mb-4 text-4xl font-bold md:text-5xl">
              Everything you need to{' '}
              <span className="bg-gradient-to-r from-blue-600 to-indigo-400 bg-clip-text text-transparent">
                stay in flow
              </span>
            </h2>
            <p className="mx-auto max-w-xl text-lg text-muted-foreground">
              Seven item types covering every piece of developer knowledge, all in one place.
            </p>
          </div>
        </FadeIn>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <FadeIn key={f.title} index={i}>
              <div
                className="h-full rounded-xl p-px"
                style={{ background: `linear-gradient(to bottom, ${f.accent}50, transparent)` }}
              >
                <div className="group relative flex h-full flex-col overflow-hidden rounded-[11px] bg-card p-6 transition-all duration-300 hover:-translate-y-1">
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                    style={{ background: `radial-gradient(circle at 50% 0%, ${f.accent}20, transparent 70%)` }}
                  />
                  {f.pro && (
                    <Badge variant="outline" className="absolute right-4 top-4 text-xs">
                      PRO
                    </Badge>
                  )}
                  <div
                    className="relative mb-4 flex h-10 w-10 items-center justify-center rounded-lg text-sm font-mono font-bold"
                    style={{ background: `${f.accent}20`, color: f.accent }}
                  >
                    {f.icon}
                  </div>
                  <h3 className="relative mb-2 font-semibold">{f.title}</h3>
                  <p className="relative text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── AI Section ───────────────────────────────────────────────────────────────

const AI_CHECKLIST = [
  'Auto-tag your snippets and prompts',
  'AI-generated summaries for long documents',
  '"Explain This Code" in plain English',
  'Prompt optimizer for better AI outputs',
  'Smart search with semantic understanding',
];

function AiSection() {
  return (
    <section id="ai" className="relative overflow-hidden py-24">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-card/30" />
      <div aria-hidden className="pointer-events-none absolute left-0 top-1/2 h-[500px] w-[500px] -translate-y-1/2 rounded-full bg-cyan-500/5 blur-3xl" />

      <div className="container relative mx-auto max-w-6xl px-4">
        <div className="grid items-center gap-12 md:grid-cols-2">

          <FadeIn index={0}>
            <div>
              <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-sm font-semibold text-cyan-400">
                ✦ Pro Feature
              </span>
              <h2 className="mb-6 text-4xl font-bold md:text-5xl">
                AI that actually{' '}
                <span className="bg-gradient-to-r from-blue-600 to-indigo-400 bg-clip-text text-transparent">
                  understands code
                </span>
              </h2>
              <ul className="flex flex-col gap-3">
                {AI_CHECKLIST.map(item => (
                  <li key={item} className="flex items-start gap-3 text-sm text-muted-foreground">
                    <span className="mt-0.5 font-bold text-emerald-400">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </FadeIn>

          <FadeIn index={1}>
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-card">
              <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
                <span className="h-3 w-3 rounded-full bg-red-500/80" />
                <span className="h-3 w-3 rounded-full bg-yellow-500/80" />
                <span className="h-3 w-3 rounded-full bg-green-500/80" />
                <span className="ml-auto text-xs text-muted-foreground">TypeScript</span>
              </div>
              <pre className="overflow-x-auto p-4 text-xs font-mono leading-relaxed">
                <code>
                  <span className="text-blue-400">function</span>
                  {' '}
                  <span className="text-cyan-400">useAuth</span>
                  {'() {\n'}
                  {'  '}
                  <span className="text-blue-400">const</span>
                  {' session = '}
                  <span className="text-cyan-400">useSession</span>
                  {'();\n'}
                  {'  '}
                  <span className="text-blue-400">const</span>
                  {' router = '}
                  <span className="text-cyan-400">useRouter</span>
                  {'();\n\n'}
                  {'  '}
                  <span className="text-blue-400">return</span>
                  {' {\n'}
                  {'    user: session?.user,\n'}
                  {'    isLoading: session === '}
                  <span className="text-blue-400">undefined</span>
                  {',\n'}
                  {'    '}
                  <span className="text-cyan-400">signOut</span>
                  {': () => router.push('}
                  <span className="text-emerald-400">{`'/sign-in'`}</span>
                  {')\n'}
                  {'  };\n}'}
                </code>
              </pre>
              <div className="border-t border-white/10 px-4 py-3">
                <p className="mb-2 text-xs font-medium text-cyan-400">✦ AI Generated Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {['react', 'auth', 'next.js', 'hooks', 'session'].map(tag => (
                    <span
                      key={tag}
                      className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </FadeIn>

        </div>
      </div>
    </section>
  );
}

// ─── CTA Section ──────────────────────────────────────────────────────────────

function CtaSection() {
  return (
    <FadeIn>
      <section className="py-24">
        <div className="container mx-auto max-w-6xl px-4">
          <div
            className="rounded-2xl p-px"
            style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.4), rgba(6,182,212,0.3), rgba(255,255,255,0.08))' }}
          >
            <div className="relative overflow-hidden rounded-[15px] bg-card/80 px-8 py-20 text-center backdrop-blur-sm">
              <div aria-hidden className="pointer-events-none absolute inset-0">
                <div className="absolute left-1/2 top-1/2 h-[300px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-500/8 blur-3xl" />
              </div>
              <div className="relative">
                <h2 className="mb-4 text-4xl font-bold md:text-5xl">
                  Ready to organize your{' '}
                  <span className="bg-gradient-to-r from-blue-600 to-indigo-400 bg-clip-text text-transparent">
                    developer knowledge?
                  </span>
                </h2>
                <p className="mx-auto mb-10 max-w-lg text-lg text-muted-foreground">
                  Join developers who stopped losing their work and started building faster.
                </p>
                <GradientCta href="/register">
                  Start for Free — No Card Required
                  <ArrowRight size={15} />
                </GradientCta>
              </div>
            </div>
          </div>
        </div>
      </section>
    </FadeIn>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-white/10 py-16">
      <div className="container mx-auto max-w-6xl px-4">
        <div className="mb-12 grid gap-12 md:grid-cols-[1fr_auto]">

          <div>
            <Link href="/" className="mb-3 inline-flex items-center gap-2 text-lg font-semibold">
              <span className="text-blue-400">⬡</span>
              <span>DevStash</span>
            </Link>
            <p className="max-w-xs text-sm text-muted-foreground">
              Your developer knowledge hub. One place for everything you build with.
            </p>
          </div>

          <div className="flex gap-12">
            <div className="flex flex-col gap-3">
              <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Product</h4>
              <a href="#features" className="text-sm text-muted-foreground transition-colors hover:text-foreground">Features</a>
              <a href="#pricing" className="text-sm text-muted-foreground transition-colors hover:text-foreground">Pricing</a>
              <a href="#" className="text-sm text-muted-foreground transition-colors hover:text-foreground">Changelog</a>
            </div>
            <div className="flex flex-col gap-3">
              <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Company</h4>
              <a href="#" className="text-sm text-muted-foreground transition-colors hover:text-foreground">About</a>
              <a href="#" className="text-sm text-muted-foreground transition-colors hover:text-foreground">Blog</a>
              <a href="#" className="text-sm text-muted-foreground transition-colors hover:text-foreground">Contact</a>
            </div>
            <div className="flex flex-col gap-3">
              <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Legal</h4>
              <a href="#" className="text-sm text-muted-foreground transition-colors hover:text-foreground">Privacy</a>
              <a href="#" className="text-sm text-muted-foreground transition-colors hover:text-foreground">Terms</a>
            </div>
          </div>

        </div>

        <div className="border-t border-white/10 pt-8">
          <p className="text-center text-sm text-muted-foreground">
            © {new Date().getFullYear()} DevStash. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <>
      <main>
        <HeroText />
        <HeroVisual />
        <FeaturesGrid />
        <AiSection />
        <PricingSection />
        <CtaSection />
      </main>
      <Footer />
    </>
  );
}
