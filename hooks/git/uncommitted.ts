import type { Runner } from './run.ts'

export type Uncommitted = { paths: string[]; error: string | null }

export async function uncommittedOf(run: Runner, toplevel: string, paths: readonly string[]): Promise<Uncommitted> {
  if (paths.length === 0) return { paths: [], error: null }
  const r = await run(['git', '--no-optional-locks', 'diff', '--name-only', 'HEAD', '--', ...paths], { cwd: toplevel })
  if (!r.ok) return { paths: [], error: r.stderr.split('\n')[0] || `exit code ${r.exitCode}` }
  return { paths: r.stdout.split('\n').map(p => p.trim()).filter(Boolean), error: null }
}
