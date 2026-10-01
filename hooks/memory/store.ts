import type { StoreOps } from '../comments/store.ts'

export type MemoryKind = 'rejected' | 'corrected' | 'accepted' | 'note'
export type MemoryEntry = { kind: MemoryKind; at: number; path?: string; body: string; newBody?: string }
export type MemoryState = { entries: MemoryEntry[] }

export const MEMORY_PREFIX = 'memory:'
export const MAX_ENTRIES = 300
export const MAX_NOTES = 20
export const MAX_REJECTED = 15
export const MAX_CORRECTED = 10

export const MEMORY_HEADING = 'Reviewer preferences for this repository (learned from earlier reviews):'
const REJECTED_HEADING = 'Drafts the reviewer deleted (do not raise these again unless clearly wrong):'
const CORRECTED_HEADING = 'Drafts the reviewer rewrote (match this tone and precision):'

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

const cut = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`)

const fitLines = (lines: readonly string[], maxChars: number): string => {
  const kept: string[] = []
  let length = 0
  for (const line of lines) {
    const next = length + line.length + (kept.length ? 1 : 0)
    if (next > maxChars) break
    kept.push(line)
    length = next
  }
  return kept.join('\n')
}

export class MemoryStore {
  private state: MemoryState = { entries: [] }
  revision = 0

  constructor(private readonly ops: StoreOps, readonly key: string) {}

  static keyOf(toplevel: string): string {
    return `${MEMORY_PREFIX}${toplevel}`
  }

  async load(): Promise<void> {
    const raw = (await this.ops.get(this.key)) as MemoryState | undefined
    this.state = raw && Array.isArray(raw.entries) ? raw : { entries: [] }
    this.revision++
  }

  all(): readonly MemoryEntry[] {
    return this.state.entries.map(e => ({ ...e }))
  }

  countOf(kind: MemoryKind): number {
    return this.state.entries.filter(e => e.kind === kind).length
  }

  async record(entry: Omit<MemoryEntry, 'at'>): Promise<MemoryEntry> {
    const full: MemoryEntry = { ...entry, body: oneLine(entry.body), at: await this.ops.now() }
    if (typeof full.newBody === 'string') full.newBody = oneLine(full.newBody)
    this.state.entries.push(full)
    this.capEntries()
    await this.save()
    return { ...full }
  }

  async removeNote(index: number): Promise<boolean> {
    const target = this.state.entries.filter(e => e.kind === 'note')[index]
    if (!target) return false
    this.state.entries = this.state.entries.filter(e => e !== target)
    await this.save()
    return true
  }

  async clear(): Promise<void> {
    this.state = { entries: [] }
    this.revision++
    await this.ops.delete(this.key)
  }

  promptText(maxChars = 3500): string {
    if (this.state.entries.length === 0) return ''
    const notes = this.state.entries.filter(e => e.kind === 'note').slice(-MAX_NOTES)
    const rejected = this.state.entries.filter(e => e.kind === 'rejected').slice(-MAX_REJECTED)
    const corrected = this.state.entries.filter(e => e.kind === 'corrected').slice(-MAX_CORRECTED)
    const accepted = this.countOf('accepted')

    const lines: string[] = [MEMORY_HEADING]
    for (const n of notes) lines.push(`- ${oneLine(n.body)}`)
    if (rejected.length) {
      lines.push(REJECTED_HEADING)
      for (const r of rejected) lines.push(`- ${r.path ?? 'unknown'}: ${cut(oneLine(r.body), 160)}`)
    }
    if (corrected.length) {
      lines.push(CORRECTED_HEADING)
      for (const c of corrected) lines.push(`- ${c.path ?? 'unknown'}: "${cut(oneLine(c.body), 100)}" -> "${cut(oneLine(c.newBody ?? ''), 100)}"`)
    }
    if (accepted > 0) lines.push(`Accepted drafts so far: ${accepted}.`)
    if (lines.length === 1) return ''
    return fitLines(lines, maxChars)
  }

  private capEntries(): void {
    let over = this.state.entries.length - MAX_ENTRIES
    if (over <= 0) return
    const drop = new Set<number>()
    for (let i = 0; i < this.state.entries.length && over > 0; i++) {
      if (this.state.entries[i]?.kind !== 'note') { drop.add(i); over-- }
    }
    for (let i = 0; i < this.state.entries.length && over > 0; i++) {
      if (!drop.has(i)) { drop.add(i); over-- }
    }
    this.state.entries = this.state.entries.filter((_, i) => !drop.has(i))
  }

  private save(): Promise<void> {
    this.revision++
    return this.ops.set(this.key, this.state)
  }
}
