import { describe, expect, test, tier } from 'claude-code/testing'
import { addressOf, hasAddress, inOneHunk, nearestLines } from '../hooks/diff/address.ts'
import { parseUnifiedDiff } from '../hooks/diff/parse.ts'
import { ALL } from './fixtures/diffs.ts'

tier('user')

describe('address', () => {
  const files = parseUnifiedDiff(ALL)

  test('del lines address LEFT, others RIGHT', async () => {
    const lines = files[0]!.hunks[0]!.lines
    expect(addressOf(lines[1]!)).toEqual({ side: 'LEFT', line: 2 })
    expect(addressOf(lines[2]!)).toEqual({ side: 'RIGHT', line: 2 })
    expect(addressOf(lines[0]!)).toEqual({ side: 'RIGHT', line: 1 })
  })

  test('hasAddress and nearestLines follow the diff', async () => {
    expect(hasAddress(files, 'src/app.ts', 'RIGHT', 3)).toBe(true)
    expect(hasAddress(files, 'src/app.ts', 'RIGHT', 10)).toBe(false)
    expect(hasAddress(files, 'src/app.ts', 'LEFT', 2)).toBe(true)
    expect(hasAddress(files, 'a.ts', 'RIGHT', 1)).toBe(true)
    expect(hasAddress(files, 'nope.ts', 'RIGHT', 1)).toBe(false)
    expect(nearestLines(files, 'src/app.ts', 'RIGHT', 4)).toEqual([1, 2, 3, 4])
  })

  test('inOneHunk is true only when both lines sit in the same hunk on that side', async () => {
    expect(inOneHunk(files, 'src/app.ts', 'RIGHT', 2, 4)).toBe(true)
    expect(inOneHunk(files, 'src/app.ts', 'RIGHT', 2, 22)).toBe(false)
    expect(inOneHunk(files, 'src/app.ts', 'RIGHT', 2, 500)).toBe(false)
    expect(inOneHunk(files, 'nope.ts', 'RIGHT', 1, 2)).toBe(false)
  })
})
