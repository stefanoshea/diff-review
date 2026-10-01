import { describe, expect, test, tier } from 'claude-code/testing'
import { prNumberOf, prRefOf, resolvePrTarget, resolveTarget } from '../hooks/git/target.ts'
import { ELSEWHERE_PR, IN_PR, NO_PR, REMOTE_PR, gitScript } from './fixtures/git-script.ts'

tier('user')

describe('target', () => {
  test('with a PR: base from gh, merge base, head, send allowed', async () => {
    const { run } = gitScript(IN_PR)
    const t = await resolveTarget(run)
    expect(t).toEqual({
      mode: 'branch', toplevel: '/work', repoKey: '/work', branch: 'feature', base: 'main', mergeBase: 'abc123', headSha: 'head999', headRef: 'HEAD',
      diffSource: { kind: 'git' },
      pr: { number: 42, url: 'https://github.com/acme/app/pull/42', headRef: 'feature', nameWithOwner: 'acme/app' },
      sendBlocked: null,
    })
  })

  test('without a PR: base from origin/HEAD, send blocked with the reason', async () => {
    const { run } = gitScript(NO_PR)
    const t = await resolveTarget(run)
    expect(t).toEqual(expect.objectContaining({ base: 'main', pr: null, sendBlocked: 'no pull request for this branch' }))
  })

  test('head not pushed blocks send', async () => {
    const { run } = gitScript({ ...IN_PR, 'rev-parse origin/feature': 'other000\n' })
    const t = await resolveTarget(run)
    expect(t).toEqual(expect.objectContaining({ sendBlocked: 'push first: HEAD is not on origin/feature' }))
  })

  test('a base override wins over gh', async () => {
    const { run, runs } = gitScript({ 'merge-base origin/release HEAD': 'rel111\n', ...IN_PR })
    const t = await resolveTarget(run, 'release')
    expect(t).toEqual(expect.objectContaining({ base: 'release', mergeBase: 'rel111' }))
    expect(runs.some(r => r.argv.join(' ').includes('merge-base origin/release HEAD'))).toBe(true)
  })

  test('outside a repository: an error', async () => {
    const { run } = gitScript({})
    expect(await resolveTarget(run)).toEqual({ error: 'not a git repository' })
  })

  test('prNumberOf parses numbers, hash-prefixed numbers, and PR urls', () => {
    expect(prNumberOf('42')).toBe(42)
    expect(prNumberOf('#42')).toBe(42)
    expect(prNumberOf('https://github.com/acme/app/pull/42')).toBe(42)
    expect(prNumberOf('https://github.com/acme/app/pull/42/files')).toBe(42)
    expect(prNumberOf('abc')).toBeNull()
    expect(prNumberOf('acme/app#42')).toBe(42)
    expect(prNumberOf('acme/app/pull/42')).toBe(42)
  })

  test('prRefOf keeps the repository a url or owner/repo#number names', () => {
    expect(prRefOf('42')).toEqual({ number: 42, nameWithOwner: '' })
    expect(prRefOf('https://github.com/other/lib/pull/457')).toEqual({ number: 457, nameWithOwner: 'other/lib' })
    expect(prRefOf('https://github.com/other/lib/pull/457/files')).toEqual({ number: 457, nameWithOwner: 'other/lib' })
    expect(prRefOf('other/lib#457')).toEqual({ number: 457, nameWithOwner: 'other/lib' })
    expect(prRefOf('abc')).toBeNull()
  })

  test('resolvePrTarget: happy path resolves the full Target and fetches the PR head and base', async () => {
    const { run, runs } = gitScript(REMOTE_PR)
    const t = await resolvePrTarget(run, 42)
    expect(t).toEqual({
      mode: 'pr', toplevel: '/work', repoKey: '/work', branch: 'feature', base: 'main', mergeBase: 'mb4242', headSha: 'deadbeefcafe0000',
      headRef: 'refs/remotes/diff-review/pr-42',
      diffSource: { kind: 'git' },
      pr: { number: 42, url: 'https://github.com/acme/app/pull/42', headRef: 'feature', nameWithOwner: 'acme/app' },
      sendBlocked: null,
    })
    expect(runs.some(r => r.argv.join(' ') === 'git --no-optional-locks fetch --quiet origin +pull/42/head:refs/remotes/diff-review/pr-42')).toBe(true)
    expect(runs.some(r => r.argv.join(' ') === 'git --no-optional-locks fetch --quiet origin main')).toBe(true)
  })

  test('resolvePrTarget: a PR in another repository asks gh for that repository and reads the diff from the API', async () => {
    const { run, runs } = gitScript(ELSEWHERE_PR)
    const t = await resolvePrTarget(run, 457, 'other/lib')
    expect(t).toEqual({
      mode: 'pr', toplevel: '/work', repoKey: 'other/lib', branch: 'feature', base: 'staging', mergeBase: '', headSha: 'cafe0000',
      headRef: '',
      diffSource: { kind: 'github', nameWithOwner: 'other/lib', number: 457 },
      pr: { number: 457, url: 'https://github.com/other/lib/pull/457', headRef: 'feature', nameWithOwner: 'other/lib' },
      sendBlocked: null,
    })
    expect(runs[1]?.argv).toEqual(['gh', 'pr', 'view', '457', '--repo', 'other/lib', '--json', 'number,url,baseRefName,headRefName,headRefOid'])
    expect(runs.some(r => r.argv.includes('fetch'))).toBe(false)
  })

  test('resolvePrTarget: a base branch missing from the clone no longer fails the wrong repository', async () => {
    const { run } = gitScript({ ...ELSEWHERE_PR, 'fetch --quiet': { exitCode: 128, stdout: '', stderr: "fatal: couldn't find remote ref staging" } })
    expect(await resolvePrTarget(run, 457, 'other/lib')).toEqual(expect.objectContaining({ mode: 'pr', base: 'staging' }))
  })

  test('resolvePrTarget: gh pr view failure', async () => {
    const { run } = gitScript({ ...REMOTE_PR, 'pr view 42 --json': { exitCode: 1, stdout: '', stderr: 'no pull request found\nmore detail' } })
    expect(await resolvePrTarget(run, 42)).toEqual({ error: 'gh pr view failed: no pull request found' })
  })

  test('resolvePrTarget: fetch failure', async () => {
    const { run } = gitScript({ ...REMOTE_PR, 'fetch --quiet origin +pull/42/head:refs/remotes/diff-review/pr-42': { exitCode: 1, stdout: '', stderr: 'could not fetch\nmore detail' } })
    expect(await resolvePrTarget(run, 42)).toEqual({ error: 'fetch failed: could not fetch' })
  })

  test('resolvePrTarget: fork clone fetches from the remote that matches the PR repository', async () => {
    const FORK: Record<string, string> = {
      ...REMOTE_PR,
      'remote -v': 'origin\tgit@github.com:me/app.git (fetch)\norigin\tgit@github.com:me/app.git (push)\nupstream\thttps://github.com/acme/app.git (fetch)\nupstream\thttps://github.com/acme/app.git (push)\n',
      'fetch --quiet upstream +pull/42/head:refs/remotes/diff-review/pr-42': '',
      'fetch --quiet upstream main': '',
      'merge-base upstream/main refs/remotes/diff-review/pr-42': 'mb4242\n',
    }
    const { run, runs } = gitScript(FORK)
    const t = await resolvePrTarget(run, 42)
    expect(t).toEqual(expect.objectContaining({ mergeBase: 'mb4242', pr: expect.objectContaining({ nameWithOwner: 'acme/app' }) }))
    expect(runs.some(r => r.argv.join(' ') === 'git --no-optional-locks fetch --quiet upstream +pull/42/head:refs/remotes/diff-review/pr-42')).toBe(true)
    expect(runs.some(r => r.argv.includes('repo'))).toBe(false)
  })

  test('resolvePrTarget: gh multiple-remotes error carries the set-default hint', async () => {
    const { run } = gitScript({ ...REMOTE_PR, 'pr view 42 --json': { exitCode: 1, stdout: '', stderr: 'multiple remotes detected. please specify which repo to use by providing the -R, --repo argument' } })
    expect(await resolvePrTarget(run, 42)).toEqual({ error: expect.stringContaining('(run: gh repo set-default)') })
  })
})
