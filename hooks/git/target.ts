import type { Runner } from './run.ts'

export type DiffSource = { kind: 'git' } | { kind: 'github'; nameWithOwner: string; number: number }

export type Target = {
  mode: 'branch' | 'pr'
  toplevel: string
  repoKey: string
  branch: string
  base: string
  mergeBase: string
  headSha: string
  headRef: string
  diffSource: DiffSource
  pr: { number: number; url: string; headRef: string; nameWithOwner: string } | null
  sendBlocked: string | null
}
export type TargetFailure = { error: string }

const GIT = ['git', '--no-optional-locks']

type PrView = { number: number; baseRefName: string; headRefName: string; url: string }
type PrViewFull = { number: number; url: string; baseRefName: string; headRefName: string; headRefOid: string }

async function defaultBase(run: Runner): Promise<string> {
  const sym = await run([...GIT, 'symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])
  if (sym.ok) return sym.stdout.trim().replace(/^refs\/remotes\/origin\//, '')
  for (const candidate of ['main', 'master']) {
    const r = await run([...GIT, 'rev-parse', '--verify', '--quiet', `origin/${candidate}`])
    if (r.ok) return candidate
  }
  return 'main'
}

export async function resolveTarget(run: Runner, baseOverride: string | null = null): Promise<Target | TargetFailure> {
  const top = await run([...GIT, 'rev-parse', '--show-toplevel'])
  if (!top.ok) return { error: 'not a git repository' }
  const br = await run([...GIT, 'rev-parse', '--abbrev-ref', 'HEAD'])
  if (!br.ok || br.stdout.trim() === 'HEAD') return { error: 'detached HEAD: check out a branch' }
  const branch = br.stdout.trim()

  let pr: Target['pr'] = null
  let prBase: string | null = null
  let sendBlocked: string | null = null
  const prView = await run(['gh', 'pr', 'view', '--json', 'number,baseRefName,headRefName,url'])
  if (prView.ok) {
    try {
      const j = JSON.parse(prView.stdout) as PrView
      const repo = await run(['gh', 'repo', 'view', '--json', 'nameWithOwner'])
      const nameWithOwner = repo.ok ? (JSON.parse(repo.stdout) as { nameWithOwner: string }).nameWithOwner : ''
      pr = { number: j.number, url: j.url, headRef: j.headRefName, nameWithOwner }
      prBase = j.baseRefName
      if (!nameWithOwner) sendBlocked = 'gh repo view failed'
    } catch {
      sendBlocked = 'gh returned unreadable JSON'
    }
  } else {
    sendBlocked = /not found|no pull requests/i.test(prView.stderr) ? 'no pull request for this branch' : 'gh not available'
  }

  const base = baseOverride ?? prBase ?? (await defaultBase(run))
  let mb = await run([...GIT, 'merge-base', `origin/${base}`, 'HEAD'])
  if (!mb.ok) mb = await run([...GIT, 'merge-base', base, 'HEAD'])
  if (!mb.ok) return { error: `cannot find merge base with ${base}` }
  const head = await run([...GIT, 'rev-parse', 'HEAD'])
  const headSha = head.stdout.trim()
  const toplevel = top.stdout.trim()

  if (pr && !sendBlocked) {
    const remoteHead = await run([...GIT, 'rev-parse', `origin/${pr.headRef}`])
    if (!remoteHead.ok || remoteHead.stdout.trim() !== headSha) sendBlocked = `push first: HEAD is not on origin/${pr.headRef}`
  }

  return { mode: 'branch', toplevel, repoKey: toplevel, branch, base, mergeBase: mb.stdout.trim(), headSha, headRef: 'HEAD', diffSource: { kind: 'git' }, pr, sendBlocked }
}

export type PrRef = { number: number; nameWithOwner: string }

export function prNumberOf(arg: string): number | null {
  const trimmed = arg.trim()
  const hash = /^(?:[^/\s]+\/[^/\s]+)?#(\d+)$/.exec(trimmed)
  if (hash) return Number(hash[1])
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const url = /\/pull\/(\d+)(?:\/|$)/.exec(trimmed)
  if (url) return Number(url[1])
  return null
}

export function nameWithOwnerOf(arg: string): string {
  const trimmed = arg.trim()
  const hash = /^([^/\s]+\/[^/\s]+)#\d+$/.exec(trimmed)
  if (hash) return hash[1]!
  const url = /(?:^|github\.com[:/])([^/\s]+\/[^/\s]+)\/pull\/\d+/.exec(trimmed)
  return url?.[1] ?? ''
}

export function prRefOf(arg: string): PrRef | null {
  const number = prNumberOf(arg)
  if (number === null) return null
  return { number, nameWithOwner: nameWithOwnerOf(arg) }
}

export async function remoteOf(run: Runner, nameWithOwner: string): Promise<string> {
  if (!nameWithOwner) return 'origin'
  const remotes = await run([...GIT, 'remote', '-v'])
  if (!remotes.ok) return 'origin'
  const want = nameWithOwner.toLowerCase()
  const names: string[] = []
  for (const line of remotes.stdout.split('\n')) {
    const m = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line.trim())
    if (!m) continue
    const repo = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(m[2]!)?.[1]?.toLowerCase()
    if (repo === want) names.push(m[1]!)
  }
  if (names.includes('origin')) return 'origin'
  return names[0] ?? ''
}

export async function resolvePrTarget(run: Runner, prNumber: number, repoOverride: string | null = null): Promise<Target | TargetFailure> {
  const top = await run([...GIT, 'rev-parse', '--show-toplevel'])
  if (!top.ok) return { error: 'not a git repository' }
  const toplevel = top.stdout.trim()

  const repoArgs = repoOverride ? ['--repo', repoOverride] : []
  const prView = await run(['gh', 'pr', 'view', String(prNumber), ...repoArgs, '--json', 'number,url,baseRefName,headRefName,headRefOid'])
  if (!prView.ok) {
    const first = prView.stderr.split('\n')[0] || 'unknown error'
    const hint = !repoOverride && /multiple remotes|set-default/i.test(prView.stderr) ? ' (run: gh repo set-default)' : ''
    return { error: `gh pr view failed: ${first}${hint}` }
  }
  let j: PrViewFull
  try {
    j = JSON.parse(prView.stdout) as PrViewFull
  } catch {
    return { error: 'gh pr view failed: unreadable JSON' }
  }

  let sendBlocked: string | null = null
  let nameWithOwner = nameWithOwnerOf(j.url) || repoOverride || ''
  if (!nameWithOwner) {
    const repo = await run(['gh', 'repo', 'view', '--json', 'nameWithOwner'])
    try {
      nameWithOwner = repo.ok ? (JSON.parse(repo.stdout) as { nameWithOwner: string }).nameWithOwner : ''
    } catch {
      nameWithOwner = ''
    }
    if (!nameWithOwner) sendBlocked = 'gh repo view failed'
  }

  const pr = { number: j.number, url: j.url, headRef: j.headRefName, nameWithOwner }
  const remote = await remoteOf(run, nameWithOwner)
  if (!remote) {
    return {
      mode: 'pr',
      toplevel,
      repoKey: nameWithOwner,
      branch: j.headRefName,
      base: j.baseRefName,
      mergeBase: '',
      headSha: j.headRefOid,
      headRef: '',
      diffSource: { kind: 'github', nameWithOwner, number: j.number },
      pr,
      sendBlocked,
    }
  }

  const headRef = `refs/remotes/diff-review/pr-${prNumber}`
  const fetchHead = await run([...GIT, 'fetch', '--quiet', remote, `+pull/${prNumber}/head:${headRef}`])
  if (!fetchHead.ok) return { error: `fetch failed: ${fetchHead.stderr.split('\n')[0] || 'unknown error'}` }
  const fetchBase = await run([...GIT, 'fetch', '--quiet', remote, j.baseRefName])
  if (!fetchBase.ok) return { error: `fetch failed: ${fetchBase.stderr.split('\n')[0] || 'unknown error'}` }

  const mb = await run([...GIT, 'merge-base', `${remote}/${j.baseRefName}`, headRef])
  if (!mb.ok) return { error: `cannot find merge base with ${j.baseRefName}` }

  return {
    mode: 'pr',
    toplevel,
    repoKey: toplevel,
    branch: j.headRefName,
    base: j.baseRefName,
    mergeBase: mb.stdout.trim(),
    headSha: j.headRefOid,
    headRef,
    diffSource: { kind: 'git' },
    pr,
    sendBlocked,
  }
}
