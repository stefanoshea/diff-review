import { describe, expect, test, tier } from 'claude-code/testing'
import { ELSEWHERE_PR, IN_PR, PR_VIEW_42, REMOTE_PR } from './fixtures/git-script.ts'
import { PANE } from './fixtures/pane.ts'
import { review } from './fixtures/review-command.ts'
import { SESSION } from './fixtures/session.ts'
import { world } from './fixtures/world.ts'

tier('user')

describe('pr-switch', () => {
  test('a second pr command switches to the new PR', async ($, on) => {
    const pr43 = JSON.stringify({ number: 43, url: 'https://github.com/acme/app/pull/43', baseRefName: 'main', headRefName: 'other', headRefOid: 'feedface0000' })
    const w = world(on, {
      'pr view 43 --json': pr43,
      'fetch --quiet origin +pull/43/head:refs/remotes/diff-review/pr-43': '',
      'merge-base origin/main refs/remotes/diff-review/pr-43': 'mb4343\n',
      'diff --no-color -U3 --find-renames mb4343 feedface0000': 'diff --git a/z.txt b/z.txt\nnew file mode 100644\n--- /dev/null\n+++ b/z.txt\n@@ -0,0 +1 @@\n+zzz\n',
      ...REMOTE_PR,
      ...IN_PR,
    })
    await $.session.start(SESSION)
    const a = await $.command.run(review('pr 42'))
    await w.clock.settle()
    expect(a.text).toContain('PR #42')
    const b = await $.command.run(review('/diff-review pr 43'))
    await w.clock.settle()
    expect(b.text).toContain('PR #43')
    const tree = JSON.stringify(await $.ui.render(PANE))
    expect(tree).toContain('PR #43')
    expect(tree).toContain('z.txt')
    expect(tree).not.toContain('src/app.ts')
  })

  test('a url for another repository reviews that PR, not the same number in this clone', async ($, on) => {
    const w = world(on, { ...ELSEWHERE_PR, ...IN_PR })
    await $.session.start(SESSION)
    const { text } = await $.command.run(review('https://github.com/other/lib/pull/457'))
    await w.clock.settle()
    expect(text).toContain('other/lib PR #457')
    expect(text).toContain('feature → staging')
    expect(w.runs.some(r => r.argv.join(' ').includes('pr view 457 --repo other/lib'))).toBe(true)
    expect(w.runs.some(r => r.argv.includes('fetch'))).toBe(false)
    const tree = JSON.stringify(await $.ui.render(PANE))
    expect(tree).toContain('other/lib')
    expect(tree).toContain('src/app.ts')
  })

  test('unknown arguments are echoed back instead of silently opening', async ($, on) => {
    const w = world(on, { ...REMOTE_PR, ...IN_PR })
    await $.session.start(SESSION)
    const { text } = await $.command.run(review('42'))
    await w.clock.settle()
    expect(text).toContain('PR #42')
    const bad = await $.command.run(review('frobnicate'))
    expect(bad.text).toContain('unknown arguments "frobnicate"')
  })
})
