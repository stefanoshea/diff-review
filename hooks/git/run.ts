export type Run = { ok: boolean; stdout: string; stderr: string; exitCode: number; isStdoutTruncated: boolean }
export type RunInit = { stdin?: string; timeoutMs?: number; cwd?: string }
export type Runner = (argv: readonly string[], init?: RunInit) => Promise<Run>

export type ProcessRun = (argv: readonly string[], init?: RunInit) => Promise<{ exitCode: number; stdout: string; stderr: string; isStdoutTruncated?: boolean }>

export function runnerOf(run: ProcessRun): Runner {
  return async (argv, init) => {
    try {
      const r = await run(argv, init)
      return { ok: r.exitCode === 0, stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, isStdoutTruncated: r.isStdoutTruncated ?? false }
    } catch (error) {
      return { ok: false, stdout: '', stderr: String(error), exitCode: 1, isStdoutTruncated: false }
    }
  }
}
