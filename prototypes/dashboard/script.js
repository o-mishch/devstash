/* DevStash dashboard mockup — concept switching + shared recent-items data */

const TYPES = {
  snippet: { color: 'var(--t-snippet)', bg: 'rgba(59,130,246,.16)', icon: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>' },
  prompt:  { color: 'var(--t-prompt)',  bg: 'rgba(139,92,246,.16)', icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
  command: { color: 'var(--t-command)', bg: 'rgba(249,115,22,.16)', icon: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>' },
  note:    { color: 'var(--t-note)',    bg: 'rgba(253,224,71,.16)', icon: '<path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5z"/><polyline points="15 3 15 9 21 9"/>' },
  link:    { color: 'var(--t-link)',    bg: 'rgba(16,185,129,.16)', icon: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>' },
}

const RECENT = [
  { type: 'snippet', title: 'sdg', sub: 'zsdgvfgghgggg', time: 'Jun 16', pinned: true },
  { type: 'snippet', title: '345', sub: 'wer', time: 'Jun 16' },
  { type: 'prompt', title: 'GPT-4 code review', sub: 'Review this diff for bugs and clarity…', time: 'Jun 16' },
  { type: 'command', title: 'git reset --hard', sub: 'git reset --hard origin/main', time: 'Jun 15' },
  { type: 'snippet', title: 'useAuth hook', sub: 'const session = useSession()', time: 'Jun 14' },
  { type: 'note', title: 'Deploy checklist', sub: 'Run migrations · purge cache · smoke test', time: 'Jun 12' },
]

function svg(paths, cls) {
  return `<svg ${cls ? `class="${cls}"` : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
}

const pinIco = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 17h14l-1.5-9H6.5z"/><line x1="12" y1="17" x2="12" y2="22" stroke="currentColor" stroke-width="2"/></svg>'

/* Concept A — glassy rows */
function renderA() {
  const el = document.getElementById('recent-a')
  el.innerHTML = RECENT.map((r) => {
    const t = TYPES[r.type]
    return `<div class="item-row">
      <div class="ir-ico" style="background:${t.bg};color:${t.color}">${svg(t.icon)}</div>
      <div class="ir-body"><h5>${r.title}</h5><p>${r.sub}</p></div>
      ${r.pinned ? `<span class="pin">${pinIco}</span>` : ''}
      <span class="ir-time">${r.time}</span>
    </div>`
  }).join('')
}

/* Concept B — HUD rows */
function renderB() {
  const el = document.getElementById('recent-b')
  el.innerHTML = RECENT.map((r, i) => {
    const t = TYPES[r.type]
    return `<div class="hud-row" style="border-left-color:${t.color}">
      <span class="idx">${String(i + 1).padStart(2, '0')}</span>
      <span class="ico" style="background:${t.bg};color:${t.color}">${svg(t.icon)}</span>
      <div class="nm"><h5>${r.title}</h5><p>${r.sub}</p></div>
      <span class="tm">${r.time.toUpperCase()}</span>
    </div>`
  }).join('')
}

/* Concepts D / E / F reuse the glassy item-row markup */
function renderRows(id, limit) {
  const el = document.getElementById(id)
  if (!el) return
  el.innerHTML = RECENT.slice(0, limit).map((r) => {
    const t = TYPES[r.type]
    return `<div class="item-row">
      <div class="ir-ico" style="background:${t.bg};color:${t.color}">${svg(t.icon)}</div>
      <div class="ir-body"><h5>${r.title}</h5><p>${r.sub}</p></div>
      ${r.pinned ? `<span class="pin">${pinIco}</span>` : ''}
      <span class="ir-time">${r.time}</span>
    </div>`
  }).join('')
}

/* Concept F — activity heatmap (12 weeks × 7 days) */
function renderHeatmap() {
  const el = document.getElementById('heatmap')
  if (!el) return
  const levels = [
    'rgba(255,255,255,.06)',
    'rgba(79,124,255,.35)',
    'rgba(79,124,255,.6)',
    'var(--brand)',
  ]
  // deterministic-ish sparse activity
  const cols = Array.from({ length: 12 }, (_, w) => {
    const cells = Array.from({ length: 7 }, (_, d) => {
      const seed = (w * 7 + d) % 11
      const lvl = seed === 0 ? 3 : seed < 2 ? 2 : seed < 4 ? 1 : 0
      return `<span class="cell" style="background:${levels[lvl]}"></span>`
    }).join('')
    return `<div class="col">${cells}</div>`
  }).join('')
  el.innerHTML = cols
}

/* Concept switcher */
function activate(c) {
  document.querySelectorAll('.concept').forEach((s) => s.classList.toggle('show', s.dataset.concept === c))
  document.querySelectorAll('#seg button').forEach((b) => b.classList.toggle('active', b.dataset.c === c))
}

document.getElementById('seg').addEventListener('click', (e) => {
  const btn = e.target.closest('button')
  if (btn) activate(btn.dataset.c)
})

renderA()
renderB()
renderRows('recent-d', 5)
renderRows('recent-e', 5)
renderRows('recent-f', 5)
renderRows('recent-g', 5)
renderRows('recent-h', 5)
renderRows('recent-k', 5)
renderHeatmap()
