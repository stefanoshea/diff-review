import type { FileDiff, Side } from '../diff/types.ts'
import type { Target } from '../git/target.ts'

export type Editing = { path: string; side: Side; line: number; endLine: number | null; commentId: string | null; draft: string }

export type RiskLevel = 'low' | 'medium' | 'high'
export const RISK_LEVELS: readonly RiskLevel[] = ['low', 'medium', 'high']
export type FileRisk = { path: string; level: RiskLevel; reason: string }
export type Risk = { headSha: string; level: RiskLevel; summary: string; dimensions: string[]; decisions: string[]; files: FileRisk[] }

export type Model = {
  phase: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  target: Target | null
  files: FileDiff[]
  isDiffTruncated: boolean
  collapsed: string[]
  showFiles: boolean
  showSent: boolean
  showRisk: boolean
  risk: Risk | null
  editing: Editing | null
  footer: string
  lastRefreshAt: number | null
}

export function newModel(): Model {
  return { phase: 'idle', error: null, target: null, files: [], isDiffTruncated: false, collapsed: [], showFiles: false, showSent: false, showRisk: true, risk: null, editing: null, footer: '', lastRefreshAt: null }
}
