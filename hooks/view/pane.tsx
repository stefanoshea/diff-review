/* @jsx h */
import type { Elements, RenderElement } from 'claude-code'
import type { Comment } from '../comments/types.ts'
import type { Side } from '../diff/types.ts'
import type { Model } from './model.ts'
import { badgeTextOf, cleanText, commentWidthOf, innerWidthOf, padTo, riskLinesOf, widthOf, windowOf, type Layout, type Row, type RowWindow } from './rows.ts'

const RISK_COLOR = { high: 'red', medium: 'yellow', low: 'green' } as const

export type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Input'>

export type Actions = {
  refresh(): void
  sendReview(): void
  claudeReview(): void
  toggleRisk(): void
  toggleFiles(): void
  toggleSent(): void
  toggleFile(path: string): void
  focusFile(path: string): void
  commentUp(): void
  commentDown(): void
  expandAll(): void
  startComment(path: string, side: Side, line: number): void
  startEdit(id: string): void
  remove(id: string): void
  submitDraft(value: string): void
  updateDraft(value: string): void
  saveDraft(): void
  ask(): void
  cancelDraft(): void
  cycleBase(): void
}

const isFileRow = (r: Row): r is Extract<Row, { kind: 'file' }> => r.kind === 'file'

export type PaneView = { offset: number; bodyRows: number }

export type Cursor = { path: string | null; commentId: string | null }

export function paneTree(kit: Kit, model: Model, comments: readonly Comment[], layout: Layout, actions: Actions, bodyColumns: number, cursor: Cursor, view: PaneView, onWindow?: (w: RowWindow, bodyCount: number) => void): RenderElement {
  const { Box, Text, Button } = kit
  if (bodyColumns < 40) return <Text dimColor>widen the terminal to use /diff-review</Text>
  if (model.phase === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">{model.error ?? 'error'}</Text>
        <Button key="refresh" label="refresh" onPress={actions.refresh} />
      </Box>
    )
  }
  if (model.phase !== 'ready' || !model.target) return <Text dimColor>loading diff…</Text>

  const t = model.target
  let open = 0
  for (const c of comments) if (c.sentAt === null) open++
  const canSend = t.sendBlocked === null && open > 0
  const title = t.mode === 'pr' && t.pr ? `PR #${t.pr.number}` : t.branch
  const subtitle = t.mode === 'pr' && t.pr
    ? `${t.diffSource.kind === 'github' ? `${t.pr.nameWithOwner} · ` : ''}${t.branch} → ${t.base} @${t.headSha.slice(0, 7)} · ${open} open`
    : `→ ${t.base}${t.pr ? ` · PR #${t.pr.number}` : ''} · ${open} open`
  const header = (
    <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
      <Box flexDirection="row" gap={1}>
        <Text bold wrap="truncate-end">{title}</Text>
        <Text dimColor wrap="truncate-end">{subtitle}</Text>
      </Box>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
      <Button key="refresh" label="refresh" onPress={actions.refresh} />
      <Button key="send" label="send review" dimColor={!canSend} onPress={actions.sendReview} />
      <Button key="claude-review" label="claude review" onPress={actions.claudeReview} />
      <Button key="files" label={model.showFiles ? 'hide files' : 'files'} onPress={actions.toggleFiles} />
      <Button key="sent" label={model.showSent ? 'hide sent' : 'sent'} onPress={actions.toggleSent} />
      <Button key="expand-all" label="expand all" onPress={actions.expandAll} />
      <Button key="comment-up" label="↑ comment" action="app:diffFileListUp" onPress={actions.commentUp} />
      <Button key="comment-down" label="↓ comment" action="app:diffFileListDown" onPress={actions.commentDown} />
      {t.mode === 'pr' ? null : <Button key="base" label="base" action="app:cycleDiffBase" onPress={actions.cycleBase} />}
      </Box>
    </Box>
  )

  const { rows, autoCollapsed, heights, tops } = layout

  const list = model.showFiles ? (
    <Box flexDirection="column">
      {rows.filter(isFileRow).map(r => (
        <Button key={`f:${r.path}`} plain label={r.label} onPress={() => actions.focusFile(r.path)} />
      ))}
    </Box>
  ) : null

  const chromeRows = 5 + (model.showFiles ? rows.filter(isFileRow).length : 0)
  const bodyCount = Math.max(3, view.bodyRows - chromeRows)
  const win = windowOf(rows, view.offset, bodyCount, bodyColumns, heights, tops)
  onWindow?.(win, bodyCount)
  const body = model.files.length === 0
    ? <Text dimColor>{`no changes against ${t.base}`}</Text>
    : win.rows.map((r, i) => rowOf(kit, r, actions, cursor, bodyColumns, win.heights[i] ?? 1))
  const position = win.total > bodyCount ? `${win.before + 1}-${win.before + win.shown} of ${win.total} · ` : ''

  const footer = `${position}${autoCollapsed > 0 ? `${autoCollapsed} file(s) collapsed for size · ` : ''}${model.footer}`

  return (
    <Box flexDirection="column">
      {header}
      {list}
      {body}
      <Text dimColor>{footer}</Text>
    </Box>
  )
}

function rail(kit: Kit, lines: number, glyph: string): RenderElement {
  const { Box, Text } = kit
  return <Box flexDirection="column">{Array.from({ length: lines }, () => <Text dimColor>{glyph}</Text>)}</Box>
}

