export const meta = {
  name: 'cleanup-improve-audit',
  description: 'Fan out the improve audit over every (group x unit), then refute every uncertain finding',
  whenToUse: 'Invoked by the cleanup skill in improve mode. Not intended to be run directly.',
  phases: [
    { title: 'Find', detail: 'one agent per group per unit (P3, P4+P5; merged P3+P4+P5 for small groups)', model: 'haiku' },
    { title: 'Cross-cutting', detail: 'P1/P2 over extracted structure, not raw source', model: 'sonnet' },
    { title: 'Verify', detail: 'adversarial refutation of every medium/low-confidence finding, one agent per file', model: 'sonnet' },
  ],
}

/**
 * Plain JS, not TS — the Workflow sandbox parses no type annotations, has no
 * filesystem, and throws on Date.now()/Math.random(). Rationale for the fan-out
 * shape, the Haiku tiering, and the confidence-gated verify: ../DESIGN.md.
 *
 * @typedef {{ id: string, title: string, scope: 'group'|'changeset' }} Lens
 * @typedef {{ id: string, lensIds: string[] }} Unit
 * @typedef {{ id: string, units: Unit[], area: string }} GroupRef
 * @typedef {{ groupDir: string, structurePath: string, ledgerPath: string,
 *             groups: GroupRef[], changesetLenses: Lens[],
 *             ruleFiles: string[], quickTier?: boolean }} AuditArgs
 * @typedef {{ lens: string, title: string, severity: 'major'|'minor',
 *             confidence: 'high'|'medium'|'low', file: string, line: number,
 *             problem: string, evidence: string, impact: string, fix: string,
 *             locDelta: string, rule?: string, unverified?: string }} Finding
 * @typedef {{ findings: Finding[], covered: string[],
 *             skipped?: Array<{file: string, reason: string}> }} FinderResult
 * @typedef {{ index: number, refuted: boolean, reason: string,
 *             correctedSeverity?: 'major'|'minor' }} Verdict
 */

/** @type {AuditArgs} */
// The Workflow tool delivers `args` as a JSON string, not a parsed object.
const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args

if (typeof parsedArgs.groupDir !== 'string') throw new Error('args.groupDir must be a string')
if (typeof parsedArgs.structurePath !== 'string') throw new Error('args.structurePath must be a string')
if (typeof parsedArgs.ledgerPath !== 'string') throw new Error('args.ledgerPath must be a string')
if (!Array.isArray(parsedArgs.ruleFiles)) throw new Error('args.ruleFiles must be an array')
if (!Array.isArray(parsedArgs.groups)) throw new Error('args.groups must be an array')
if (!Array.isArray(parsedArgs.changesetLenses)) throw new Error('args.changesetLenses must be an array')

const { groupDir, structurePath, ruleFiles, groups: groupRefs, changesetLenses, ledgerPath, quickTier } = parsedArgs

const LENS_DOC_BASE = '.agents/skills/cleanup/references/improve'
const DOCTRINE = `${LENS_DOC_BASE}/common.md`
const VERIFY_DOC = `${LENS_DOC_BASE}/verify.md`

/** Each lens's signals live in its own fragment, so a finder loads only what it applies. */
function lensDoc(lensId) {
  return `${LENS_DOC_BASE}/${lensId.toLowerCase()}.md`
}

// Some lenses split their stack-specific signals into per-stack fragments so a
// finder loads only its own workspace's bullets, not the other two stacks' it
// cannot act on. Only P4 carries enough finder-loaded stack-specific bulk to earn
// the split — P1/P2 are changeset-wide (one agent spans all stacks anyway), and
// P3/P5's stack content is a line or two. See DESIGN.md. A stack outside this set
// (e.g. `.agents`, `infra`) simply loads the shared fragment alone.
const STACK_FRAGMENT_LENSES = new Set(['P4'])
const STACK_FRAGMENT_STACKS = new Set(['src', 'web', 'backend'])

// Stacks whose medium-confidence findings ship without a refuter. web/ and backend/
// idioms (a missing invalidateQueries, a goroutine with no ctx.Done) are usually
// self-evident from the structure the finder already quoted, so spending a Sonnet
// refuter on every one of them buys little. src/ is deliberately NOT here: it is the
// live app (boundary.md), so its medium/low findings are always refuted — the floor.
// Low confidence is never skipped for any stack; only medium. See DESIGN.md.
const VERIFY_SKIP_STACKS = new Set(['web', 'backend'])

