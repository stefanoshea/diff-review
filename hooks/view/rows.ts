import type { Comment } from '../comments/types.ts'
import { addressOf } from '../diff/address.ts'
import type { FileDiff, Side } from '../diff/types.ts'
import type { Editing, FileRisk, Model, Risk, RiskLevel } from './model.ts'

export type Row =
  | { kind: 'risk'; risk: Risk; stale: boolean }
  | { kind: 'file'; path: string; label: string; collapsed: boolean; badge: FileRisk | null }
  | { kind: 'file-end'; path: string }
  | { kind: 'hunk'; text: string }
  | { kind: 'line'; key: string; gutter: string; marker: '+' | '-' | ' '; text: string; hasComments: boolean; path: string; side: Side; line: number; selected?: boolean }
  | { kind: 'comment'; comment: Comment; lines: string[] }
  | { kind: 'input'; path: string; side: Side; line: number; commentId: string | null; draft: string }
  | { kind: 'note'; text: string }

export const lineKey = (path: string, side: Side, line: number) => `l:${path}:${side}:${line}`

export const MAX_EXPANDED_ROWS = 4000

export const STATUS = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R' } as const

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g

const WIDE = /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/
const EMOJI = /[\u{1f000}-\u{1faff}\u{2614}-\u{2615}\u{2648}-\u{2653}\u{267f}\u{2693}\u{26a1}\u{26aa}-\u{26ab}\u{26bd}-\u{26be}\u{26c4}-\u{26c5}\u{26ce}\u{26d4}\u{26ea}\u{26f2}-\u{26f3}\u{26f5}\u{26fa}\u{26fd}\u{2705}\u{270a}-\u{270b}\u{2728}\u{274c}\u{274e}\u{2753}-\u{2755}\u{2757}\u{2795}-\u{2797}\u{27b0}\u{27bf}\u{2b1b}-\u{2b1c}\u{2b50}\u{2b55}]/u
const ZERO = /[\u0300-\u036f\u200d\ufe0f\u20d0-\u20f0]/

const charWidthOf = (ch: string): number => {
  const code = ch.codePointAt(0) ?? 0
  if (code < 0x80) return 1
  return ZERO.test(ch) ? 0 : WIDE.test(ch) || EMOJI.test(ch) ? 2 : 1
}

export function widthOf(text: string): number {
  let w = 0
  for (const ch of text) w += charWidthOf(ch)
  return w
}

export function cutTo(text: string, width: number): string {
  let out = ''
  let w = 0
  for (const ch of text) {
    const cw = charWidthOf(ch)
    if (w + cw > width) break
    out += ch
    w += cw
  }
  return out
}

export function padTo(text: string, width: number): string {
  const w = widthOf(text)
  return w >= width ? text : text + ' '.repeat(width - w)
}

export function cleanText(text: string, width: number): string {
  const cleaned = text.replace(/\t/g, '    ').replace(CONTROL, '·')
  if (widthOf(cleaned) <= width) return cleaned
  return cutTo(cleaned, Math.max(0, width - 1)) + '…'
}

const MARKER = { add: '+', del: '-', context: ' ' } as const

function inSelection(e: Editing | null, path: string, side: Side, line: number): boolean {
  if (!e || e.path !== path || e.side !== side) return false
  const lo = Math.min(e.line, e.endLine ?? e.line)
  const hi = Math.max(e.line, e.endLine ?? e.line)
  return line >= lo && line <= hi
}

function labelOf(file: FileDiff, comments: readonly Comment[]): string {
  let n = 0
  for (const c of comments) if ((c.path === file.path || c.path === file.oldPath) && c.sentAt === null) n++
  let adds = 0
  let dels = 0
  for (const h of file.hunks) {
    for (const l of h.lines) {
      if (l.kind === 'add') adds++
      else if (l.kind === 'del') dels++
    }
  }
  return `${STATUS[file.status]} ${file.path}  +${adds} -${dels}${n ? `  ●${n}` : ''}`
}

const NO_COMMENTS: readonly Comment[] = []

const visibleOf = (file: FileDiff, comments: readonly Comment[], model: Model): Comment[] =>
  comments.filter(c => (c.path === file.path || c.path === file.oldPath) && (model.showSent || c.sentAt === null))

function byLineOf(visible: readonly Comment[]): Map<string, Comment[]> {
  const out = new Map<string, Comment[]>()
  for (const c of visible) {
    const key = `${c.side}:${c.line}`
    const at = out.get(key)
    if (at) at.push(c)
    else out.set(key, [c])
  }
  return out
}

