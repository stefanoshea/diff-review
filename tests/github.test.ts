import { describe, expect, test, tier } from 'claude-code/testing'
import { createPendingReview } from '../hooks/send/github.ts'
import type { Target } from '../hooks/git/target.ts'
import { gitScript } from './fixtures/git-script.ts'

tier('user')

const TARGET: Target = {
  mode: 'branch', toplevel: '/work', repoKey: '/work', branch: 'feature', base: 'main', mergeBase: 'abc', headSha: 'head999', headRef: 'HEAD', diffSource: { kind: 'git' }, sendBlocked: null,
  pr: { number: 42, url: 'https://github.com/acme/app/pull/42', headRef: 'feature', nameWithOwner: 'acme/app' },
}
const PAYLOAD = { commit_id: 'head999', comments: [{ path: 'a', side: 'RIGHT' as const, line: 1, body: 'x' }], ids: ['i'] }

describe('github', () => {
  test('posts the review JSON on stdin to the pulls reviews endpoint', async () => {
    const { run, runs } = gitScript({ 'api -X POST': JSON.stringify({ id: 7, html_url: 'https://github.com/acme/app/pull/42#pullrequestreview-7' }) })
    const r = await createPendingReview(run, TARGET, PAYLOAD)
    expect(r).toEqual({ ok: true, url: 'https://github.com/acme/app/pull/42#pullrequestreview-7' })
    expect(runs[0]?.argv).toEqual(['gh', 'api', '-X', 'POST', 'repos/acme/app/pulls/42/reviews', '--input', '-'])
    expect(JSON.parse(runs[0]?.stdin ?? '{}')).toEqual({ commit_id: 'head999', comments: PAYLOAD.comments })
  })

  test('a failed call reports the first stderr line', async () => {
    const { run } = gitScript({ 'api -X POST': { exitCode: 1, stdout: '', stderr: 'gh: Validation Failed (HTTP 422)\nmore' } })
    expect(await createPendingReview(run, TARGET, PAYLOAD)).toEqual({ ok: false, error: 'gh: Validation Failed (HTTP 422)' })
  })

  test('no PR refuses before running anything', async () => {
    const { run, runs } = gitScript({})
    expect(await createPendingReview(run, { ...TARGET, pr: null }, PAYLOAD)).toEqual({ ok: false, error: 'no pull request for this branch' })
    expect(runs).toEqual([])
  })
})