/** The workspace a file lives in — its first path segment. */
function stackOf(file) {
  return file.split('/')[0]
}

/** A medium-confidence finding on a deprioritized stack skips refutation; everything else is judged. */
function skipsVerify(finding) {
  return finding.confidence === 'medium' && VERIFY_SKIP_STACKS.has(stackOf(finding.file))
}

/** The per-stack companion fragment for a lens, e.g. p4.web.md — only when both are in the sets above. */
function stackLensDoc(lensId, stack) {
  return STACK_FRAGMENT_LENSES.has(lensId) && STACK_FRAGMENT_STACKS.has(stack)
    ? `${LENS_DOC_BASE}/${lensId.toLowerCase()}.${stack}.md`
    : null
}

/**
 * Findings carry their own lens id, so the P4+P5 unit reports into both report
 * sections from one agent. The enum is built per unit — a P3 finder cannot file
 * a P4 finding by mistake.
 */
function findingsSchema(lensIds) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['findings', 'covered'],
    properties: {
      covered: {
        type: 'array',
        description: 'Every file you actually read in full. Used to prove coverage.',
        items: { type: 'string' },
      },
      skipped: {
        type: 'array',
        description: 'Files you did NOT review, each with the reason. Empty is expected.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['file', 'reason'],
          properties: { file: { type: 'string' }, reason: { type: 'string' } },
        },
      },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['lens', 'title', 'severity', 'confidence', 'file', 'line', 'problem', 'evidence', 'impact', 'fix', 'locDelta'],
          properties: {
            lens: { enum: lensIds, description: 'Which lens this finding came from.' },
            title: { type: 'string' },
            severity: { enum: ['major', 'minor'] },
            confidence: {
              enum: ['high', 'medium', 'low'],
              description: 'high = quoted evidence settles it (skips refutation). Otherwise medium/low.',
            },
            file: { type: 'string' },
            line: { type: 'integer' },
            problem: { type: 'string' },
            evidence: { type: 'string', description: 'The actual line or shape, quoted' },
            impact: { type: 'string' },
            fix: { type: 'string' },
            locDelta: { type: 'string' },
            rule: { type: 'string', description: 'Rule file + section. Omit when the finding breaks no rule.' },
            unverified: { type: 'string', description: 'Required for medium/low confidence: what you could not confirm.' },
          },
        },
      },
    },
  }
}

/**
 * One verifier judges every uncertain finding in one file, so the verdicts come
 * back as a batch. The `index` ties each verdict to the candidate it settles —
 * position alone would silently mis-assign a verdict if the model skipped one.
 */
function verdictsSchema(count) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['verdicts'],
    properties: {
      verdicts: {
        type: 'array',
        description: `One verdict per candidate — ${count} in total. Omitting an index leaves that finding unverified, never refuted.`,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['index', 'refuted', 'reason'],
          properties: {
            index: { type: 'integer', description: 'The [n] of the candidate this settles.' },
            refuted: { type: 'boolean' },
            reason: { type: 'string' },
            correctedSeverity: { enum: ['major', 'minor'] },
          },
        },
      },
    },
  }
}

const RETURN_CONTRACT = 'Your final message is the return value. Return only the structured object.'

/**
 * A group finder reads its own group file and nothing else fixed — the group file
 * carries both its file list and the rules those files can actually break, so a
 * web/ group never loads the Go standards. The path is derived from the group id
 * here rather than transcribed by the model: a mis-typed filename would be a
 * silent coverage gap, the bug class this whole design exists to kill.
 */