export function rowsOf(file: FileDiff, comments: readonly Comment[], model: Model, columns: number): Row[] {
  if (file.isBinary) return [{ kind: 'note', text: 'binary file' }]
  if (file.isLarge) return [{ kind: 'note', text: 'large diff, not shown' }]
  let maxLine = 1
  for (const h of file.hunks) for (const l of h.lines) {
    const n = Math.max(l.oldLine ?? 0, l.newLine ?? 0)
    if (n > maxLine) maxLine = n
  }
  const gutterWidth = String(maxLine).length
  const textWidth = Math.max(10, columns - gutterWidth - 2)
  const wrapWidth = wrapWidthOf(columns)
  const byLine = byLineOf(visibleOf(file, comments, model))
  const rows: Row[] = []
  for (const hunk of file.hunks) {
    rows.push({ kind: 'hunk', text: hunk.header })
    for (const l of hunk.lines) {
      const { side, line } = addressOf(l)
      const here = byLine.get(`${side}:${line}`) ?? NO_COMMENTS
      const row: Row = {
        kind: 'line', key: lineKey(file.path, side, line), gutter: String(line).padStart(gutterWidth),
        marker: MARKER[l.kind], text: cleanText(l.text, textWidth), hasComments: here.length > 0, path: file.path, side, line,
      }
      if (inSelection(model.editing, file.path, side, line)) row.selected = true
      rows.push(row)
      const e = model.editing
      if (e && e.path === file.path && e.side === side && Math.max(e.line, e.endLine ?? e.line) === line) {
        for (const c of here) if (c.id !== e.commentId) rows.push({ kind: 'comment', comment: c, lines: wrapLines(c.body, wrapWidth) })
        rows.push({ kind: 'input', path: e.path, side: e.side, line, commentId: e.commentId, draft: e.draft })
      } else {
        for (const c of here) rows.push({ kind: 'comment', comment: c, lines: wrapLines(c.body, wrapWidth) })
      }
    }
  }
  return rows
}

const ORDER_COLUMNS = 80

export type CommentStop = { id: string; path: string; sent: boolean }

function collapsedStopsInto(out: CommentStop[], file: FileDiff, comments: readonly Comment[], model: Model): void {
  if (file.isBinary || file.isLarge) return
  const byLine = byLineOf(visibleOf(file, comments, model))
  if (byLine.size === 0) return
  const e = model.editing
  for (const hunk of file.hunks) {
    for (const l of hunk.lines) {
      const { side, line } = addressOf(l)
      const here = byLine.get(`${side}:${line}`)
      if (!here) continue
      const editingHere = e !== null && e.path === file.path && e.side === side && Math.max(e.line, e.endLine ?? e.line) === line
      for (const c of here) {
        if (editingHere && c.id === e?.commentId) continue
        out.push({ id: c.id, path: file.path, sent: c.sentAt !== null })
      }
    }
  }
}

export function commentOrderOf(files: readonly FileDiff[], comments: readonly Comment[], model: Model, layout?: Layout): CommentStop[] {
  const view = layout ?? layoutOf(files, comments, model, ORDER_COLUMNS)
  const byPath = new Map<string, FileDiff>()
  for (const f of files) byPath.set(f.path, f)
  const out: CommentStop[] = []
  let file: FileDiff | undefined
  for (const row of view.rows) {
    if (row.kind === 'file') {
      file = byPath.get(row.path)
      if (row.collapsed && file) collapsedStopsInto(out, file, comments, model)
      continue
    }
    if (row.kind === 'comment' && file) out.push({ id: row.comment.id, path: file.path, sent: row.comment.sentAt !== null })
  }
  return out
}

export function centeredTopOf(top: number, height: number, bodyCount: number): number {
  if (height >= bodyCount) return top
  return top - Math.round((bodyCount - height) / 2)
}

export function totalHeightOf(rows: readonly Row[], columns: number): number {
  return rows.reduce((a, r) => a + rowHeightOf(r, columns), 0)
}

const RANK: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 }

export function fileRiskOf(risk: Risk | null, file: FileDiff): FileRisk | null {
  return risk?.files.find(f => f.path === file.path || (file.oldPath !== undefined && f.path === file.oldPath)) ?? null
}

export function riskOrderOf(files: readonly FileDiff[], risk: Risk | null): FileDiff[] {
  if (!risk) return [...files]
  const rankOf = (f: FileDiff) => { const r = fileRiskOf(risk, f); return r ? RANK[r.level] : 1 }
  return files.map((f, i) => ({ f, i, r: rankOf(f) })).sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.f)
}

