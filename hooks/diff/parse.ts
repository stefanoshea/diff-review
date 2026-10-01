import type { DiffLine, FileDiff, Hunk } from './types.ts'

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

const stripPrefix = (s: string) => s.replace(/^[ab]\//, '')

function newFile(): FileDiff {
  return { path: '', oldPath: null, status: 'modified', isBinary: false, isLarge: false, hunks: [] }
}

function headerNamesOf(rest: string): [string, string] {
  const half = (rest.length - 1) / 2
  if (Number.isInteger(half) && rest[half] === ' ') {
    const left = rest.slice(0, half)
    const right = rest.slice(half + 1)
    if (left.startsWith('a/') && right.startsWith('b/') && left.slice(2) === right.slice(2)) return [left.slice(2), right.slice(2)]
  }
  const m = /^a\/(.+?) b\/(.+)$/.exec(rest)
  return [m?.[1] ?? '', m?.[2] ?? '']
}

export function parseUnifiedDiff(input: string): FileDiff[] {
  const text = input.endsWith('\n') ? input.slice(0, -1) : input
  if (text === '') return []
  const files: FileDiff[] = []
  let file: FileDiff | null = null
  let hunk: Hunk | null = null
  let oldLine = 0
  let newLine = 0
  let oldName = ''
  let newName = ''

  const finish = () => {
    if (!file) return
    if (file.status === 'renamed') {
      file.path = newName || file.path
      file.oldPath = oldName || file.oldPath
    } else if (file.status === 'deleted') {
      file.path = oldName || file.path
    } else {
      file.path = newName || oldName || file.path
    }
    files.push(file)
    file = null
    hunk = null
  }

  for (const raw of text.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      finish()
      file = newFile()
      ;[oldName, newName] = headerNamesOf(raw.slice('diff --git '.length))
      file.path = newName
      continue
    }
    if (!file) continue
    if (raw.startsWith('rename from ')) { file.status = 'renamed'; file.oldPath = raw.slice('rename from '.length); continue }
    if (raw.startsWith('rename to ')) { file.path = raw.slice('rename to '.length); continue }
    if (raw.startsWith('new file mode')) { file.status = 'added'; continue }
    if (raw.startsWith('deleted file mode')) { file.status = 'deleted'; continue }
    if (raw.startsWith('Binary files ')) { file.isBinary = true; continue }
    if (raw.startsWith('--- ')) { const n = raw.slice(4); if (n !== '/dev/null') oldName = stripPrefix(n); continue }
    if (raw.startsWith('+++ ')) { const n = raw.slice(4); if (n !== '/dev/null') newName = stripPrefix(n); continue }
    const h = HUNK.exec(raw)
    if (h) {
      oldLine = Number(h[1])
      newLine = Number(h[2])
      hunk = { header: raw.replace(/ @@.*$/, ' @@'), oldStart: oldLine, newStart: newLine, lines: [] }
      file.hunks.push(hunk)
      continue
    }
    if (!hunk) continue
    if (raw.startsWith('\\')) continue
    const marker = raw[0]
    const body = raw.slice(1)
    let line: DiffLine
    if (marker === '+') line = { kind: 'add', text: body, oldLine: null, newLine: newLine++ }
    else if (marker === '-') line = { kind: 'del', text: body, oldLine: oldLine++, newLine: null }
    else if (marker === ' ' || raw === '') line = { kind: 'context', text: body, oldLine: oldLine++, newLine: newLine++ }
    else continue
    hunk.lines.push(line)
  }
  finish()
  return files
}
