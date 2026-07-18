// bug-hunt :: ultracode hunt engine (TEMPLATE)
//
// Adapt this and launch it via the Workflow tool. It is the proven
//   find  ->  adversarially-verify  ->  synthesize
// pattern (the one that found 12 real, reproduced bugs in Learning Hub on its first run).
//
// HOW TO ADAPT:
//   1. Set ROOT to the absolute path of the target (a repo, or a subsystem dir).
//   2. Replace DIMENSIONS with one entry per finder. Slice the target by subsystem x lens so
//      finders don't overlap and their blind spots differ. See lenses-and-severity.md.
//   3. Scale the finder count to scope: a few for a subsystem, 6+ for a whole repo.
//   4. Leave the schemas, the pipeline, the verify step, and the synthesis as-is unless you
//      have a specific reason — the verify step in particular is what makes the output trustworthy.

export const meta = {
  name: 'bug-hunt',
  description: 'Proactive multi-agent bug-finding audit with adversarial verification',
  phases: [
    { title: 'Hunt', detail: 'finders, one per subsystem x lens, read code and surface real bugs' },
    { title: 'Verify', detail: 'adversarially refute each finding against the real code' },
    { title: 'Synthesize', detail: 'dedupe, rank, and report confirmed findings' },
  ],
}

const ROOT = '/ABSOLUTE/PATH/TO/TARGET' // <-- set me

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'file', 'line', 'severity', 'category', 'description', 'why_real', 'suggested_fix'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string', description: 'path relative to repo root' },
          line: { type: 'string', description: 'line number or range, e.g. "42" or "42-50"' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          category: { type: 'string', description: 'logic | integration | security | data-integrity | error-handling | state' },
          description: { type: 'string' },
          why_real: { type: 'string', description: 'concrete reasoning for why this is a genuine bug, not style' },
          suggested_fix: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isReal', 'confidence', 'reasoning', 'adjusted_severity'],
  properties: {
    isReal: { type: 'boolean', description: 'true ONLY if confirmed against the actual code' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    reasoning: { type: 'string' },
    adjusted_severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'none'] },
  },
}

const SYNTHESIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'confirmed_count', 'top_findings', 'themes', 'false_positive_note'],
  properties: {
    headline: { type: 'string' },
    confirmed_count: { type: 'integer' },
    top_findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'file', 'line', 'severity', 'why_it_matters', 'fix'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          why_it_matters: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
    themes: { type: 'array', items: { type: 'string' } },
    false_positive_note: { type: 'string' },
  },
}

// One entry per finder. Slice by subsystem x lens. Replace the example below.
const DIMENSIONS = [
  {
    key: 'example-subsystem',
    prompt: `You are auditing this codebase for REAL bugs in <SUBSYSTEM>. Repo root: ${ROOT}
Read and trace the logic in: <list the key files for this slice>.
Skim the relevant tests to learn intended behavior, then hunt the cases the tests do NOT cover.
Focus: <lens-specific failure modes — see lenses-and-severity.md for the catalog>.
Report ONLY genuine bugs with concrete reasoning, not style nits. For each: file path relative to repo root, line/range, severity, suggested fix. Return an empty findings array if you find nothing real.`,
  },
  // ... add one entry per finder ...
]

phase('Hunt')
log(`Hunting ${ROOT} across ${DIMENSIONS.length} subsystems: read -> adversarially verify -> synthesize.`)

const perDimension = await pipeline(
  DIMENSIONS,
  (d) => agent(d.prompt, { label: `hunt:${d.key}`, phase: 'Hunt', schema: FINDINGS_SCHEMA }),
  (result, d) => {
    const findings = (result && result.findings) || []
    if (!findings.length) return []
    return parallel(
      findings.map((f) => () =>
        agent(
          `Adversarially verify this claimed bug. Repo root: ${ROOT}
Open the ACTUAL file and read the surrounding code before deciding. Default to isReal=false if you cannot concretely confirm it from the code.

CLAIM: ${f.title}
FILE: ${f.file}   LINE: ${f.line}
CATEGORY: ${f.category}   CLAIMED SEVERITY: ${f.severity}
DESCRIPTION: ${f.description}
FINDER'S REASONING: ${f.why_real}

Confirm only if the code genuinely exhibits the bug. Adjust severity if over- or under-rated.`,
          { label: `verify:${d.key}`, phase: 'Verify', schema: VERDICT_SCHEMA }
        ).then((v) => ({ ...f, dimension: d.key, verdict: v }))
      )
    )
  }
)

const confirmed = perDimension
  .flat()
  .filter(Boolean)
  .filter((f) => f && f.verdict && f.verdict.isReal)

log(`${confirmed.length} findings survived adversarial verification.`)

if (!confirmed.length) {
  return { confirmed_count: 0, report: null, raw: [] }
}

phase('Synthesize')
const report = await agent(
  `You are the lead reviewer. Below are bug findings that SURVIVED adversarial verification. Dedupe overlaps, rank by real-world impact (severity x confidence), and produce a tight report.

CONFIRMED FINDINGS (JSON):
${JSON.stringify(confirmed, null, 2)}

Produce: a one-line headline, the confirmed count, the top findings ranked (each with why-it-matters and the fix), recurring themes across the codebase, and a one-line note on verification rigor / false-positive filtering.`,
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTHESIS_SCHEMA }
)

return { confirmed_count: confirmed.length, report, raw: confirmed }