export function riskLinesOf(risk: Risk, stale: boolean, width: number): string[] {
  const dims = risk.dimensions.length ? ` · needs judgment: ${risk.dimensions.join(', ')}` : ''
  const head = `risk ${risk.level}${stale ? ' (stale: diff changed)' : ''}${dims}`
  const out = wrapLines(head, width)
  out.push(...wrapLines(risk.summary, width))
  if (risk.decisions.length) {
    out.push('decisions for you:')
    for (const d of risk.decisions) {
      const [first, ...rest] = wrapLines(d, Math.max(4, width - 2))
      out.push(`• ${first ?? ''}`, ...rest.map(l => `  ${l}`))
    }
  }
  return out
}

export function allRowsOf(files: readonly FileDiff[], comments: readonly Comment[], model: Model, columns: number): { rows: Row[]; autoCollapsed: number } {
  const rows: Row[] = []
  let autoCollapsed = 0
  if (model.risk && model.showRisk) rows.push({ kind: 'risk', risk: model.risk, stale: model.target !== null && model.risk.headSha !== '' && model.risk.headSha !== model.target.headSha })
  for (const file of riskOrderOf(files, model.risk)) {
    const manuallyCollapsed = model.collapsed.includes(file.path)
    const capped = rows.length > MAX_EXPANDED_ROWS
    const collapsed = manuallyCollapsed || capped
    const badge = fileRiskOf(model.risk, file)
    const badgeWidth = badge ? widthOf(badgeTextOf(badge)) + 1 : 0
    rows.push({ kind: 'file', path: file.path, label: cleanText(labelOf(file, comments), Math.max(10, columns - 3 - badgeWidth)), collapsed, badge })
    if (collapsed) {
      if (!manuallyCollapsed) autoCollapsed++
      continue
    }
    rows.push(...rowsOf(file, comments, model, columns - RAIL_COLUMNS))
    rows.push({ kind: 'file-end', path: file.path })
  }
  return { rows, autoCollapsed }
}

export const RAIL_COLUMNS = 4

export const badgeTextOf = (b: FileRisk): string => (b.level === 'low' ? 'low' : `! ${b.level}`)

export const innerWidthOf = (columns: number) => Math.max(10, columns - RAIL_COLUMNS)

export const wrapWidthOf = (inner: number) => Math.max(20, Math.max(10, inner) - 6)

export const commentWidthOf = (columns: number) => wrapWidthOf(columns - RAIL_COLUMNS)

export function wrapLines(text: string, width: number): string[] {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    let lineWidth = 0
    for (const word of paragraph.split(' ')) {
      let w = word
      let ww = widthOf(w)
      while (ww > width) {
        if (line) { out.push(line); line = ''; lineWidth = 0 }
        const head = cutTo(w, width)
        out.push(head)
        w = w.slice(head.length)
        ww = widthOf(w)
      }
      if (!line) { line = w; lineWidth = ww }
      else if (lineWidth + 1 + ww <= width) { line += ' ' + w; lineWidth += 1 + ww }
      else { out.push(line); line = w; lineWidth = ww }
    }
    out.push(line)
  }
  return out.length ? out : ['']
}

export function rowHeightOf(row: Row, columns: number): number {
  if (row.kind === 'risk') return 2 + riskLinesOf(row.risk, row.stale, commentWidthOf(columns)).length
  if (row.kind === 'comment') return 3 + row.lines.length
  if (row.kind === 'input') return 3
  return 1
}

export type Layout = { rows: Row[]; autoCollapsed: number; heights: number[]; total: number; tops: number[]; keyIndex: Map<string, number> }

function topsOf(heights: readonly number[]): number[] {
  const out = new Array<number>(heights.length + 1)
  out[0] = 0
  let y = 0
  for (let i = 0; i < heights.length; i++) {
    y += heights[i] ?? 1
    out[i + 1] = y
  }
  return out
}

function keyIndexOf(rows: readonly Row[]): Map<string, number> {
  const out = new Map<string, number>()
  const put = (key: string, at: number) => { if (!out.has(key)) out.set(key, at) }
  rows.forEach((r, i) => {
    if (r.kind === 'line') put(r.key, i)
    else if (r.kind === 'file') put(`h:${r.path}`, i)
    else if (r.kind === 'comment') { put(`e:${r.comment.id}`, i); put(`d:${r.comment.id}`, i) }
    else if (r.kind === 'input') { put('save', i); put('ask', i); put('cancel', i); put(`in:${r.path}:${r.side}:${r.line}`, i) }
    else if (r.kind === 'risk') put('risk-hide', i)
  })
  return out
}

export function indexOfKey(layout: Layout, key: string): number {
  const at = layout.keyIndex.get(key)
  if (at !== undefined) return at
  return key.startsWith('in:') ? layout.keyIndex.get('save') ?? -1 : -1
}

