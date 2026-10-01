import type { Runner } from '../git/run.ts'
import type { Target } from '../git/target.ts'
import type { Payload } from './payload.ts'

export type ExportResult = { ok: true; url: string } | { ok: false; error: string }

export async function createPendingReview(run: Runner, target: Target, payload: Payload): Promise<ExportResult> {
  if (!target.pr) return { ok: false, error: 'no pull request for this branch' }
  const body = JSON.stringify({ commit_id: payload.commit_id, comments: payload.comments })
  const endpoint = `repos/${target.pr.nameWithOwner}/pulls/${target.pr.number}/reviews`
  const r = await run(['gh', 'api', '-X', 'POST', endpoint, '--input', '-'], { stdin: body, timeoutMs: 60000 })
  if (!r.ok) return { ok: false, error: r.stderr.split('\n')[0] || 'gh api failed' }
  try {
    const j = JSON.parse(r.stdout) as { html_url?: string }
    return { ok: true, url: j.html_url ?? target.pr.url }
  } catch {
    return { ok: true, url: target.pr.url }
  }
}