function finderPrompt(groupId, unit, stack) {
  const lensDocs = unit.lensIds
    .flatMap((id) => {
      const stackDoc = stackLensDoc(id, stack)
      return stackDoc
        ? [`  - ${lensDoc(id)} — lens ${id}`, `  - ${stackDoc} — lens ${id}, ${stack}/ signals`]
        : [`  - ${lensDoc(id)} — lens ${id}`]
    })
    .join('\n')
  const tagging =
    unit.lensIds.length > 1
      ? `\nYou are applying ${unit.lensIds.length} lenses. Tag every finding with the lens it came from in its "lens" field. Apply each lens in full — they share one pass over the source only because reading it twice would cost more than it finds.`
      : ''

  return `
Read ${groupDir}/${groupId}.json. It gives you:
  "files"     — the files to review. Review these and no others.
  "ruleFiles" — the rules these files must obey. Read every one, audit against every one.

Read these, in this order:
  - ${DOCTRINE} — the reviewing doctrine: stance, edge cases to enumerate, severity/confidence rubric, reporting stance
${lensDocs}
  - every path in the group file's "ruleFiles"

Then read every file in "files" IN FULL, plus whatever the trace needs — callers of what changed,
callees, the tests that cover it. Read what the trace needs, not the whole directory: a sibling
you cannot name a reason to open is one you should not open.

Apply ONLY the lens(es) named above. Any deviation from a rule file is a finding; cite the rule
file and section. The rule files are the only source of truth for what a rule says — quote the
rule, never paraphrase it from memory.${tagging}

${RETURN_CONTRACT}
`.trim()
}

const CROSS_CUTTING_PROMPT = {
  P1: `Read ${structurePath}. Its "imports" array is the import graph of every changed file.
Judge layering and coupling from the graph, opening only the files the graph gives you a
specific reason to open.`,

  P2: `Read ${structurePath}. It carries two deterministic inputs:

  "clones"    — exact clone candidates (jscpd/Rabin-Karp), pre-filtered to cross-file
                pairs touching the changeset, with cross-stack pairs already removed per
                boundary.md. Each is a real textual duplicate; judge whether it is a DRY
                finding or a coincidence. Do not file one without opening both sides and
                naming the abstraction that unifies them.
  "inventory" — the exported surface of the touched workspaces, grouped by file, for the
                "does the stack already provide this?" question. It includes generated
                files on purpose: web/src/client operations and web/src/components/ui
                primitives are the provided surface even though nobody wrote them.

Also look for what no detector can see: one-use wrappers, unused generics, pass-through props,
flags no caller exercises, state a derived value would compute.`,
}

function crossCuttingPrompt(lens) {
  return `
${CROSS_CUTTING_PROMPT[lens.id].trim()}

Read these, in this order:
  - ${DOCTRINE} — the reviewing doctrine
  - ${lensDoc(lens.id)} — lens ${lens.id} — ${lens.title}
${ruleFiles.map((f) => `  - ${f}`).join('\n')}

Audit against every rule file above; any deviation is a finding, cited by file and section. The
rule files are the only source of truth for what a rule says — quote the rule, never paraphrase
it from memory.

${RETURN_CONTRACT}
`.trim()
}

/**
 * Every candidate in a batch shares one file, so the verifier reads it once and
 * judges them all against it — one agent per file, not per finding.
 */
function verifyPrompt(file, batch) {
  const candidates = batch
    .map(
      (finding, index) => `
  [${index}] ${finding.lens} — ${finding.title}   (line ${finding.line}, ${finding.confidence} confidence)
      Problem:    ${finding.problem}
      Evidence:   ${finding.evidence}
      Fix:        ${finding.fix}
${finding.rule ? `      Rule:       ${finding.rule}\n` : ''}${finding.unverified ? `      Unverified: ${finding.unverified}\n` : ''}`,
    )
    .join('')

  return `
Read ${VERIFY_DOC} and follow it exactly, including its instruction to default to refuted when
genuinely uncertain. Attack each candidate below — the finder marked every one medium or low
confidence, so it was unsure and you settle it.

All ${batch.length} candidates are in ${file}. Read that file once, then judge them against it.
Open a caller, callee, or rule file only where a specific candidate needs it.

Candidates:
${candidates}
Return one verdict per candidate, tagged with its [index]. Judge each on its own evidence — that a
neighbouring candidate is refuted says nothing about the next one.

${RETURN_CONTRACT}
`.trim()
}

