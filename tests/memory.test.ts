import { describe, expect, test, tier } from 'claude-code/testing'
import { MAX_ENTRIES, MemoryStore } from '../hooks/memory/store.ts'

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

describe('memory', () => {
  test('one memory key per repository, whatever the branch or PR', () => {
    expect(MemoryStore.keyOf('/work')).toBe('memory:/work')
    expect(MemoryStore.keyOf('/work')).not.toBe(MemoryStore.keyOf('/other'))
  })

  test('an empty store gives no prompt text', async () => {
    const m = memoryOps()
    const s = new MemoryStore(m.ops, MemoryStore.keyOf('/work'))
    await s.load()
    expect(s.all()).toEqual([])
    expect(s.promptText()).toBe('')
  })

  test('record round-trips through ops and stamps the time', async () => {
    const m = memoryOps(4242)
    const key = MemoryStore.keyOf('/work')
    const s = new MemoryStore(m.ops, key)
    await s.load()
    const e = await s.record({ kind: 'rejected', path: 'src/app.ts', body: 'Rename\n  this  variable' })
    expect(e).toEqual(expect.objectContaining({ kind: 'rejected', path: 'src/app.ts', body: 'Rename this variable', at: 4242 }))

    const again = new MemoryStore(m.ops, key)
    await again.load()
    expect(again.all().length).toBe(1)
    expect(again.countOf('rejected')).toBe(1)
  })

  test('promptText heads the block, groups each signal and counts the accepted drafts', async () => {
    const m = memoryOps()
    const s = new MemoryStore(m.ops, 'k')
    await s.load()
    await s.record({ kind: 'note', body: 'Do not comment on formatting' })
    await s.record({ kind: 'rejected', path: 'src/app.ts', body: 'Consider a const' })
    await s.record({ kind: 'corrected', path: 'src/app.ts', body: 'This looks wrong', newBody: 'Null check missing on line 2' })
    await s.record({ kind: 'accepted', path: 'new.txt', body: 'Add a test' })
    await s.record({ kind: 'accepted', path: 'new.txt', body: 'Handle the error' })

    const text = s.promptText()
    expect(text).toContain('Reviewer preferences for this repository (learned from earlier reviews):')
    expect(text).toContain('- Do not comment on formatting')
    expect(text).toContain('Drafts the reviewer deleted (do not raise these again unless clearly wrong):')
    expect(text).toContain('- src/app.ts: Consider a const')
    expect(text).toContain('Drafts the reviewer rewrote (match this tone and precision):')
    expect(text).toContain('- src/app.ts: "This looks wrong" -> "Null check missing on line 2"')
    expect(text).toContain('Accepted drafts so far: 2.')
  })

  test('promptText keeps the newest notes last and caps each group', async () => {
    const m = memoryOps()
    const s = new MemoryStore(m.ops, 'k')
    await s.load()
    for (let i = 0; i < 25; i++) await s.record({ kind: 'note', body: `note-${i}` })
    for (let i = 0; i < 20; i++) await s.record({ kind: 'rejected', path: 'p.ts', body: `drop-${i}` })

    const lines = s.promptText(100000).split('\n')
    const notes = lines.filter(l => l.startsWith('- note-'))
    expect(notes.length).toBe(20)
    expect(notes[0]).toBe('- note-5')
    expect(notes[notes.length - 1]).toBe('- note-24')
    const dropped = lines.filter(l => l.startsWith('- p.ts: drop-'))
    expect(dropped.length).toBe(15)
    expect(dropped[0]).toBe('- p.ts: drop-5')
  })

  test('long bodies are cut and newlines removed', async () => {
    const m = memoryOps()
    const s = new MemoryStore(m.ops, 'k')
    await s.load()
    await s.record({ kind: 'rejected', path: 'p.ts', body: 'x'.repeat(400) })
    await s.record({ kind: 'corrected', path: 'p.ts', body: 'y'.repeat(400), newBody: 'z'.repeat(400) })
    const lines = s.promptText(100000).split('\n')
    const rejected = lines.find(l => l.startsWith('- p.ts: x'))!
    expect(rejected.length).toBe('- p.ts: '.length + 160)
    const corrected = lines.find(l => l.includes('"y'))!
    expect(corrected).toContain(`"${'y'.repeat(99)}…"`)
    expect(corrected).toContain(`"${'z'.repeat(99)}…"`)
  })

  test('promptText cuts the whole block at a line boundary', async () => {
    const m = memoryOps()
    const s = new MemoryStore(m.ops, 'k')
    await s.load()
    for (let i = 0; i < 20; i++) await s.record({ kind: 'note', body: `preference number ${i} that the reviewer stated` })
    const text = s.promptText(200)
    expect(text.length).toBeLessThanOrEqual(200)
    expect(text.split('\n').every(l => l === 'Reviewer preferences for this repository (learned from earlier reviews):' || l.startsWith('- preference number '))).toBe(true)
    expect(text.endsWith('…')).toBe(false)
  })

  test('the cap drops the oldest non-note entries first, then the oldest notes', async () => {
    const m = memoryOps()
    const s = new MemoryStore(m.ops, 'k')
    await s.load()
    for (let i = 0; i < 5; i++) await s.record({ kind: 'note', body: `keep-${i}` })
    for (let i = 0; i < MAX_ENTRIES; i++) await s.record({ kind: 'rejected', path: 'p.ts', body: `r-${i}` })

    expect(s.all().length).toBe(MAX_ENTRIES)
    expect(s.countOf('note')).toBe(5)
    expect(s.countOf('rejected')).toBe(MAX_ENTRIES - 5)
    expect(s.all().filter(e => e.kind === 'rejected')[0]?.body).toBe('r-5')

    const notesOnly = new MemoryStore(memoryOps().ops, 'k2')
    await notesOnly.load()
    for (let i = 0; i < MAX_ENTRIES + 2; i++) await notesOnly.record({ kind: 'note', body: `n-${i}` })
    expect(notesOnly.all().length).toBe(MAX_ENTRIES)
    expect(notesOnly.all()[0]?.body).toBe('n-2')
  })

  test('removeNote drops one note by position and leaves the other signals', async () => {
    const m = memoryOps()
    const s = new MemoryStore(m.ops, 'k')
    await s.load()
    await s.record({ kind: 'note', body: 'first' })
    await s.record({ kind: 'rejected', path: 'p.ts', body: 'a draft' })
    await s.record({ kind: 'note', body: 'second' })
    expect(await s.removeNote(0)).toBe(true)
    expect(await s.removeNote(9)).toBe(false)
    expect(s.all().map(e => e.body)).toEqual(['a draft', 'second'])
  })

  test('clear empties the store and deletes the key', async () => {
    const m = memoryOps()
    const key = MemoryStore.keyOf('/work')
    const s = new MemoryStore(m.ops, key)
    await s.load()
    await s.record({ kind: 'note', body: 'something' })
    expect(m.map.has(key)).toBe(true)
    await s.clear()
    expect(s.all()).toEqual([])
    expect(s.promptText()).toBe('')
    expect(m.map.has(key)).toBe(false)
  })
})
