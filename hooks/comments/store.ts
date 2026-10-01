import { hasAddress, inOneHunk } from '../diff/address.ts'
import type { FileDiff, Side } from '../diff/types.ts'
import { Names } from '../names.ts'
import type { Author, Comment, ReviewState } from './types.ts'

export type StoreOps = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
  now: () => Promise<number>
}

const newId = () => Math.random().toString(36).slice(2, 10)

export class CommentStore {
  private state: ReviewState = { comments: [] }
  revision = 0

  constructor(private readonly ops: StoreOps, readonly key: string) {}

  static keyOf(toplevel: string, branch: string): string {
    return `${Names.STORE_PREFIX}${toplevel}:${branch}`
  }

  static prKeyOf(toplevel: string, prNumber: number): string {
    return `${Names.STORE_PREFIX}${toplevel}:pr-${prNumber}`
  }

  async load(): Promise<void> {
    const raw = (await this.ops.get(this.key)) as ReviewState | undefined
    this.state = raw && Array.isArray(raw.comments) ? raw : { comments: [] }
    this.revision++
  }

  all(): readonly Comment[] { return this.state.comments.map(c => ({ ...c })) }

  open(): Comment[] { return this.state.comments.filter(c => c.sentAt === null).map(c => ({ ...c })) }

  forLine(path: string, side: Side, line: number): Comment[] {
    return this.state.comments.filter(c => c.path === path && c.side === side && c.line === line).map(c => ({ ...c }))
  }

  async add(input: { path: string; side: Side; line: number; startLine?: number; body: string; author: Author }): Promise<Comment> {
    const comment: Comment = { id: newId(), ...input, createdAt: await this.ops.now(), sentAt: null }
    this.state.comments.push(comment)
    await this.save()
    return { ...comment }
  }

  async edit(id: string, body: string): Promise<boolean> {
    const c = this.state.comments.find(x => x.id === id)
    if (!c || c.sentAt !== null) return false
    c.body = body
    await this.save()
    return true
  }

  async remove(id: string): Promise<boolean> {
    const c = this.state.comments.find(x => x.id === id)
    if (!c || c.sentAt !== null) return false
    this.state.comments = this.state.comments.filter(x => x.id !== id)
    await this.save()
    return true
  }

  async markSent(ids: readonly string[]): Promise<void> {
    const at = await this.ops.now()
    for (const c of this.state.comments) if (ids.includes(c.id)) c.sentAt = at
    await this.save()
  }

  async clear(): Promise<void> {
    this.state = { comments: [] }
    await this.ops.delete(this.key)
  }

  orphans(files: readonly FileDiff[]): Comment[] {
    return this.open().filter(c => (c.startLine === undefined ? !hasAddress(files, c.path, c.side, c.line) : !inOneHunk(files, c.path, c.side, c.startLine, c.line)))
  }

  private save(): Promise<void> {
    this.revision++
    return this.ops.set(this.key, this.state)
  }
}