export function layoutOf(files: readonly FileDiff[], comments: readonly Comment[], model: Model, columns: number): Layout {
  const { rows, autoCollapsed } = allRowsOf(files, comments, model, columns)
  const heights = rows.map(r => rowHeightOf(r, columns))
  const tops = topsOf(heights)
  return { rows, autoCollapsed, heights, total: tops[rows.length] ?? 0, tops, keyIndex: keyIndexOf(rows) }
}

type CachedLayout = {
  files: readonly FileDiff[]
  revision: number
  collapsed: string[]
  risk: Risk | null
  showSent: boolean
  showRisk: boolean
  headSha: string | undefined
  columns: number
  editKey: string
  layout: Layout
}

const editKeyOf = (model: Model): string => {
  const e = model.editing
  return e ? `${e.path}|${e.side}|${e.line}|${e.endLine}|${e.commentId}` : ''
}

export class LayoutCache {
  private cached: CachedLayout | null = null

  get(files: readonly FileDiff[], comments: () => readonly Comment[], model: Model, columns: number, revision: number): Layout {
    const editKey = editKeyOf(model)
    const c = this.cached
    if (c && c.files === files && c.revision === revision && c.collapsed === model.collapsed && c.risk === model.risk && c.showSent === model.showSent && c.showRisk === model.showRisk && c.headSha === model.target?.headSha && c.columns === columns && c.editKey === editKey) {
      if (model.editing) {
        const row = c.layout.rows.find((r): r is Extract<Row, { kind: 'input' }> => r.kind === 'input')
        if (row && row.draft !== model.editing.draft) row.draft = model.editing.draft
      }
      return c.layout
    }
    const layout = layoutOf(files, comments(), model, columns)
    this.cached = { files, revision, collapsed: model.collapsed, risk: model.risk, showSent: model.showSent, showRisk: model.showRisk, headSha: model.target?.headSha, columns, editKey, layout }
    return layout
  }
}

export type RowWindow = { before: number; rows: Row[]; heights: number[]; shown: number; after: number; from: number; to: number; total: number }

function lowerBound(tops: readonly number[], value: number): number {
  let lo = 0
  let hi = tops.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((tops[mid] ?? 0) < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function snapOffset(tops: readonly number[], total: number, bodyCount: number, current: number, by: number): number {
  const limit = Math.max(0, total - bodyCount)
  const max = limit === 0 ? 0 : (tops[Math.min(tops.length - 1, lowerBound(tops, limit))] ?? limit)
  const here = Math.max(0, Math.min(max, current))
  if (by === 0 || max === 0) return here
  const naive = Math.max(0, Math.min(max, here + by))
  if (by > 0) {
    const at = lowerBound(tops, naive)
    const top = at < tops.length ? tops[at] ?? max : max
    return Math.max(here, Math.min(max, top))
  }
  const at = Math.max(0, lowerBound(tops, naive + 1) - 1)
  return Math.min(here, Math.max(0, tops[at] ?? 0))
}

export function windowOf(rows: readonly Row[], top: number, count: number, columns: number, heights?: readonly number[], tops?: readonly number[]): RowWindow {
  const hs = heights ?? rows.map(r => rowHeightOf(r, columns))
  const ts = tops ?? topsOf(hs)
  const n = rows.length
  const total = ts[n] ?? 0
  const start = Math.max(0, Math.min(top, Math.max(0, total - count)))
  const end = start + count
  const first = Math.min(n, Math.max(0, lowerBound(ts, start + 1) - 1))
  let last = first
  while (last < n && (ts[last] ?? 0) < end) last++
  const before = ts[first] ?? total
  const shown = last > first ? (ts[last] ?? total) - before : 0
  const after = total - (ts[last] ?? total)
  return {
    before,
    rows: rows.slice(first, last),
    heights: hs.slice(first, last),
    shown,
    after,
    from: last > first ? first : -1,
    to: last > first ? last - 1 : -1,
    total,
  }
}

export function rowTopOf(rows: readonly Row[], index: number, columns: number, heights?: readonly number[]): number {
  let y = 0
  for (let i = 0; i < index && i < rows.length; i++) y += heights ? (heights[i] ?? 1) : rowHeightOf(rows[i]!, columns)
  return y
}

export function rowIndexOfKey(rows: readonly Row[], key: string): number {
  return rows.findIndex(r => (r.kind === 'line' && r.key === key) || (r.kind === 'file' && `h:${r.path}` === key) || (r.kind === 'comment' && (`e:${r.comment.id}` === key || `d:${r.comment.id}` === key)) || (r.kind === 'input' && (key === 'save' || key === 'ask' || key === 'cancel' || key.startsWith('in:'))) || (r.kind === 'risk' && key === 'risk-hide'))
}
