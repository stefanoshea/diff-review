import type { RenderInput } from 'claude-code'

export const PANE: RenderInput<'Pane'> = {
  component: 'Pane',
  surface: 'terminal',
  requestId: 'diff-review',
  viewport: { columns: 160, rows: 40 },
  props: { title: 'review', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
}
