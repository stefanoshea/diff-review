export type Side = 'LEFT' | 'RIGHT'
export type DiffLine = { kind: 'context' | 'add' | 'del'; text: string; oldLine: number | null; newLine: number | null }
export type Hunk = { header: string; oldStart: number; newStart: number; lines: DiffLine[] }
export type FileDiff = { path: string; oldPath: string | null; status: 'modified' | 'added' | 'deleted' | 'renamed'; isBinary: boolean; isLarge: boolean; hunks: Hunk[] }