// --- Find + Verify, pipelined -------------------------------------------------
// pipeline, not parallel: a group's findings start verifying the moment that
// group's finder returns, instead of waiting on the slowest finder.
// Unit count varies per group: a small group (below plan-improve.ts's
// MERGE_UNITS_LOC_BUDGET) merges P3+P4+P5 into one agent instead of the usual
// two, so it does not pay the fixed doctrine/lens/ruleFiles payload twice to
// review a handful of lines. See plan-improve.ts's unitsFor() and DESIGN.md.
// A group never straddles a directory, so its first path segment is its workspace
// — the stack whose companion lens fragment (p4.web.md, p4.backend.md, …) its
// finders should load. Derived here, not transcribed by the model, for the same
// reason group paths are: a mis-typed stack would silently drop a fragment.
const units = groupRefs.flatMap((group) =>
  group.units.map((unit) => ({ groupId: group.id, unit, stack: (group.area ?? '').split('/')[0] })),
)
const mergedGroupCount = groupRefs.filter((group) => group.units.length === 1).length

log(
  `${units.length} per-file units (${groupRefs.length} groups: ${groupRefs.length - mergedGroupCount} x 2 units, ` +
    `${mergedGroupCount} merged x 1 unit) + ${changesetLenses.length} cross-cutting`,
)
if (quickTier) log('QUICK TIER: Verify refutation pass skipped — medium/low findings tagged "quick-tier", not "survived"')

phase('Find')

// Finders and the cross-cutting lenses run concurrently, not one after the other.
// P1/P2 read only the extracted structure — available from the start — and have no
// data dependency on any finder result; the merge below is a plain concatenation.
// Awaiting the finder pipeline first left the 2 Sonnet cross-cutting agents and
// their verifiers as a sequential tail after ~90 finders. Promise.all lets them
// fill concurrency slots the fast Haiku finders vacate instead. Safe because every
// agent carries an explicit `phase:` opt, so the shared phase() state never races.
const [perFile, crossCutting] = await Promise.all([
  pipeline(
    units,
    // Haiku: a finder does bounded pattern-matching over ~500 LOC against an
    // explicit checklist, and this is where the agent volume is. Verification and
    // the cross-cutting lenses run on Sonnet instead of the session model — see DESIGN.md.
    ({ groupId, unit, stack }) =>
      agent(finderPrompt(groupId, unit, stack), {
        label: `${unit.id}:${groupId}`,
        phase: 'Find',
        schema: findingsSchema(unit.lensIds),
        model: 'haiku',
        // Low reasoning effort, but only for a P4/P5 finder: it executes an explicit
        // checklist (common.md's enumeration + its lens fragment's signals) over ~500
        // LOC, with the recall scaffolding externalised into that checklist rather than
        // free reasoning, and its failure mode — a false positive — is what Verify removes.
        // A P3 (or merged P3P4P5) unit is exempt: security recall is the one thing this
        // skill refuses to trade, and an auth/IDOR bug a thin finder misses is a false
        // NEGATIVE, which Verify can never recover (it only removes findings). See DESIGN.md.
        ...(unit.lensIds.includes('P3') ? {} : { effort: 'low' }),
      }),
    (result) => verifyAll(result),
  ),
  parallel(
    changesetLenses.map((lens) => async () => {
      const found = await agent(crossCuttingPrompt(lens), {
        label: `${lens.id}:changeset`,
        phase: 'Cross-cutting',
        schema: findingsSchema([lens.id]),
        // Sonnet, not the session model: P1/P2 judge extracted structure (an
        // import graph, clone candidates) against a bounded checklist — the same
        // shape of task as Verify, which was moved off the session model for the
        // same reason. See DESIGN.md.
        model: 'sonnet',
      })
      return verifyAll(found)
    }),
  ),
])

/**
 * Adversarial verification, gated on the finder's own confidence and batched by file.
 *
 * A `high` finding had to quote evidence from the file to be filed at all, so
 * refuting it mostly re-derives what the finder already proved. The refuters go
 * where precision is actually at risk: what the finder itself flagged as
 * uncertain. One refuter per file, not per finding, and not three — see DESIGN.md.
 *
 * @param {FinderResult|null} result
 */
