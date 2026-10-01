import { describe, expect, test, tier } from 'claude-code/testing'
import { parseUnifiedDiff } from '../hooks/diff/parse.ts'
import type { Target } from '../hooks/git/target.ts'
import { askTextOf } from '../hooks/view/ask-text.ts'
import { DELETED, MODIFIED } from './fixtures/diffs.ts'

tier('user')

const branchTarget: Target = {
  mode: 'branch', toplevel: '/work', repoKey: '/work', branch: 'feature', base: 'main', mergeBase: 'abc123',
  headSha: 'head999', headRef: 'HEAD', diffSource: { kind: 'git' }, pr: null, sendBlocked: null,
}

const prTarget: Target = {
  ...branchTarget,
  mode: 'pr',
  pr: { number: 42, url: 'https://github.com/acme/app/pull/42', headRef: 'feature', nameWithOwner: 'acme/app' },
}

describe('askTextOf', () => {
  const modified = parseUnifiedDiff(MODIFIED)[0]!
  const deleted = parseUnifiedDiff(DELETED)[0]!

  test('branch header', async () => {
    const text = askTextOf(branchTarget, modified, { path: 'src/app.ts', side: 'RIGHT', from: 2, to: 3 }, '')
    expect(text).toContain('Question about a diff shown in the diff-review pane.')
    expect(text).toContain('branch feature → main')
    expect(text).toContain('File: src/app.ts (lines 2-3, RIGHT: new file numbering)')
  })

  test('PR header', async () => {
    const text = askTextOf(prTarget, modified, { path: 'src/app.ts', side: 'RIGHT', from: 2, to: 3 }, 'what changed?')
    expect(text).toContain('PR #42 feature → main')
  })

  test('RIGHT range 2-3 includes the added lines, the removed line as context, and up to 3 lines of context around', async () => {
    const text = askTextOf(branchTarget, modified, { path: 'src/app.ts', side: 'RIGHT', from: 2, to: 3 }, '')
    expect(text).toContain('+const a = 2')
    expect(text).toContain('+const b = 3')
    expect(text).toContain('-const a = 1')
    expect(text).toContain(" import x from 'x'")
    expect(text).toContain(' export { a }')
  })

  test('blank question gives the default sentence', async () => {
    const text = askTextOf(branchTarget, modified, { path: 'src/app.ts', side: 'RIGHT', from: 2, to: 3 }, '   ')
    expect(text).toContain('Explain this section and flag any risks.')
  })

  test('non-blank question is kept verbatim', async () => {
    const text = askTextOf(branchTarget, modified, { path: 'src/app.ts', side: 'RIGHT', from: 2, to: 3 }, 'is this safe?')
    expect(text).toContain('is this safe?')
    expect(text).not.toContain('Explain this section and flag any risks.')
  })

  test('LEFT single line', async () => {
    const text = askTextOf(branchTarget, deleted, { path: 'old.txt', side: 'LEFT', from: 1, to: 1 }, '')
    expect(text).toContain('File: old.txt (lines 1-1, LEFT: old file numbering)')
    expect(text).toContain('-bye')
    expect(text).toContain('-now')
  })
})
