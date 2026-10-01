import { describe, expect, test, tier } from 'claude-code/testing'
import { CommentStore } from '../hooks/comments/store.ts'
import { parseUnifiedDiff } from '../hooks/diff/parse.ts'
import { ALL } from './fixtures/diffs.ts'

tier('user')

function memoryOps(now = 1000) {
  const map = new Map<string, unknown>()
  return {
    map,
    ops: {
      get: async (k: string) => (map.has(k) ? JSON.parse(JSON.stringify(map.get(k))) : undefined),
      set: async (k: string, v: unknown) => { map.set(k, JSON.parse(JSON.stringify(v))) },
      delete: async (k: string) => { map.delete(k) },
      now: async () => now,
    },
  }
}

describe('store', () => {
  test('prKeyOf keys PR-mode comments separately from branch-mode comments', () => {
    expect(CommentStore.prKeyOf('/work', 42)).toBe('review:/work:pr-42')
    expect(CommentStore.prKeyOf('/work', 42)).not.toBe(CommentStore.keyOf('/work', 'feature'))
  })

  test('add, edit, remove, send round-trip through ops', async () => {
    const key = CommentStore.keyOf('/work', 'feature')
    expect(key).toBe('review:/work:feature')
    const m = memoryOps(1000)
    const s = new CommentStore(m.ops, key)
    await s.load()
    const c = await s.add({ path: 'src/app.ts', side: 'RIGHT', line: 2, body: 'why?', author: 'user' })
    expect(c).toEqual(expect.objectContaining({ path: 'src/app.ts', side: 'RIGHT', line: 2, body: 'why?', author: 'user', createdAt: 1000, sentAt: null }))
    expect(c.id.length).toBeGreaterThan(3)
    c.body = 'mutated'
    expect(s.forLine('src/app.ts', 'RIGHT', 2)[0]?.body).toBe('why?')
    expect(await s.edit(c.id, 'why not?')).toBe(true)
    expect(s.forLine('src/app.ts', 'RIGHT', 2)[0]?.body).toBe('why not?')

    const again = new CommentStore(m.ops, key)
    await again.load()
    expect(again.all().length).toBe(1)

    await again.markSent([c.id])
    expect(again.open()).toEqual([])
    expect(again.all()[0]?.sentAt).toBe(1000)
    expect(await again.edit(c.id, 'late')).toBe(false)
    expect(await again.remove(c.id)).toBe(false)
    expect((m.map.get(key) as { comments: unknown[] }).comments.length).toBe(1)

    const copy = s.all()[0]!
    copy.body = 'zzz'
    expect(s.all()[0]?.body).toBe('why not?')
  })

  test('orphans are open comments off the current diff', async () => {
    const m = memoryOps()
    const s = new CommentStore(m.ops, 'k')
    await s.load()
    const ok = await s.add({ path: 'src/app.ts', side: 'RIGHT', line: 3, body: 'a', author: 'claude' })
    const gone = await s.add({ path: 'src/app.ts', side: 'RIGHT', line: 99, body: 'b', author: 'claude' })
    expect(s.orphans(parseUnifiedDiff(ALL)).map(c => c.id)).toEqual([gone.id])
    expect(ok.author).toBe('claude')
  })
})
