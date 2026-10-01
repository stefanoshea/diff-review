import { describe, expect, test, tier } from 'claude-code/testing'
import { parseUnifiedDiff } from '../hooks/diff/parse.ts'
import { ADDED, ALL, BINARY, DELETED, MODIFIED, NO_NEWLINE, RENAMED } from './fixtures/diffs.ts'

tier('user')

describe('parse', () => {
  test('a modified file: two hunks with old and new numbers per line', async () => {
    const [file] = parseUnifiedDiff(MODIFIED)
    expect(file?.path).toBe('src/app.ts')
    expect(file?.status).toBe('modified')
    expect(file?.hunks.length).toBe(2)
    const first = file!.hunks[0]!
    expect(first.header).toBe('@@ -1,4 +1,5 @@')
    expect(first.lines.map(l => [l.kind, l.oldLine, l.newLine])).toEqual([
      ['context', 1, 1],
      ['del', 2, null],
      ['add', null, 2],
      ['add', null, 3],
      ['context', 3, 4],
      ['context', 4, 5],
    ])
    expect(first.lines[1]?.text).toBe('const a = 1')
    const second = file!.hunks[1]!
    expect(second.oldStart).toBe(20)
    expect(second.newStart).toBe(21)
    expect(second.lines[1]).toEqual({ kind: 'del', text: '  two', oldLine: 21, newLine: null })
  })

  test('added, deleted, renamed, binary', async () => {
    expect(parseUnifiedDiff(ADDED)[0]).toEqual(expect.objectContaining({ path: 'new.txt', oldPath: null, status: 'added' }))
    expect(parseUnifiedDiff(ADDED)[0]?.hunks[0]?.lines.map(l => l.newLine)).toEqual([1, 2])
    expect(parseUnifiedDiff(DELETED)[0]).toEqual(expect.objectContaining({ path: 'old.txt', status: 'deleted' }))
    expect(parseUnifiedDiff(DELETED)[0]?.hunks[0]?.lines.map(l => l.oldLine)).toEqual([1, 2])
    expect(parseUnifiedDiff(RENAMED)[0]).toEqual(expect.objectContaining({ path: 'b.ts', oldPath: 'a.ts', status: 'renamed' }))
    expect(parseUnifiedDiff(BINARY)[0]).toEqual(expect.objectContaining({ path: 'img.png', isBinary: true, hunks: [] }))
  })

  test('no-newline markers are skipped, and several files parse in order', async () => {
    const [file] = parseUnifiedDiff(NO_NEWLINE)
    expect(file?.hunks[0]?.lines.map(l => l.kind)).toEqual(['del', 'add'])
    expect(parseUnifiedDiff(ALL).map(f => f.path)).toEqual(['src/app.ts', 'new.txt', 'old.txt', 'b.ts', 'img.png', 'n.txt'])
    expect(parseUnifiedDiff('')).toEqual([])
  })

  test('a path containing " b/" parses from the diff header', async () => {
    const text = 'diff --git a/lib b/x.ts b/lib b/x.ts\nBinary files a/lib b/x.ts and b/lib b/x.ts differ\n'
    expect(parseUnifiedDiff(text)[0]).toEqual(expect.objectContaining({ path: 'lib b/x.ts', isBinary: true }))
  })
})
