import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { FadeIn } from './fade-in'
import { GLOW_BLOB, GRADIENT_TEXT_CLASS, MARKETING_CONTAINER } from './gradient-cta'

const AI_CHECKLIST = [
  'Auto-tag your snippets and prompts',
  'AI-generated summaries for long documents',
  '"Explain This Code" in plain English',
  'Prompt optimizer for better AI outputs',
  'Smart search with semantic understanding',
]

const AI_TAGS = ['react', 'auth', 'next.js', 'hooks', 'session']

export function AiSection(): ReactNode {
  return (
    <section id="ai" className="relative overflow-hidden py-24">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-card/30" />
      <div
        aria-hidden
        className={cn(
          GLOW_BLOB,
          'left-0 top-1/2 h-[500px] w-[500px] -translate-y-1/2 bg-cyan-500/5',
        )}
      />

      <div className={cn(MARKETING_CONTAINER, 'relative')}>
        <div className="grid items-center gap-12 md:grid-cols-2">
          <FadeIn index={0}>
            <div>
              <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-sm font-semibold text-cyan-400">
                ✦ Pro Feature
              </span>
              <h2 className="mb-6 text-4xl font-bold md:text-5xl">
                AI that actually <span className={GRADIENT_TEXT_CLASS}>understands code</span>
              </h2>
              <ul className="flex list-none flex-col gap-3 p-0">
                {AI_CHECKLIST.map((item) => (
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
              <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed">
                <code>
                  <span className="text-blue-400">function</span>{' '}
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
                  {AI_TAGS.map((tag) => (
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
  )
}