function rowOf(kit: Kit, r: Row, actions: Actions, cursor: Cursor, columns: number, height: number): RenderElement {
  const { Box, Text } = kit
  if (r.kind === 'file') {
    const { Button } = kit
    const arrow = r.collapsed ? '▸' : '▾'
    const cursorMark = r.path === cursor.path ? '›' : ' '
    const badge = r.badge ? badgeTextOf(r.badge) : ''
    const head = cleanText(`${cursorMark}${arrow} ${r.label}`, Math.max(1, columns - 5 - (badge ? widthOf(badge) + 1 : 0)))
    const fill = Math.max(0, columns - 5 - widthOf(head) - (badge ? widthOf(badge) + 1 : 0))
    return (
      <Box flexDirection="row">
        <Text dimColor>{r.collapsed ? '── ' : '╭─ '}</Text>
        <Button key={`h:${r.path}`} plain label={head} onPress={() => actions.toggleFile(r.path)} />
        {r.badge ? <Text color={RISK_COLOR[r.badge.level]} dimColor={r.badge.level === 'low'} bold={r.badge.level === 'high'}>{` ${badge}`}</Text> : null}
        <Text dimColor>{` ${'─'.repeat(fill)}${r.collapsed ? '─' : '╮'}`}</Text>
      </Box>
    )
  }
  if (r.kind === 'file-end') return <Text dimColor>{`╰${'─'.repeat(Math.max(0, columns - 2))}╯`}</Text>
  if (r.kind === 'risk') {
    const { Button } = kit
    const width = commentWidthOf(columns)
    const [head, ...lines] = riskLinesOf(r.risk, r.stale, width)
    return (
      <Box flexDirection="column" width={columns} paddingX={1} borderStyle="round" borderColor={RISK_COLOR[r.risk.level]}>
        <Box flexDirection="row" gap={1}>
          <Text color={RISK_COLOR[r.risk.level]} bold wrap="truncate-end">{padTo(head ?? '', Math.max(1, width - 5))}</Text>
          <Button key="risk-hide" label="hide" onPress={actions.toggleRisk} />
        </Box>
        {lines.map(l => <Text wrap="truncate-end">{padTo(l, width)}</Text>)}
      </Box>
    )
  }
  const inner = innerRowOf(kit, r, actions, cursor, columns)
  if (height <= 1) {
    return (
      <Box flexDirection="row">
        <Text dimColor>{'│ '}</Text>
        {inner}
        <Text dimColor>{' │'}</Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="row">
      {rail(kit, height, '│ ')}
      {inner}
      {rail(kit, height, ' │')}
    </Box>
  )
}

function innerRowOf(kit: Kit, r: Exclude<Row, { kind: 'file' } | { kind: 'file-end' } | { kind: 'risk' }>, actions: Actions, cursor: Cursor, columns: number): RenderElement {
  const { Box, Text, Button, Input } = kit
  const inner = innerWidthOf(columns)
  switch (r.kind) {
    case 'hunk':
    case 'note':
      return <Text dimColor wrap="truncate-end">{padTo(cleanText(r.text, inner), inner)}</Text>
    case 'line': {
      const color = r.marker === '+' ? 'green' : r.marker === '-' ? 'red' : undefined
      const textWidth = Math.max(1, inner - widthOf(r.gutter) - 1)
      return (
        <Box flexDirection="row">
          <Button key={r.key} plain dimColor label={r.gutter} onPress={() => actions.startComment(r.path, r.side, r.line)} />
          <Text color="yellow" bold>{r.hasComments ? '●' : ' '}</Text>
          <Text color={color} inverse={r.selected} wrap="truncate-end">{padTo(`${r.marker}${r.text}`, textWidth)}</Text>
        </Box>
      )
    }
    case 'comment': {
      const c = r.comment
      const tag = c.sentAt !== null ? 'sent' : c.author === 'claude' ? 'claude' : 'you'
      const color = tag === 'claude' ? 'magenta' : tag === 'you' ? 'cyan' : undefined
      const here = c.id === cursor.commentId
      return (
        <Box flexDirection="column" width={inner - 2} marginLeft={2} paddingX={1} borderStyle="round" borderColor={color} borderDimColor={tag === 'sent' && !here}>
          <Box flexDirection="row" gap={1}>
            <Text color={color} bold inverse={here} dimColor={tag === 'sent' && !here}>{tag}</Text>
            {c.startLine === undefined ? null : <Text dimColor>{`lines ${c.startLine}-${c.line}`}</Text>}
            {tag === 'sent' ? null : <Button key={`e:${c.id}`} label="edit" onPress={() => actions.startEdit(c.id)} />}
            {tag === 'sent' ? null : <Button key={`d:${c.id}`} label="delete" onPress={() => actions.remove(c.id)} />}
          </Box>
          {r.lines.map(l => <Text wrap="truncate-end">{padTo(l, commentWidthOf(columns))}</Text>)}
        </Box>
      )
    }
    case 'input':
      return (
        <Box flexDirection="row" gap={1} width={inner - 2} marginLeft={2} paddingX={1} borderStyle="round" borderColor="cyan">
          <Input key={`in:${r.path}:${r.side}:${r.line}`} autoFocus value={r.draft} placeholder="comment, or question for [ask]" submitLabel="save" onInput={actions.updateDraft} onSubmit={actions.submitDraft} />
          <Button key="save" label="save" onPress={actions.saveDraft} />
          <Button key="ask" label="ask" onPress={actions.ask} />
          <Button key="cancel" label="cancel" onPress={actions.cancelDraft} />
        </Box>
      )
  }
}
