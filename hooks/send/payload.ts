import type { Comment } from '../comments/types.ts'
import { hasAddress, inOneHunk } from '../diff/address.ts'
import type { FileDiff, Side } from '../diff/types.ts'

export type PayloadComment = { path: string; side: Side; line: number; start_line?: number; start_side?: Side; body: string }
export type Payload = { commit_id: string; comments: PayloadComment[]; ids: string[] }
export type PayloadError = { error: string }

export const lineLabelOf = (c: Pick<Comment, 'line' | 'startLine'>): string =>
  c.startLine === undefined ? String(c.line) : `${c.startLine}-${c.line}`

const commentOf = (c: Comment): PayloadComment =>
  c.startLine === undefined
    ? { path: c.path, side: c.side, line: c.line, body: c.body }
    : { path: c.path, side: c.side, start_line: c.startLine, start_side: c.side, line: c.line, body: c.body }

export function payloadOf(comments: readonly Comment[], files: readonly FileDiff[], headSha: string): Payload | PayloadError {
  const open = comments.filter(c => c.sentAt === null)
  if (open.length === 0) return { error: 'no open comments' }
  for (const c of open) {
    const isOnDiff = c.startLine === undefined ? hasAddress(files, c.path, c.side, c.line) : inOneHunk(files, c.path, c.side, c.startLine, c.line)
    if (!isOnDiff) return { error: `off the diff: ${c.path}:${lineLabelOf(c)} (${c.side})` }
  }
  return {
    commit_id: headSha,
    comments: open.map(commentOf),
    ids: open.map(c => c.id),
  }
}
