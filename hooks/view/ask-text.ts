import { addressOf } from '../diff/address.ts'
import type { FileDiff, Side } from '../diff/types.ts'
import type { Target } from '../git/target.ts'

export type AskSelection = { path: string; side: Side; from: number; to: number }

const CONTEXT_LINES = 3
const MAX_DIFF_LINES = 400

const MARKER = { add: '+', del: '-', context: ' ' } as const

export function askTextOf(target: Target, file: FileDiff, sel: AskSelection, question: string): string {
  const header = target.mode === 'pr' && target.pr
    ? `PR #${target.pr.number} ${target.branch} → ${target.base}`
    : `branch ${target.branch} → ${target.base}`
  const numbering = sel.side === 'RIGHT' ? 'RIGHT: new file' : 'LEFT: old file'
  const fileLine = `File: ${sel.path} (lines ${sel.from}-${sel.to}, ${numbering} numbering)`

  const diffLines: string[] = []
  for (const hunk of file.hunks) {
    const matchIdx: number[] = []
    hunk.lines.forEach((l, i) => {
      const addr = addressOf(l)
      if (addr.side === sel.side && addr.line >= sel.from && addr.line <= sel.to) matchIdx.push(i)
    })
    if (matchIdx.length === 0) continue
    const lo = Math.max(0, Math.min(...matchIdx) - CONTEXT_LINES)
    const hi = Math.min(hunk.lines.length - 1, Math.max(...matchIdx) + CONTEXT_LINES)
    for (let i = lo; i <= hi; i++) {
      const l = hunk.lines[i]!
      diffLines.push(`${MARKER[l.kind]}${l.text}`)
    }
  }
  const capped = diffLines.length > MAX_DIFF_LINES ? [...diffLines.slice(0, MAX_DIFF_LINES), '(cut)'] : diffLines
  const askedQuestion = question.trim() === '' ? 'Explain this section and flag any risks.' : question

  return `Question about a diff shown in the diff-review pane.
${header}
${fileLine}

\`\`\`diff
${capped.join('\n')}
\`\`\`

${askedQuestion}
`
}
