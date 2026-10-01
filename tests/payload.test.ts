import { describe, expect, test, tier } from 'claude-code/testing'
import type { Comment } from '../hooks/comments/types.ts'
import { parseUnifiedDiff } from '../hooks/diff/parse.ts'
import { payloadOf } from '../hooks/send/payload.ts'
import { ALL } from './fixtures/diffs.ts'

tier('user')

const c = (over: Partial<Comment>): Comment => ({ id: 'id1', path: 'src/app.ts', side: 'RIGHT', line: 2, body: 'b', author: 'user', createdAt: 0, sentAt: null, ...over })

describe('payload', () => {
  const files = parseUnifiedDiff(ALL)

  test('maps open comments to the GitHub review shape and keeps ids', async () => {
    const p = payloadOf([c({}), c({ id: 'id2', side: 'LEFT', line: 2, body: 'gone' }), c({ id: 'id3', sentAt: 5 })], files, 'head999')
    expect(p).toEqual({
      commit_id: 'head999',
      comments: [
        { path: 'src/app.ts', side: 'RIGHT', line: 2, body: 'b' },
        { path: 'src/app.ts', side: 'LEFT', line: 2, body: 'gone' },
      ],
      ids: ['id1', 'id2'],
    })
  })

  test('refuses when nothing is open or a comment is off the diff', async () => {
    expect(payloadOf([], files, 'h')).toEqual({ error: 'no open comments' })
    expect(payloadOf([c({ line: 500 })], files, 'h')).toEqual({ error: 'off the diff: src/app.ts:500 (RIGHT)' })
  })

  test('a range comment sends start_line and start_side', async () => {
    expect(payloadOf([c({ startLine: 2, line: 4 })], files, 'h')).toEqual({
      commit_id: 'h',
      comments: [{ path: 'src/app.ts', side: 'RIGHT', start_line: 2, start_side: 'RIGHT', line: 4, body: 'b' }],
      ids: ['id1'],
    })
  })

  test('a range that no longer sits in one hunk is refused', async () => {
    expect(payloadOf([c({ startLine: 2, line: 22 })], files, 'h')).toEqual({ error: 'off the diff: src/app.ts:2-22 (RIGHT)' })
  })
})
