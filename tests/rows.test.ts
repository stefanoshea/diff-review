import { describe, expect, test, tier } from 'claude-code/testing'
import type { Comment } from '../hooks/comments/types.ts'
import type { DiffLine, FileDiff } from '../hooks/diff/types.ts'
import { parseUnifiedDiff } from '../hooks/diff/parse.ts'
import { newModel, type Risk } from '../hooks/view/model.ts'
import { riskLinesOf, riskOrderOf, rowHeightOf, allRowsOf, centeredTopOf, cleanText, commentOrderOf, cutTo, lineKey, LayoutCache, MAX_EXPANDED_ROWS, padTo, rowsOf, snapOffset, widthOf, windowOf, wrapLines, rowTopOf, type Row } from '../hooks/view/rows.ts'
import { ALL } from './fixtures/diffs.ts'

tier('user')

const comment: Comment = { id: 'c1', path: 'src/app.ts', side: 'RIGHT', line: 2, body: 'hm', author: 'claude', createdAt: 0, sentAt: null }
const isLine = (r: Row | undefined): r is Extract<Row, { kind: 'line' }> => r?.kind === 'line'
const isFile = (r: Row): r is Extract<Row, { kind: 'file' }> => r.kind === 'file'

describe('rows', () => {
  const file = parseUnifiedDiff(ALL)[0]!

  test('one hunk row then one line row per diff line, comments under their line', async () => {
    const rows = rowsOf(file, [comment], newModel(), 80)
    expect(rows[0]).toEqual({ kind: 'hunk', text: '@@ -1,4 +1,5 @@' })
    expect(rows[1]).toEqual(expect.objectContaining({ kind: 'line', key: 'l:src/app.ts:RIGHT:1', gutter: ' 1', marker: ' ', text: "import x from 'x'", hasComments: false }))
    expect(rows[2]).toEqual(expect.objectContaining({ kind: 'line', key: 'l:src/app.ts:LEFT:2', marker: '-', side: 'LEFT', line: 2 }))
    expect(rows[3]).toEqual(expect.objectContaining({ kind: 'line', key: 'l:src/app.ts:RIGHT:2', marker: '+', hasComments: true }))
    expect(rows[4]).toEqual({ kind: 'comment', comment, lines: ['hm'] })
  })

  test('an input row sits under the line being edited; sent comments hide unless shown', async () => {
    const model = { ...newModel(), editing: { path: 'src/app.ts', side: 'RIGHT' as const, line: 3, endLine: null, commentId: null, draft: '' } }
    const sent = { ...comment, id: 'c2', line: 3, sentAt: 9 }
    const rows = rowsOf(file, [sent], model, 80)
    const at3 = rows.findIndex(r => isLine(r) && r.line === 3 && r.side === 'RIGHT')
    expect(rows[at3 + 1]).toEqual(expect.objectContaining({ kind: 'input', line: 3, commentId: null }))
    expect(rows.some(r => r.kind === 'comment')).toBe(false)
    expect(rowsOf(file, [sent], { ...model, showSent: true }, 80).some(r => r.kind === 'comment')).toBe(true)
  })

  test('gutter width follows the largest line number; text is cleaned and cut', async () => {
    const rows = rowsOf(file, [], newModel(), 80)
    const gutters = rows.filter(isLine).map(r => r.gutter)
    expect(gutters.every(g => g.length === 2)).toBe(true)
    expect(cleanText('a\tb\x07c', 80)).toBe('a    b·c')
    expect(cleanText('a​b c', 80)).toBe('a·b·c')
    expect(cleanText('x'.repeat(10), 5)).toBe('xxxx…')
    expect(lineKey('p', 'LEFT', 4)).toBe('l:p:LEFT:4')
  })

  test('binary and large files give one note row', async () => {
    const files = parseUnifiedDiff(ALL)
    expect(rowsOf(files[4]!, [], newModel(), 80)).toEqual([{ kind: 'note', text: 'binary file' }])
    expect(rowsOf({ ...file, isLarge: true, hunks: [] }, [], newModel(), 80)).toEqual([{ kind: 'note', text: 'large diff, not shown' }])
  })

  test('a range editing marks selected on exactly the lines in the range and puts the input row under the last selected line', async () => {
    const model = { ...newModel(), editing: { path: 'src/app.ts', side: 'RIGHT' as const, line: 2, endLine: 3, commentId: null, draft: '' } }
    const rows = rowsOf(file, [], model, 80)
    const selectedLines = rows.filter(isLine).filter(r => r.selected).map(r => `${r.side}:${r.line}`)
    expect(selectedLines.sort()).toEqual(['RIGHT:2', 'RIGHT:3'])
    const at3 = rows.findIndex(r => isLine(r) && r.line === 3 && r.side === 'RIGHT')
    expect(rows[at3 + 1]).toEqual(expect.objectContaining({ kind: 'input', line: 3, commentId: null }))
  })

  test('allRowsOf lists every file in order, each with a file row', async () => {
    const files = parseUnifiedDiff(ALL)
    const { rows, autoCollapsed } = allRowsOf(files, [comment], newModel(), 80)
    expect(rows[0]).toEqual(expect.objectContaining({ kind: 'file', path: 'src/app.ts', collapsed: false }))
    expect(rows.filter(isFile).map(r => r.path)).toEqual(files.map(f => f.path))
    expect(rows[rows.length - 1]).toEqual({ kind: 'file-end', path: files[files.length - 1]!.path })
    expect(rows.filter(r => r.kind === 'file-end').length).toBe(files.length)
    expect(autoCollapsed).toBe(0)
  })

  test('commentOrderOf walks comments in diff order across files, collapsed or not, and honours showSent', async () => {
    const files = parseUnifiedDiff(ALL)
    const second = files[1]!
    const here = { ...comment, id: 'c2', path: second.path, side: 'RIGHT' as const, line: 1 }
    const sent = { ...comment, id: 'c3', line: 3, sentAt: 9 }
    const model = { ...newModel(), collapsed: [second.path] }
    expect(commentOrderOf(files, [here, comment, sent], model).map(s => s.id)).toEqual(['c1', 'c2'])
    const withSent = commentOrderOf(files, [here, comment, sent], { ...model, showSent: true })
    expect(withSent.map(s => s.id)).toEqual(['c1', 'c3', 'c2'])
    expect(withSent.map(s => s.sent)).toEqual([false, true, false])
    expect(withSent[0]!.path).toBe('src/app.ts')
  })

  test('centeredTopOf puts the row in the middle of the body, and at the top when it does not fit', async () => {
    expect(centeredTopOf(100, 4, 25)).toBe(89)
    expect(centeredTopOf(100, 25, 25)).toBe(100)
    expect(centeredTopOf(100, 40, 25)).toBe(100)
    expect(centeredTopOf(2, 4, 25)).toBe(-9)
  })

  test('widths count terminal columns, so wide characters cut and pad correctly', async () => {
    expect(widthOf('abc')).toBe(3)
    expect(widthOf('日本語')).toBe(6)
    expect(widthOf('e\u0301')).toBe(1)
    expect(cutTo('日本語', 5)).toBe('日本')
    expect(padTo('日本', 6)).toBe('日本  ')
    expect(widthOf(padTo('日本', 6))).toBe(6)
    expect(padTo('abcdef', 4)).toBe('abcdef')
    expect(widthOf(cleanText('日本語です', 6))).toBe(5)
    expect(wrapLines('日本語です', 4).map(widthOf)).toEqual([4, 4, 2])
  })

  test('a collapsed path yields its file row and no line rows', async () => {
    const model = { ...newModel(), collapsed: [file.path] }
    const { rows } = allRowsOf([file], [], model, 80)
    expect(rows).toEqual([{ kind: 'file', path: file.path, label: expect.any(String), collapsed: true, badge: null }])
    expect(rows.some(r => r.kind === 'line')).toBe(false)
  })

  test('files past the row cap are auto-collapsed', async () => {
    const bigLines: DiffLine[] = Array.from({ length: MAX_EXPANDED_ROWS + 1 }, (_, i) => ({ kind: 'context', text: `line ${i}`, oldLine: i + 1, newLine: i + 1 }))
    const big: FileDiff = { path: 'big.ts', oldPath: null, status: 'modified', isBinary: false, isLarge: false, hunks: [{ header: '@@ -1 +1 @@', oldStart: 1, newStart: 1, lines: bigLines }] }
    const small: FileDiff = { path: 'small.ts', oldPath: null, status: 'modified', isBinary: false, isLarge: false, hunks: [{ header: '@@ -1 +1 @@', oldStart: 1, newStart: 1, lines: [{ kind: 'context', text: 'x', oldLine: 1, newLine: 1 }] }] }
    const { rows, autoCollapsed } = allRowsOf([big, small], [], newModel(), 80)
    expect(autoCollapsed).toBe(1)
    const smallRow = rows.find(r => isFile(r) && r.path === 'small.ts')
    expect(smallRow).toEqual(expect.objectContaining({ kind: 'file', path: 'small.ts', collapsed: true }))
  })

  test('windowOf shows exactly the rows in the window and clamps at the end', async () => {
    const rows: Row[] = Array.from({ length: 500 }, (_, i) => ({ kind: 'note', text: String(i) }))
    const w = windowOf(rows, 200, 30, 80)
    expect(w.from).toBe(200)
    expect(w.to).toBe(229)
    expect(w.before).toBe(200)
    expect(w.shown).toBe(30)
    expect(w.total).toBe(500)
    expect(w.before + w.shown + w.after).toBe(500)
    expect(windowOf(rows, 0, 30, 80).rows[0]).toEqual({ kind: 'note', text: '0' })
    expect(windowOf(rows, 9999, 30, 80).before).toBe(470)
    const withComment: Row[] = [{ kind: 'comment', comment: { id: 'c', path: 'p', side: 'RIGHT', line: 1, body: 'x'.repeat(200), author: 'user', createdAt: 0, sentAt: null }, lines: wrapLines('x'.repeat(200), 72) }]
    expect(windowOf(withComment, 0, 10, 80).shown).toBe(3 + wrapLines('x'.repeat(200), 72).length)
    expect(rowTopOf([...withComment, ...rows], 1, 80)).toBe(3 + wrapLines('x'.repeat(200), 72).length)
    expect(wrapLines('one two three', 7)).toEqual(['one two', 'three'])
    expect(wrapLines('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
    expect(wrapLines('a\nb', 10)).toEqual(['a', 'b'])
    expect(wrapLines('', 10)).toEqual([''])
  })

  test('snapOffset lands on a row boundary in the direction of travel and always moves a row', async () => {
    const tops = [0, 1, 2, 10, 11, 19, 20]
    expect(snapOffset(tops, 20, 5, 0, 1)).toBe(1)
    expect(snapOffset(tops, 20, 5, 2, 1)).toBe(10)
    expect(snapOffset(tops, 20, 5, 10, -1)).toBe(2)
    expect(snapOffset(tops, 20, 5, 11, -1)).toBe(10)
    expect(snapOffset(tops, 20, 5, 14, 1)).toBe(19)
    expect(snapOffset(tops, 20, 5, 19, 1)).toBe(19)
    expect(snapOffset(tops, 20, 5, 19, -1)).toBe(11)
    expect(snapOffset(tops, 20, 5, 0, -1)).toBe(0)
    expect(snapOffset(tops, 3, 10, 0, 1)).toBe(0)
  })

  test('risk orders files high, unrated, low and the card height matches its lines', async () => {
    const files = parseUnifiedDiff(ALL)
    const risk: Risk = { headSha: 'head999', level: 'medium', summary: 'Mixed change.', dimensions: ['data'], decisions: ['Keep the old table?', 'Ship before Friday?'],
      files: [{ path: 'src/app.ts', level: 'low', reason: '' }, { path: 'n.txt', level: 'high', reason: 'x' }] }
    expect(riskOrderOf(files, risk).map(f => f.path)).toEqual(['n.txt', 'new.txt', 'old.txt', 'b.ts', 'img.png', 'src/app.ts'])
    expect(riskOrderOf(files, null).map(f => f.path)).toEqual(files.map(f => f.path))
    const lines = riskLinesOf(risk, true, 60)
    expect(lines[0]).toBe('risk medium (stale: diff changed) · needs judgment: data')
    expect(lines).toContain('• Keep the old table?')
    const model = { ...newModel(), risk }
    const { rows } = allRowsOf(files, [], model, 80)
    expect(rows[0]?.kind).toBe('risk')
    expect(rowHeightOf(rows[0]!, 80)).toBe(2 + riskLinesOf(risk, false, 70).length)
    const first = rows.find(isFile)
    expect(first?.badge).toEqual({ path: 'n.txt', level: 'high', reason: 'x' })
  })
})

describe('LayoutCache', () => {
  const files = parseUnifiedDiff(ALL)

  test('returns the same object for equal inputs, a new object when revision changes, and updates the draft in place when only draft changes', async () => {
    const cache = new LayoutCache()
    const model = newModel()
    const a = cache.get(files, () => [], model, 80, 0)
    const b = cache.get(files, () => [], model, 80, 0)
    expect(b).toBe(a)

    const c = cache.get(files, () => [], model, 80, 1)
    expect(c).not.toBe(a)

    const editing = { ...newModel(), editing: { path: 'src/app.ts', side: 'RIGHT' as const, line: 2, endLine: null, commentId: null, draft: 'x' } }
    const d = cache.get(files, () => [], editing, 80, 1)
    const inputRow = d.rows.find((r): r is Extract<Row, { kind: 'input' }> => r.kind === 'input')
    expect(inputRow?.draft).toBe('x')

    const retyped = { ...editing, editing: { ...editing.editing, draft: 'y' } }
    const e = cache.get(files, () => [], retyped, 80, 1)
    expect(e).toBe(d)
    expect(e.rows.find((r): r is Extract<Row, { kind: 'input' }> => r.kind === 'input')?.draft).toBe('y')
  })
})
