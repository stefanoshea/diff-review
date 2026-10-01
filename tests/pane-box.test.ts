import { describe, expect, test, tier } from 'claude-code/testing'
import { widthOf } from '../hooks/view/rows.ts'
import { PANE } from './fixtures/pane.ts'
import { review } from './fixtures/review-command.ts'
import { SESSION } from './fixtures/session.ts'
import { world } from './fixtures/world.ts'

tier('user')

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null

const textOf = (node: unknown): string => {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (!isNode(node)) return ''
  const label = node.props?.['label']
  if (node.type === 'Button' && typeof label === 'string') return label
  return (node.children ?? []).map(textOf).join('')
}

const railedRows = (node: unknown, out: Node[] = []): Node[] => {
  if (Array.isArray(node)) { for (const c of node) railedRows(c, out); return out }
  if (!isNode(node)) return out
  const kids = node.children ?? []
  const head = textOf(kids[0])
  if (node.type === 'Box' && node.props?.['flexDirection'] === 'row' && (head.startsWith('│') || head.startsWith('╭─') || head.startsWith('── '))) out.push(node)
  for (const c of kids) railedRows(c, out)
  return out
}

describe('pane box', () => {
  test('every plain diff row fills the pane width exactly, rails included', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    const tree = await $.ui.render(PANE)
    const rows = railedRows(tree)
    expect(rows.length).toBeGreaterThan(0)
    const widths = rows.map(r => widthOf(textOf(r)))
    expect(widths.every(n => n === PANE.props.bodyColumns)).toBe(true)
  })

  test('the file header and its closing rule both fill the pane width exactly', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await $.command.run(review())
    await w.clock.settle()
    const tree = await $.ui.render(PANE)
    const flat = JSON.stringify(tree)
    expect(flat).toContain('╭─ ')
    expect(flat).toContain('╮')
    const ends = flat.match(/╰─+╯/g) ?? []
    expect(ends.length).toBeGreaterThan(0)
    expect(ends.every(e => widthOf(e) === PANE.props.bodyColumns)).toBe(true)
  })
})
