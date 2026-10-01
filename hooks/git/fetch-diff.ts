import { parseUnifiedDiff } from '../diff/parse.ts'
import type { FileDiff } from '../diff/types.ts'
import type { Runner } from './run.ts'
import type { Target } from './target.ts'

export const MAX_FILE_DIFF_BYTES = 204800

const argvOf = (target: Target): string[] => {
  if (target.diffSource.kind === 'github') {
    const { nameWithOwner, number } = target.diffSource
    return ['gh', 'api', `repos/${nameWithOwner}/pulls/${number}`, '-H', 'Accept: application/vnd.github.v3.diff']
  }
  const base = ['git', '--no-optional-locks', 'diff', '--no-color', '-U3', '--find-renames', target.mergeBase]
  return target.mode === 'pr' ? [...base, target.headSha] : base
}

export type DiffFetch = { files: FileDiff[]; error: string | null; isTruncated: boolean }

export async function fetchDiff(run: Runner, target: Target): Promise<DiffFetch> {
  const r = await run(argvOf(target), { timeoutMs: 60000 })
  if (!r.ok) return { files: [], error: r.stderr.split('\n')[0] || `exit code ${r.exitCode}`, isTruncated: false }
  const sections = r.stdout.split(/^(?=diff --git )/m).filter(s => s.length > 0)
  const kept = sections.map(s => (s.length > MAX_FILE_DIFF_BYTES ? s.split('\n').slice(0, 4).join('\n') + '\n' : s))
  const files = parseUnifiedDiff(kept.join(''))
  sections.forEach((s, i) => {
    const f = files[i]
    if (f && s.length > MAX_FILE_DIFF_BYTES) { f.isLarge = true; f.hunks = [] }
  })
  const last = files.at(-1)
  if (r.isStdoutTruncated && last) { last.isLarge = true; last.hunks = [] }
  return { files, error: null, isTruncated: r.isStdoutTruncated }
}