async function verifyAll(result) {
  if (!result) return { findings: [], covered: [], skipped: [] }

  const candidates = result.findings ?? []
  const settled = candidates
    .filter((finding) => finding.confidence === 'high')
    .map((finding) => ({ ...finding, verification: 'skipped-high-confidence' }))

  // Quick tier: no Verify pass at all. Medium/low findings are reported as-is,
  // tagged so the report never confuses them with a survived-refutation finding —
  // see plan-improve.ts's QUICK_TIER_GROUP_THRESHOLD and DESIGN.md.
  if (quickTier) {
    const unattacked = candidates
      .filter((finding) => finding.confidence !== 'high')
      .map((finding) => ({ ...finding, verification: 'quick-tier' }))
    return { findings: [...settled, ...unattacked], covered: result.covered ?? [], skipped: result.skipped ?? [] }
  }

  // web/ and backend/ medium-confidence findings ship without a refuter (see
  // VERIFY_SKIP_STACKS): tagged so the report renders them plainly as not-refuted,
  // never as `survived`. src/ never lands here — its medium/low findings fall
  // through to the refutation batch below, the floor that keeps the live app fully
  // verified.
  const stackSkipped = candidates
    .filter((finding) => finding.confidence !== 'high' && skipsVerify(finding))
    .map((finding) => ({ ...finding, verification: 'skipped-medium' }))

  // Group by file: N findings in one file were N agents each re-reading the same
  // source. The unit of work is the file the evidence lives in.
  const byFile = new Map()
  candidates
    .filter((finding) => finding.confidence !== 'high' && !skipsVerify(finding))
    .forEach((finding) => byFile.set(finding.file, [...(byFile.get(finding.file) ?? []), finding]))

  const judged = await parallel(
    [...byFile.entries()].map(([file, batch]) => async () => {
      // A dead verifier means UNVERIFIED, not refuted — and it now takes a whole
      // file's batch with it. Dropping these would be an invisible loss; keep
      // them and let the report mark them.
      const unverified = batch.map((finding) => ({ ...finding, verification: 'unverified' }))

      const verdicts = await agent(verifyPrompt(file, batch), {
        label: `verify:${file.split('/').pop()}`,
        phase: 'Verify',
        schema: verdictsSchema(batch.length),
        // Sonnet, not the session model: refutation is a judgement call, but a
        // bounded one — read this file, check this claim against this rule. It is
        // also the stage the run's cost lives in. See DESIGN.md.
        model: 'sonnet',
      })
      if (!verdicts) return unverified

      const byIndex = new Map((verdicts.verdicts ?? []).map((verdict) => [verdict.index, verdict]))
      return batch.map((finding, index) => {
        const verdict = byIndex.get(index)
        // A verdict the verifier never returned is unsettled, not refuted.
        if (!verdict) return unverified[index]
        if (verdict.refuted) return null
        return {
          ...finding,
          verification: 'survived',
          severity: verdict.correctedSeverity ?? finding.severity,
        }
      })
    }),
  )

  return {
    findings: [...settled, ...stackSkipped, ...judged.flat().filter(Boolean)],
    covered: result.covered ?? [],
    skipped: result.skipped ?? [],
  }
}

// --- Merge -------------------------------------------------------------------
const all = [...perFile, ...crossCutting].filter(Boolean)

const findings = all.flatMap((r) => r.findings ?? [])
const covered = [...new Set(all.flatMap((r) => r.covered ?? []))].sort((a, b) => a.localeCompare(b))
const skipped = all.flatMap((r) => r.skipped ?? [])

// Stable IDs: sorted by lens then severity then file then line, so the same
// finding gets the same ID across runs and the ledger can classify it.
const ordered = findings.sort(
  (a, b) =>
    a.lens.localeCompare(b.lens) ||
    (a.severity === b.severity ? 0 : a.severity === 'major' ? -1 : 1) ||
    a.file.localeCompare(b.file) ||
    a.line - b.line,
)

const counters = {}
const withIds = ordered.map((f) => {
  counters[f.lens] = (counters[f.lens] ?? 0) + 1
  return { id: `${f.lens}-${counters[f.lens]}`, ...f }
})

const survived = findings.filter((f) => f.verification === 'survived').length
log(`${withIds.length} findings (${survived} survived refutation); ${covered.length} files proven read`)

return {
  findings: withIds,
  coverage: { covered, skipped, expectedGroups: groupRefs.length, unitsRun: units.length },
  ledgerPath,
}
