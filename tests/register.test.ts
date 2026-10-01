import { describe, expect, mock, test, tier } from 'claude-code/testing'
import { ALL } from './fixtures/diffs.ts'
import { IN_PR, NO_PR, REMOTE_PR } from './fixtures/git-script.ts'
import { PANE } from './fixtures/pane.ts'
import { review } from './fixtures/review-command.ts'
import { SESSION } from './fixtures/session.ts'
import { runTurn } from './fixtures/turns.ts'
import { SESSION_ID, world } from './fixtures/world.ts'

tier('user')

describe('register', () => {
  test('session start registers /diff-review and the two tools', async ($, on) => {
    const commands: string[] = []
    const tools: string[] = []
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => { commands.push(e.name); return { value: { command: e.name } } })
    on('tool.register', ($, e) => { tools.push(e.name); return { value: { tool: `mcp__diff-review__${e.name}` } } })
    await $.session.start(SESSION)
    expect(commands).toEqual(['diff-review'])
    expect(tools).toEqual(['add_comment', 'list_comments', 'set_risk', 'get_diff'])
  })

  test('/diff-review opens the pane, resolves the target and fetches the diff', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    const { text } = await $.command.run(review())
    await w.clock.settle()
    expect(w.opened).toEqual(['diff-review'])
    expect(text).toContain('feature')
    expect(w.runs.some(r => r.argv.join(' ').includes('diff --no-color'))).toBe(true)
    const tree = await $.ui.render(PANE)
    expect(JSON.stringify(tree)).toContain('src/app.ts')
  })

  test('pressing a gutter shows the input; the tool adds a claude comment', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    await $.ui.render(PANE)
    await $.ui.press({ plugin: 'diff-review', key: 'l:src/app.ts:RIGHT:2' })
    const tree = JSON.stringify(await $.ui.render(PANE))
    expect(tree).toContain('in:src/app.ts:RIGHT:2')

    const r = await $.tool.call({ tool: 'mcp__diff-review__add_comment', path: 'src/app.ts', line: 3, side: 'RIGHT', body: 'Consider a const' } as never)
    expect(JSON.stringify(r)).toContain('src/app.ts:3')

    const bad = await $.tool.call({ tool: 'mcp__diff-review__add_comment', path: 'src/app.ts', line: 900, body: 'x' } as never)
    expect(JSON.stringify(bad)).toContain('not on the diff')
    const list = await $.tool.call({ tool: 'mcp__diff-review__list_comments' } as never)
    expect(JSON.stringify(list)).toContain('src/app.ts:3 (RIGHT) [claude] Consider a const')
  })

  test('send posts the pending review and marks comments sent', async ($, on) => {
    const w = world(on, { ...IN_PR, 'api -X POST': JSON.stringify({ html_url: 'https://github.com/acme/app/pull/42#pullrequestreview-1' }) })
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    await $.tool.call({ tool: 'mcp__diff-review__add_comment', path: 'src/app.ts', line: 2, body: 'why' } as never)
    const { text } = await $.command.run(review('send'))
    expect(text).toContain('pullrequestreview-1')
    const post = w.runs.find(r => r.argv[1] === 'api')
    expect(post?.argv[4]).toBe('repos/acme/app/pulls/42/reviews')
    expect(JSON.parse(post?.stdin ?? '{}').comments).toEqual([{ path: 'src/app.ts', side: 'RIGHT', line: 2, body: 'why' }])
    const list = await $.tool.call({ tool: 'mcp__diff-review__list_comments' } as never)
    expect(JSON.stringify(list)).toContain('No open comments')
  })

  test('branch-mode send refuses when a commented file has uncommitted changes', async ($, on) => {
    const w = world(on, { ...IN_PR, 'diff --name-only HEAD': 'src/app.ts\n', 'api -X POST': JSON.stringify({ html_url: 'https://github.com/acme/app/pull/42#pullrequestreview-1' }) })
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    await $.tool.call({ tool: 'mcp__diff-review__add_comment', path: 'src/app.ts', line: 2, body: 'why' } as never)
    const { text } = await $.command.run(review('send'))
    expect(text).toBe('review: cannot send: uncommitted changes in src/app.ts; commit and push first')
    expect(w.runs.find(r => r.argv.join(' ').includes('diff --name-only HEAD'))?.argv.slice(-2)).toEqual(['--', 'src/app.ts'])
    expect(w.runs.some(r => r.argv.includes('POST'))).toBe(false)
    await w.clock.settle()
    expect(JSON.stringify(await $.ui.render(PANE))).toContain('cannot send: uncommitted changes in src/app.ts')
  })

  test('send without a PR refuses with the reason', async ($, on) => {
    const w = world(on, NO_PR)
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    const { text } = await $.command.run(review('send'))
    expect(text).toContain('no pull request for this branch')
  })

  test('a failed git diff shows the git error in the footer, not send ready', async ($, on) => {
    const w = world(on, { ...IN_PR, 'diff --no-color': { exitCode: 128, stdout: '', stderr: 'fatal: bad object abc123\nmore' } })
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    const tree = JSON.stringify(await $.ui.render(PANE))
    expect(tree).toContain('git diff failed: fatal: bad object abc123')
    expect(tree).not.toContain('send ready')
  })

  test('a diff cut at 4 MiB names the last file in the footer and get_diff says it is incomplete', async ($, on) => {
    const w = world(on, { ...IN_PR, 'diff --no-color': { exitCode: 0, stdout: ALL, stderr: '', isStdoutTruncated: true } })
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    expect(JSON.stringify(await $.ui.render(PANE))).toContain('diff cut at 4 MiB: files after n.txt are missing')
    const diff = JSON.stringify(await $.tool.call({ tool: 'mcp__diff-review__get_diff' } as never))
    expect(diff).toContain('incomplete')
    expect(diff).toContain('n.txt [large, hunks omitted]')
  })

  test('an Edit tool call refreshes the diff after the debounce', async ($, on) => {
    const w = world(on)
    on('tool.call', () => ({ result: 'done' }))
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    const before = w.runs.filter(r => r.argv.join(' ').includes('diff --no-color')).length
    await $.tool.call({ tool: 'Edit', file_path: '/work/src/app.ts', old_string: '1', new_string: '2' })
    await w.clock.advance(1000)
    const after = w.runs.filter(r => r.argv.join(' ').includes('diff --no-color')).length
    expect(after).toBe(before + 1)
  })

  test('two overlapping refreshes settle into one coherent state, not a corrupted mix', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    const before = w.runs.filter(r => r.argv.join(' ').includes('diff --no-color')).length

    const first = $.command.run(review('refresh'))
    const second = $.command.run(review('refresh'))
    await Promise.all([first, second])
    await w.clock.settle()

    const after = w.runs.filter(r => r.argv.join(' ').includes('diff --no-color')).length
    expect(after).toBe(before + 1)
    const tree = JSON.stringify(await $.ui.render(PANE))
    expect(tree).toContain('src/app.ts')
    expect(tree).toContain('send ready')
  })

  test('/diff-review pr 42 opens the pane in PR mode without touching local HEAD', async ($, on) => {
    const w = world(on, REMOTE_PR)
    await $.session.start(SESSION)
    const { text } = await $.command.run(review('pr 42'))
    await w.clock.settle()
    expect(w.opened).toEqual(['diff-review'])
    expect(text).toContain('PR #42')
    expect(text).toContain('deadbee')
    expect(w.runs.some(r => r.argv.join(' ').includes('rev-parse --abbrev-ref HEAD'))).toBe(false)
  })

  test('adding a comment then sending in PR mode posts to the PR endpoint with the PR head sha', async ($, on) => {
    const w = world(on, { ...REMOTE_PR, ...IN_PR, 'api -X POST': JSON.stringify({ html_url: 'https://github.com/acme/app/pull/42#pullrequestreview-1' }) })
    await $.session.start(SESSION)
    await $.command.run(review('pr 42'))
    await w.clock.settle()
    await $.tool.call({ tool: 'mcp__diff-review__add_comment', path: 'src/app.ts', line: 2, body: 'why' } as never)

    await $.command.run(review('branch'))
    await w.clock.settle()
    const branchList = await $.tool.call({ tool: 'mcp__diff-review__list_comments' } as never)
    expect(JSON.stringify(branchList)).toContain('No open comments')

    await $.command.run(review('pr 42'))
    await w.clock.settle()
    const prList = await $.tool.call({ tool: 'mcp__diff-review__list_comments' } as never)
    expect(JSON.stringify(prList)).toContain('src/app.ts:2 (RIGHT) [claude] why')

    const { text } = await $.command.run(review('send'))
    expect(text).toContain('pullrequestreview-1')
    const post = w.runs.find(r => r.argv[1] === 'api')
    expect(post?.argv[4]).toBe('repos/acme/app/pulls/42/reviews')
    expect(JSON.parse(post?.stdin ?? '{}').commit_id).toBe('deadbeefcafe0000')
  })

  test('an Edit tool call in PR mode triggers no new diff run after the debounce', async ($, on) => {
    const w = world(on, REMOTE_PR)
    on('tool.call', () => ({ result: 'done' }))
    await $.session.start(SESSION)
    await $.command.run(review('pr 42'))
    await w.clock.settle()
    const before = w.runs.filter(r => r.argv.join(' ').includes('diff --no-color')).length
    await $.tool.call({ tool: 'Edit', file_path: '/work/src/app.ts', old_string: '1', new_string: '2' })
    await w.clock.advance(1000)
    const after = w.runs.filter(r => r.argv.join(' ').includes('diff --no-color')).length
    expect(after).toBe(before)
  })

  test('/diff-review branch switches back to branch mode', async ($, on) => {
    const w = world(on, { ...REMOTE_PR, ...IN_PR })
    await $.session.start(SESSION)
    await $.command.run(review('pr 42'))
    await w.clock.settle()
    const { text } = await $.command.run(review('branch'))
    await w.clock.settle()
    expect(w.runs.some(r => r.argv.join(' ').includes('rev-parse --abbrev-ref HEAD'))).toBe(true)
    expect(text).toContain('feature')
  })

  test('extending a comment to a range renders the input row under the last line pressed', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    await $.ui.render(PANE)
    await $.ui.press({ plugin: 'diff-review', key: 'l:src/app.ts:RIGHT:2' })
    await $.ui.press({ plugin: 'diff-review', key: 'l:src/app.ts:RIGHT:4' })
    const tree = JSON.stringify(await $.ui.render(PANE))
    expect(tree).toContain('in:src/app.ts:RIGHT:4')
  })

  test('saving a range inside one hunk keeps it as a range, shows lines a-b, and sends start_line', async ($, on) => {
    const w = world(on, { ...IN_PR, 'api -X POST': JSON.stringify({ html_url: 'https://github.com/acme/app/pull/42#pullrequestreview-1' }) })
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    await $.ui.render(PANE)
    await $.ui.press({ plugin: 'diff-review', key: 'l:src/app.ts:RIGHT:2' })
    await $.ui.press({ plugin: 'diff-review', key: 'l:src/app.ts:RIGHT:4' })
    await $.ui.render(PANE)
    await $.ui.input({ plugin: 'diff-review', key: 'in:src/app.ts:RIGHT:4', text: 'range note' })
    await w.clock.settle()
    expect(JSON.stringify(await $.ui.render(PANE))).toContain('lines 2-4')
    const list = JSON.stringify(await $.tool.call({ tool: 'mcp__diff-review__list_comments' } as never))
    expect(list).toContain('src/app.ts:2-4 (RIGHT) [user] range note')
    await $.command.run(review('send'))
    const post = w.runs.find(r => r.argv.includes('POST'))
    expect(JSON.parse(post?.stdin ?? '{}').comments).toEqual([{ path: 'src/app.ts', side: 'RIGHT', start_line: 2, start_side: 'RIGHT', line: 4, body: 'range note' }])
  })

  test('a range across two hunks is saved on its first line', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    await $.ui.render(PANE)
    await $.ui.press({ plugin: 'diff-review', key: 'l:src/app.ts:RIGHT:2' })
    await $.ui.press({ plugin: 'diff-review', key: 'l:src/app.ts:RIGHT:22' })
    await $.ui.render(PANE)
    await $.ui.input({ plugin: 'diff-review', key: 'in:src/app.ts:RIGHT:22', text: 'cross' })
    await w.clock.settle()
    const list = JSON.stringify(await $.tool.call({ tool: 'mcp__diff-review__list_comments' } as never))
    expect(list).toContain('src/app.ts:2 (RIGHT) [user] cross')
  })

  test('pressing ask submits a prompt built from the selected range', async ($, on) => {
    const w = world(on)
    const asked: string[] = []
    on('prompt.submit', ($, e) => { asked.push(e.text); return { text: e.text } })
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    await $.ui.render(PANE)
    await $.ui.press({ plugin: 'diff-review', key: 'l:src/app.ts:RIGHT:2' })
    await $.ui.press({ plugin: 'diff-review', key: 'l:src/app.ts:RIGHT:4' })
    await $.ui.render(PANE)
    await $.ui.press({ plugin: 'diff-review', key: 'ask' })
    expect(asked.length).toBe(1)
    expect(asked[0]).toContain('File: src/app.ts (lines 2-4')
    expect(asked[0]).toContain('const b = 3')
  })

  test('pressing a file header collapses and expands its rows', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    const before = JSON.stringify(await $.ui.render(PANE))
    expect(before).toContain('l:src/app.ts:RIGHT:1')
    await $.ui.press({ plugin: 'diff-review', key: 'h:src/app.ts' })
    const collapsed = JSON.stringify(await $.ui.render(PANE))
    expect(collapsed).not.toContain('l:src/app.ts:RIGHT:1')
    await $.ui.press({ plugin: 'diff-review', key: 'h:src/app.ts' })
    const expanded = JSON.stringify(await $.ui.render(PANE))
    expect(expanded).toContain('l:src/app.ts:RIGHT:1')
  })

  test('expand all clears every collapsed file', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    await $.ui.render(PANE)
    await $.ui.press({ plugin: 'diff-review', key: 'h:src/app.ts' })
    expect(JSON.stringify(await $.ui.render(PANE))).not.toContain('l:src/app.ts:RIGHT:1')
    await $.ui.press({ plugin: 'diff-review', key: 'expand-all' })
    expect(JSON.stringify(await $.ui.render(PANE))).toContain('l:src/app.ts:RIGHT:1')
  })

  test('the jump list focuses one file and collapses the rest', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    await $.ui.render(PANE)
    await $.ui.press({ plugin: 'diff-review', key: 'files' })
    await $.ui.render(PANE)
    await $.ui.press({ plugin: 'diff-review', key: 'f:src/app.ts' })
    const tree = JSON.stringify(await $.ui.render(PANE))
    expect(tree).toContain('l:src/app.ts:RIGHT:1')
    expect(tree).not.toContain('l:new.txt:RIGHT:1')
  })

  test('session start reopens the pane when the open marker for the toplevel carries this session id', async ($, on) => {
    const w = world(on, REMOTE_PR, { 'open:/work': { prNumber: 42, sessionId: SESSION_ID } })
    await $.session.start(SESSION)
    await w.clock.settle()
    expect(w.opened).toEqual(['diff-review'])
    const tree = JSON.stringify(await $.ui.render(PANE))
    expect(tree).toContain('PR #42')
  })

  test('a session-start reopen on a narrow terminal toasts why the pane waits', async ($, on) => {
    const reason = 'opened unasked below 144 columns (now 120)'
    const w = world(on, REMOTE_PR, { 'open:/work': { prNumber: 42, sessionId: SESSION_ID } }, { isPlaced: false, reason })
    await $.session.start(SESSION)
    await w.clock.settle()
    expect(w.opened).toEqual(['diff-review'])
    expect(w.toasts).toEqual([`review pane waits: ${reason}`])
  })

  test('a placed pane raises no toast', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    expect(w.toasts).toEqual([])
  })

  test('session start opens nothing and drops the marker when it belongs to another session', async ($, on) => {
    const w = world(on, REMOTE_PR, { 'open:/work': { prNumber: 42, sessionId: 'session-b' } })
    await $.session.start(SESSION)
    await w.clock.settle()
    expect(w.opened).toEqual([])
    expect(w.store.has('open:/work')).toBe(false)
  })

  test('session start opens nothing for a marker without a session id', async ($, on) => {
    const w = world(on, REMOTE_PR, { 'open:/work': { prNumber: 42 } })
    await $.session.start(SESSION)
    await w.clock.settle()
    expect(w.opened).toEqual([])
  })

  test('opening the pane writes the marker with this session id', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    expect(w.store.get('open:/work')).toEqual({ prNumber: null, prRepo: null, sessionId: SESSION_ID })
  })

  test('session start opens nothing and runs at most one git command when the store is empty', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()
    expect(w.opened).toEqual([])
    expect(w.runs.filter(r => r.argv.join(' ').includes('rev-parse --show-toplevel')).length).toBeLessThanOrEqual(1)
  })

  test('comment-down walks the comments in diff order and reports the position', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    await $.tool.call({ tool: 'mcp__diff-review__add_comment', path: 'src/app.ts', line: 2, body: 'first' } as never)
    await $.tool.call({ tool: 'mcp__diff-review__add_comment', path: 'new.txt', line: 1, body: 'second' } as never)
    await $.ui.render(PANE)
    await $.ui.press({ plugin: 'diff-review', key: 'comment-down' })
    expect(JSON.stringify(await $.ui.render(PANE))).toContain('comment 1 of 2')
    await $.ui.press({ plugin: 'diff-review', key: 'comment-down' })
    const tree = JSON.stringify(await $.ui.render(PANE))
    expect(tree).toContain('comment 2 of 2')
    expect(tree).toContain('›▾ A new.txt')
  })

  test('comment-down past the last comment wraps to the first and says so', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    await $.tool.call({ tool: 'mcp__diff-review__add_comment', path: 'src/app.ts', line: 2, body: 'first' } as never)
    await $.tool.call({ tool: 'mcp__diff-review__add_comment', path: 'new.txt', line: 1, body: 'second' } as never)
    await $.ui.render(PANE)
    await $.ui.press({ plugin: 'diff-review', key: 'comment-down' })
    await $.ui.press({ plugin: 'diff-review', key: 'comment-down' })
    await $.ui.press({ plugin: 'diff-review', key: 'comment-down' })
    expect(JSON.stringify(await $.ui.render(PANE))).toContain('comment 1 of 2 (wrapped)')
  })

  test('comment-up from no cursor wraps to the last comment', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    await $.tool.call({ tool: 'mcp__diff-review__add_comment', path: 'src/app.ts', line: 2, body: 'first' } as never)
    await $.tool.call({ tool: 'mcp__diff-review__add_comment', path: 'new.txt', line: 1, body: 'second' } as never)
    await $.ui.render(PANE)
    await $.ui.press({ plugin: 'diff-review', key: 'comment-up' })
    expect(JSON.stringify(await $.ui.render(PANE))).toContain('comment 2 of 2')
  })

  test('comment-down expands a collapsed file to reach its comment', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    await $.tool.call({ tool: 'mcp__diff-review__add_comment', path: 'src/app.ts', line: 2, body: 'first' } as never)
    await $.tool.call({ tool: 'mcp__diff-review__add_comment', path: 'new.txt', line: 1, body: 'second' } as never)
    await $.ui.render(PANE)
    await $.ui.press({ plugin: 'diff-review', key: 'files' })
    await $.ui.render(PANE)
    await $.ui.press({ plugin: 'diff-review', key: 'f:src/app.ts' })
    expect(JSON.stringify(await $.ui.render(PANE))).not.toContain('l:new.txt:RIGHT:1')
    await $.ui.press({ plugin: 'diff-review', key: 'comment-down' })
    await $.ui.press({ plugin: 'diff-review', key: 'comment-down' })
    expect(JSON.stringify(await $.ui.render(PANE))).toContain('l:new.txt:RIGHT:1')
  })

  test('comment navigation reports when there is nothing to walk', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    await $.ui.render(PANE)
    await $.ui.press({ plugin: 'diff-review', key: 'comment-down' })
    expect(JSON.stringify(await $.ui.render(PANE))).toContain('no open comments')
  })

  test('a wheel tick over a tall comment box moves the window every time instead of snapping back', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    const body = 'note '.repeat(60).trim()
    await $.tool.call({ tool: 'mcp__diff-review__add_comment', path: 'src/app.ts', line: 2, body } as never)
    await $.tool.call({ tool: 'mcp__diff-review__add_comment', path: 'src/app.ts', line: 3, body } as never)
    const positionOf = async (): Promise<{ before: number; total: number }> => {
      const found = /(\d+)-(\d+) of (\d+)/.exec(JSON.stringify(await $.ui.render(PANE)))
      if (!found) throw new Error('no scroll position in the pane footer')
      return { before: Number(found[1]) - 1, total: Number(found[3]) }
    }
    const seen = [(await positionOf()).before]
    for (let tick = 0; tick < 10; tick++) {
      await $.ui.scroll({ component: 'Pane', requestId: 'diff-review', offset: 0, by: 1, bodyRows: 25, contentRows: 52, origin: { kind: 'person' } })
      const now = await positionOf()
      expect(now.before, `tick ${tick} of ${seen.join(',')}`).toBeGreaterThan(seen[seen.length - 1]!)
      seen.push(now.before)
    }
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen[seen.length - 1]).toBeGreaterThan(10)
  })

  test('get_diff returns R/L numbered lines and /diff-review claude submits the review prompt', async ($, on) => {
    const w = world(on)
    const asked: string[] = []
    const ran: string[] = []
    on('prompt.submit', ($, e) => { asked.push(e.text); return { text: e.text } })
    on('command.run', { command: 'code-review' }, ($, e) => { ran.push(e.args ?? ''); return { text: 'reviewed' } })
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    const all = JSON.stringify(await $.tool.call({ tool: 'mcp__diff-review__get_diff' } as never))
    expect(all).toContain('=== modified src/app.ts')
    expect(all).toContain('R2 +const a = 2')
    expect(all).toContain('L2 -const a = 1')
    const one = JSON.stringify(await $.tool.call({ tool: 'mcp__diff-review__get_diff', path: 'new.txt' } as never))
    expect(one).toContain('=== added new.txt')
    expect(one).not.toContain('src/app.ts')
    const { text } = await $.command.run(review('claude'))
    expect(text).toContain('/code-review low')
    await w.clock.advance(100)
    expect(asked.length).toBe(1)
    expect(asked[0]).toContain('set_risk')
    expect(ran).toEqual([])

    await runTurn($, 'risk-turn')
    await w.clock.advance(100)
    expect(ran).toEqual(['low'])
    expect(asked.length).toBe(1)

    await runTurn($, 'skill-turn')
    await w.clock.advance(100)
    expect(asked.length).toBe(2)
    expect(asked[1]).toContain('add_comment')
    expect(asked[1]).toContain('get_diff')

    await runTurn($, 'follow-up-turn')
    await runTurn($, 'next-user-turn')
    await w.clock.advance(100)
    expect(asked.length).toBe(2)
    expect(ran).toEqual(['low'])
  })

  test('an aborted risk turn stops the claude review chain and says why', async ($, on) => {
    const w = world(on)
    const asked: string[] = []
    const ran: string[] = []
    on('prompt.submit', ($, e) => { asked.push(e.text); return { text: e.text } })
    on('command.run', { command: 'code-review' }, ($, e) => { ran.push(e.args ?? ''); return { text: 'reviewed' } })
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    await $.command.run(review('claude'))
    await w.clock.advance(100)
    await runTurn($, 'risk-turn', 'aborted')
    await w.clock.advance(100)
    expect(ran).toEqual([])
    expect(asked.length).toBe(1)
    expect(JSON.stringify(await $.ui.render(PANE))).toContain('claude review stopped: risk analysis ended (aborted)')
  })

  test('a subagent turn with the same id does not advance the chain', async ($, on) => {
    const w = world(on)
    const ran: string[] = []
    on('prompt.submit', ($, e) => ({ text: e.text }))
    on('command.run', { command: 'code-review' }, ($, e) => { ran.push(e.args ?? ''); return { text: 'reviewed' } })
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    await $.command.run(review('claude'))
    await w.clock.advance(100)
    await $.turn.start({ text: '', turnId: 'risk-turn' })
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'risk-turn', agentId: 'sub-1', reason: 'answer' })
    await w.clock.advance(100)
    expect(ran).toEqual([])
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'risk-turn', reason: 'answer' })
    await w.clock.advance(100)
    expect(ran).toEqual(['low'])
  })

  test('closing the pane drops a running claude review chain', async ($, on) => {
    const w = world(on)
    const ran: string[] = []
    on('prompt.submit', ($, e) => ({ text: e.text }))
    on('command.run', { command: 'code-review' }, ($, e) => { ran.push(e.args ?? ''); return { text: 'reviewed' } })
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    await $.command.run(review('claude'))
    await w.clock.advance(100)
    await $.command.run(review('close'))
    await runTurn($, 'risk-turn')
    await w.clock.advance(100)
    expect(ran).toEqual([])
  })

  test('set_risk shows the risk card, badges and sorts files, collapses low-risk ones, and survives a refresh', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    const r = await $.tool.call({ tool: 'mcp__diff-review__set_risk', level: 'high', summary: 'Touches auth token expiry.', dimensions: ['security', 'tests'], decisions: ['Accept the shorter token lifetime?'],
      files: [{ path: 'new.txt', level: 'high', reason: 'auth' }, { path: 'src/app.ts', level: 'low', reason: 'rename' }, { path: 'nope.ts', level: 'low' }] } as never)
    expect(JSON.stringify(r)).toContain('1 low-risk file(s) collapsed')
    expect(JSON.stringify(r)).toContain('nope.ts')
    const tree = JSON.stringify(await $.ui.render(PANE))
    expect(tree).toContain('risk high')
    expect(tree).toContain('needs judgment: security, tests')
    expect(tree).toContain('Accept the shorter token lifetime?')
    expect(tree).toContain('⚠ high')
    expect(tree).not.toContain('l:src/app.ts:RIGHT:2')
    await $.ui.press({ plugin: 'diff-review', key: 'files' })
    const listed = JSON.stringify(await $.ui.render(PANE))
    expect(listed.indexOf('f:new.txt')).toBeGreaterThan(0)
    expect(listed.indexOf('f:new.txt')).toBeLessThan(listed.indexOf('f:src/app.ts'))
    await $.ui.press({ plugin: 'diff-review', key: 'files' })
    await $.command.run(review('refresh'))
    await w.clock.settle()
    expect(JSON.stringify(await $.ui.render(PANE))).toContain('Touches auth token expiry.')
    await $.ui.press({ plugin: 'diff-review', key: 'risk-hide' })
    const hidden = JSON.stringify(await $.ui.render(PANE))
    expect(hidden).not.toContain('Touches auth token expiry.')
    expect(hidden).not.toContain('show risk')
  })

  test('deleting a claude draft teaches the next review prompt not to raise it again', async ($, on) => {
    const w = world(on)
    const asked: string[] = []
    on('prompt.submit', ($, e) => { asked.push(e.text); return { text: e.text } })
    on('command.run', { command: 'code-review' }, () => ({ text: 'reviewed' }))
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()

    const added = JSON.stringify(await $.tool.call({ tool: 'mcp__diff-review__add_comment', path: 'src/app.ts', line: 2, body: 'Consider a const here' } as never))
    const id = /Draft comment (\S+) added/.exec(added)?.[1]
    expect(id, added).toBeTruthy()
    await $.ui.render(PANE)
    await $.ui.press({ plugin: 'diff-review', key: `d:${id}` })
    await w.clock.settle()
    const list = await $.tool.call({ tool: 'mcp__diff-review__list_comments' } as never)
    expect(JSON.stringify(list)).toContain('No open comments')

    await $.command.run(review('claude'))
    await w.clock.advance(100)
    await runTurn($, 'risk-turn')
    await w.clock.advance(100)
    await runTurn($, 'skill-turn')
    await w.clock.advance(100)
    expect(asked.length).toBe(2)
    expect(asked[0]).toContain('Reviewer preferences for this repository')
    expect(asked[0]).toContain('src/app.ts: Consider a const here')
    expect(asked[1]).toContain('Consider a const here')
  })

  test('note and memory verbs round-trip and reach the risk prompt', async ($, on) => {
    const w = world(on)
    const asked: string[] = []
    on('prompt.submit', ($, e) => { asked.push(e.text); return { text: e.text } })
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()

    expect((await $.command.run(review('memory'))).text).toContain('no feedback memory yet for this repository')
    expect((await $.command.run(review('note'))).text).toContain('usage')
    expect((await $.command.run(review('note Skip comments about formatting'))).text).toBe('review: noted (1 notes)')
    expect((await $.command.run(review('note Name the file in every finding'))).text).toBe('review: noted (2 notes)')

    const shown = (await $.command.run(review('memory'))).text
    expect(shown).toContain('Skip comments about formatting')
    expect(shown).toContain('Name the file in every finding')

    await $.command.run(review('risk'))
    await w.clock.advance(100)
    expect(asked.length).toBe(1)
    expect(asked[0]).toContain('Reviewer preferences for this repository')
    expect(asked[0]).toContain('Skip comments about formatting')

    expect((await $.command.run(review('memory clear'))).text).toBe('review: feedback memory cleared')
    expect((await $.command.run(review('memory'))).text).toContain('no feedback memory yet for this repository')
  })

  test('/diff-review risk submits only the risk prompt', async ($, on) => {
    const w = world(on)
    const asked: string[] = []
    const ran: string[] = []
    on('prompt.submit', ($, e) => { asked.push(e.text); return { text: e.text } })
    on('command.run', { command: 'code-review' }, ($, e) => { ran.push(e.args ?? ''); return { text: 'reviewed' } })
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    const { text } = await $.command.run(review('risk'))
    expect(text).toContain('risk analysis')
    await w.clock.advance(100)
    expect(asked.length).toBe(1)
    expect(asked[0]).toContain('set_risk')
    expect(ran).toEqual([])
  })
})
