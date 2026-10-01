import type { DiffLine, FileDiff, Hunk, Side } from './types.ts'

export function addressOf(line: DiffLine): { side: Side; line: number } {
  if (line.kind === 'del') return { side: 'LEFT', line: line.oldLine ?? 0 }
  return { side: 'RIGHT', line: line.newLine ?? 0 }
}

export function fileOf(files: readonly FileDiff[], path: string): FileDiff | undefined {
  return files.find(f => f.path === path || f.oldPath === path)
}

export function hasAddress(files: readonly FileDiff[], path: string, side: Side, line: number): boolean {
  const file = fileOf(files, path)
  if (!file) return false
  return file.hunks.some(h => hunkHas(h, side, line))
}

const hunkHas = (hunk: Hunk, side: Side, line: number): boolean =>
  hunk.lines.some(l => (side === 'LEFT' ? l.oldLine === line : l.newLine === line))

export function inOneHunk(files: readonly FileDiff[], path: string, side: Side, from: number, to: number): boolean {
  const file = fileOf(files, path)
  if (!file) return false
  return file.hunks.some(h => hunkHas(h, side, from) && hunkHas(h, side, to))
}

export function nearestLines(files: readonly FileDiff[], path: string, side: Side, limit = 8): number[] {
  const file = fileOf(files, path)
  if (!file) return []
  const numbers = file.hunks
    .flatMap(h => h.lines.map(l => (side === 'LEFT' ? l.oldLine : l.newLine)))
    .filter((n): n is number => n !== null)
  return numbers.slice(0, limit)
}
