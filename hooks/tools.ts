import type { CommentStore } from './comments/store.ts'
import { hasAddress, nearestLines } from './diff/address.ts'
import { lineLabelOf } from './send/payload.ts'
import type { FileDiff, Side } from './diff/types.ts'
import { RISK_LEVELS, type FileRisk, type Risk, type RiskLevel } from './view/model.ts'

export type ToolContext = { store: CommentStore | null; files: readonly FileDiff[]; isOpen: boolean; headSha?: string; isDiffTruncated?: boolean }
export type ToolAnswer = { ok: boolean; text: string }

const CLOSED = 'The review pane is not open. Ask the user to run /diff-review first.'

export async function serveAddComment(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolAnswer> {
  if (!ctx.isOpen || !ctx.store) return { ok: false, text: CLOSED }
  const path = String(input.path ?? '')
  const line = Number(input.line)
  const side: Side = input.side === 'LEFT' ? 'LEFT' : 'RIGHT'
  const body = String(input.body ?? '').trim()
  if (!path || !Number.isInteger(line) || line < 1 || !body) return { ok: false, text: 'path, integer line >= 1 and body are required.' }
  if (!hasAddress(ctx.files, path, side, line)) {
    const near = nearestLines(ctx.files, path, side)
    const hint = near.length ? `Diff lines on that side start: ${near.join(', ')}.` : `${path} is not in the diff.`
    return { ok: false, text: `${path}:${line} (${side}) is not on the diff. ${hint}` }
  }
  const c = await ctx.store.add({ path, side, line, body, author: 'claude' })
  const open = ctx.store.open().length
  return { ok: true, text: `Draft comment ${c.id} added at ${path}:${line} (${side}) [claude] ${c.body}\n${open} open draft comment(s). The user will triage them in the pane; list_comments shows them all.` }
}

export function serveListComments(ctx: ToolContext): ToolAnswer {
  if (!ctx.store) return { ok: false, text: CLOSED }
  return { ok: true, text: listText(ctx) }
}

function listText(ctx: ToolContext): string {
  const open = ctx.store?.open() ?? []
  if (open.length === 0) return 'No open comments.'
  const byPath = new Map<string, typeof open>()
  for (const c of open) byPath.set(c.path, [...(byPath.get(c.path) ?? []), c])
  return [...byPath.entries()]
    .map(([path, cs]) => `${path}\n` + cs.map(c => `  ${path}:${lineLabelOf(c)} (${c.side}) [${c.author}] ${c.body}`).join('\n'))
    .join('\n')
}

export const MAX_DIFF_TOOL_CHARS = 120000

export function serveGetDiff(input: Record<string, unknown>, ctx: ToolContext): ToolAnswer {
  if (!ctx.isOpen) return { ok: false, text: CLOSED }
  const only = typeof input.path === 'string' ? input.path : null
  const files = only ? ctx.files.filter(f => f.path === only || f.oldPath === only) : ctx.files
  if (only && files.length === 0) return { ok: false, text: `${only} is not in the diff. Files: ${ctx.files.map(f => f.path).join(', ')}` }
  const parts: string[] = []
  for (const f of files) {
    parts.push(`=== ${f.status} ${f.path}${f.oldPath ? ` (was ${f.oldPath})` : ''}${f.isBinary ? ' [binary]' : ''}${f.isLarge ? ' [large, hunks omitted]' : ''}`)
    for (const h of f.hunks) {
      parts.push(h.header)
      for (const l of h.lines) {
        const num = l.kind === 'del' ? `L${l.oldLine}` : `R${l.newLine}`
        parts.push(`${num.padStart(6)} ${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.text}`)
      }
    }
  }
  let text = parts.join('\n')
  let cut = false
  if (text.length > MAX_DIFF_TOOL_CHARS) { text = text.slice(0, MAX_DIFF_TOOL_CHARS) + '\n(cut: call get_diff with a path to see one file in full)'; cut = true }
  const last = ctx.files.at(-1)
  const incomplete = ctx.isDiffTruncated && last ? ` The diff is incomplete: its output was cut at 4 MiB, so ${last.path} has no hunks and any files after it are missing.` : ''
  const head = `Diff shown in the review pane: ${files.length} file(s)${cut ? ', truncated' : ''}.${incomplete} Each line starts with R<n> (new-file line, side RIGHT) or L<n> (old-file line, side LEFT). Use these with add_comment.\n\n`
  return { ok: true, text: head + text }
}

export const DEFAULT_REVIEW_SKILL = '/code-review low'

export type ReviewPlan = { command: string; args: string; followUp: string }

const withMemory = (text: string, memory: string): string => (memory.trim() ? `${text}\n\n${memory.trim()}` : text)

const isElsewhere = (target: string | null): boolean => target !== null && !/^\d+$/.test(target)

const prLabelOf = (target: string): string => (/^\d+$/.test(target) ? `PR #${target}` : `PR ${target}`)

export const ELSEWHERE_NOTE =
  'This pull request is in a different repository than the working directory: read it only through the diff-review tools and gh, never from local files.'

export const reviewPlanOf = (skill: string, target: string | null, memory = ''): ReviewPlan => {
  const words = skill.trim().replace(/^\//, '').split(/\s+/).filter(Boolean)
  const command = words[0] ?? 'code-review'
  const args = [...words.slice(1), ...(target ? [target] : [])].join(' ')
  const followUp = [
    ...(isElsewhere(target) ? [ELSEWHERE_NOTE] : []),
    'Now turn each finding from that review into a draft comment in the diff-review pane.',
    'Call mcp__diff-review__get_diff to get the R<n>/L<n> line numbers (call it again with a path for a truncated file),',
    'then call mcp__diff-review__add_comment once per finding on the exact line, side RIGHT for R lines and LEFT for L lines.',
    'Skip findings already present in mcp__diff-review__list_comments. Keep each comment short: what is wrong and what to do.',
    'End with one line: how many drafts you added. The user triages every draft before the review is sent.',
  ].join(' ')
  return { command, args, followUp: withMemory(followUp, memory) }
}

const levelOf = (v: unknown): RiskLevel | null => (RISK_LEVELS as readonly string[]).includes(String(v)) ? (v as RiskLevel) : null

const stringsOf = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean).slice(0, max) : []

export type RiskAnswer = ToolAnswer & { risk?: Risk }

export function serveSetRisk(input: Record<string, unknown>, ctx: ToolContext): RiskAnswer {
  if (!ctx.isOpen) return { ok: false, text: CLOSED }
  const level = levelOf(input.level)
  const summary = String(input.summary ?? '').trim()
  if (!level || !summary) return { ok: false, text: 'level (low|medium|high) and summary are required.' }
  const known = new Set(ctx.files.flatMap(f => [f.path, ...(f.oldPath ? [f.oldPath] : [])]))
  const files: FileRisk[] = []
  const unknown: string[] = []
  for (const raw of Array.isArray(input.files) ? input.files : []) {
    const f = raw as Record<string, unknown>
    const path = String(f.path ?? '')
    const l = levelOf(f.level)
    if (!known.has(path)) { if (path) unknown.push(path); continue }
    if (!l) continue
    files.push({ path, level: l, reason: String(f.reason ?? '').trim().slice(0, 200) })
  }
  const risk: Risk = {
    headSha: ctx.headSha ?? '',
    level,
    summary: summary.slice(0, 1000),
    dimensions: stringsOf(input.dimensions, 8),
    decisions: stringsOf(input.decisions, 8),
    files,
  }
  const low = files.filter(f => f.level === 'low').length
  const note = unknown.length ? ` Ignored paths not in the diff: ${unknown.join(', ')}.` : ''
  return { ok: true, text: `Risk recorded: ${level}, ${files.length} file(s) rated, ${low} low-risk file(s) collapsed in the pane.${note}`, risk }
}

export const riskPromptOf = (target: string | null, memory = ''): string => withMemory([
  `Risk analysis${target ? ` for ${prLabelOf(target)}` : ''} before the line review.`,
  ...(isElsewhere(target) ? [ELSEWHERE_NOTE] : []),
  'Call mcp__diff-review__get_diff once and read the whole diff (call it again with a path for a truncated file).',
  'Then call mcp__diff-review__set_risk exactly once with:',
  'level: overall risk low|medium|high;',
  'summary: one or two sentences on what the change does and why that risk level;',
  'dimensions: the review dimensions that need human judgment, from architecture, security, data, concurrency, performance, api, tests, config, docs;',
  'decisions: up to 5 concrete decisions only the reviewer can make, each one sentence;',
  'files: every file in the diff with level low|medium|high and a short reason.',
  'Rate low: docs, comments, formatting, config with no behaviour change, test-only edits, trivial renames.',
  'Rate high: auth, permissions, secrets, money, data migrations, deletes, public API or schema changes, concurrency, anything without tests that changes behaviour.',
  'Do not add line comments in this step. End with one line: the overall level and the dimensions.',
].join(' '), memory)
