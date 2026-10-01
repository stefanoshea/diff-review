import type { ProcessRunResult } from 'claude-code'
import { runnerOf } from '../../hooks/git/run.ts'
import type { Runner } from '../../hooks/git/run.ts'
import { ALL } from './diffs.ts'

export type ScriptResult = Pick<ProcessRunResult, 'exitCode' | 'stdout' | 'stderr'> & Partial<Pick<ProcessRunResult, 'isStdoutTruncated'>>
export type Script = Readonly<Record<string, string | ScriptResult>>

export const PR_JSON = JSON.stringify({ number: 42, baseRefName: 'main', headRefName: 'feature', url: 'https://github.com/acme/app/pull/42' })

export const IN_PR: Script = {
  'rev-parse --show-toplevel': '/work\n',
  'rev-parse --abbrev-ref HEAD': 'feature\n',
  'pr view --json': PR_JSON,
  'repo view --json': JSON.stringify({ nameWithOwner: 'acme/app' }),
  'merge-base origin/main HEAD': 'abc123\n',
  'rev-parse HEAD': 'head999\n',
  'rev-parse origin/feature': 'head999\n',
  'diff --no-color': ALL,
  'diff --name-only HEAD': '',
}

export const NO_PR: Script = {
  ...IN_PR,
  'pr view --json': { exitCode: 1, stdout: '', stderr: 'no pull requests found for branch "feature"' },
  'symbolic-ref --quiet refs/remotes/origin/HEAD': 'refs/remotes/origin/main\n',
}

export const NOT_A_REPO: ScriptResult = { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' }

export const PR_VIEW_42 = JSON.stringify({ number: 42, url: 'https://github.com/acme/app/pull/42', baseRefName: 'main', headRefName: 'feature', headRefOid: 'deadbeefcafe0000' })

export const REMOTE_PR: Script = {
  'rev-parse --show-toplevel': '/work\n',
  'pr view 42 --json': PR_VIEW_42,
  'repo view --json': JSON.stringify({ nameWithOwner: 'acme/app' }),
  'fetch --quiet origin +pull/42/head:refs/remotes/diff-review/pr-42': '',
  'fetch --quiet origin main': '',
  'merge-base origin/main refs/remotes/diff-review/pr-42': 'mb4242\n',
  'diff --no-color -U3 --find-renames mb4242 deadbeefcafe0000': ALL,
}

export const PR_VIEW_457 = JSON.stringify({ number: 457, url: 'https://github.com/other/lib/pull/457', baseRefName: 'staging', headRefName: 'feature', headRefOid: 'cafe0000' })

export const ELSEWHERE_PR: Script = {
  'rev-parse --show-toplevel': '/work\n',
  'pr view 457 --repo other/lib --json': PR_VIEW_457,
  'remote -v': 'origin\tgit@github.com:acme/app.git (fetch)\norigin\tgit@github.com:acme/app.git (push)\n',
  'api repos/other/lib/pulls/457': ALL,
}

export function answerOf(argv: readonly string[], script: Script): ProcessRunResult {
  const line = argv.join(' ')
  const hit = Object.entries(script).find(([key]) => line.includes(key))
  const v = hit ? hit[1] : NOT_A_REPO
  const r = typeof v === 'string' ? { exitCode: 0, stdout: v, stderr: '' } : v
  return { isStdoutTruncated: false, isStderrTruncated: false, ...r }
}

export function gitScript(script: Script): { run: Runner; runs: { argv: readonly string[]; stdin?: string; cwd?: string }[] } {
  const runs: { argv: readonly string[]; stdin?: string; cwd?: string }[] = []
  const run = runnerOf(async (argv, init) => {
    runs.push({ argv, stdin: init?.stdin, cwd: init?.cwd })
    return answerOf(argv, script)
  })
  return { run, runs }
}
