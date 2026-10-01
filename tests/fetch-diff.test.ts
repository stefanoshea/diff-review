import { describe, expect, test, tier } from 'claude-code/testing'
import { MAX_FILE_DIFF_BYTES, fetchDiff } from '../hooks/git/fetch-diff.ts'
import type { Target } from '../hooks/git/target.ts'
import { ALL, MODIFIED } from './fixtures/diffs.ts'
import { IN_PR, REMOTE_PR, gitScript } from './fixtures/git-script.ts'

tier('user')

const TARGET: Target = { mode: 'branch', toplevel: '/work', repoKey: '/work', branch: 'feature', base: 'main', mergeBase: 'abc123', headSha: 'head999', headRef: 'HEAD', diffSource: { kind: 'git' }, pr: null, sendBlocked: 'x' }
const PR_TARGET: Target = {
  mode: 'pr', toplevel: '/work', repoKey: '/work', branch: 'feature', base: 'main', mergeBase: 'mb4242', headSha: 'deadbeefcafe0000', headRef: 'refs/remotes/diff-review/pr-42',
  diffSource: { kind: 'git' },
  pr: { number: 42, url: 'https://github.com/acme/app/pull/42', headRef: 'feature', nameWithOwner: 'acme/app' }, sendBlocked: null,
}
const ELSEWHERE_TARGET: Target = {
  mode: 'pr', toplevel: '/work', repoKey: 'other/lib', branch: 'feature', base: 'main', mergeBase: '', headSha: 'cafe0000', headRef: '',
  diffSource: { kind: 'github', nameWithOwner: 'other/lib', number: 457 },
  pr: { number: 457, url: 'https://github.com/other/lib/pull/457', headRef: 'feature', nameWithOwner: 'other/lib' }, sendBlocked: null,
}

describe('fetch-diff', () => {
  test('runs git diff from the merge base and parses every file', async () => {
    const { run, runs } = gitScript(IN_PR)
    const { files } = await fetchDiff(run, TARGET)
    expect(files.map(f => f.path)).toEqual(['src/app.ts', 'new.txt', 'old.txt', 'b.ts', 'img.png', 'n.txt'])
    expect(runs[0]?.argv).toEqual(['git', '--no-optional-locks', 'diff', '--no-color', '-U3', '--find-renames', 'abc123'])
  })

  test('a huge file is listed as large with no hunks', async () => {
    const big = MODIFIED.replace('@@ -1,4 +1,5 @@\n', '@@ -1,4 +1,5 @@\n' + ' x'.repeat(MAX_FILE_DIFF_BYTES) + '\n')
    const { run } = gitScript({ ...IN_PR, 'diff --no-color': big + ALL })
    const { files } = await fetchDiff(run, TARGET)
    expect(files[0]).toEqual(expect.objectContaining({ path: 'src/app.ts', isLarge: true, hunks: [] }))
    expect(files.length).toBe(7)
  })

  test('output cut at 4 MiB marks the last file large and reports the cut', async () => {
    const { run } = gitScript({ ...IN_PR, 'diff --no-color': { exitCode: 0, stdout: ALL, stderr: '', isStdoutTruncated: true } })
    const r = await fetchDiff(run, TARGET)
    expect(r.isTruncated).toBe(true)
    expect(r.error).toBe(null)
    expect(r.files.at(-1)).toEqual(expect.objectContaining({ path: 'n.txt', isLarge: true, hunks: [] }))
    expect(r.files[0]?.hunks.length).toBe(2)
  })

  test('a failed git diff returns no files and the first stderr line', async () => {
    const { run } = gitScript({ ...IN_PR, 'diff --no-color': { exitCode: 128, stdout: '', stderr: 'fatal: bad revision abc123\nmore' } })
    expect(await fetchDiff(run, TARGET)).toEqual({ files: [], error: 'fatal: bad revision abc123', isTruncated: false })
  })

  test('pr mode diffs the merge base against the PR head sha, not the working tree', async () => {
    const { run, runs } = gitScript(REMOTE_PR)
    await fetchDiff(run, PR_TARGET)
    expect(runs[0]?.argv).toEqual(['git', '--no-optional-locks', 'diff', '--no-color', '-U3', '--find-renames', 'mb4242', 'deadbeefcafe0000'])
  })

  test('a PR in another repository reads the diff from the GitHub API, not from git', async () => {
    const { run, runs } = gitScript({ 'api repos/other/lib/pulls/457': ALL })
    const { files } = await fetchDiff(run, ELSEWHERE_TARGET)
    expect(files.map(f => f.path)).toEqual(['src/app.ts', 'new.txt', 'old.txt', 'b.ts', 'img.png', 'n.txt'])
    expect(runs[0]?.argv).toEqual(['gh', 'api', 'repos/other/lib/pulls/457', '-H', 'Accept: application/vnd.github.v3.diff'])
  })

  test('branch mode still ends with the merge base only', async () => {
    const { run, runs } = gitScript(IN_PR)
    await fetchDiff(run, TARGET)
    expect(runs[0]?.argv).toEqual(['git', '--no-optional-locks', 'diff', '--no-color', '-U3', '--find-renames', 'abc123'])
  })
})
