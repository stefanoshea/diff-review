import type { On, UiOpenResult } from 'claude-code'
import { IN_PR, answerOf, type Script } from './git-script.ts'
import { startsSession } from './starts-session.ts'

export const SESSION_ID = 'session-a'

export function world(on: On, script: Script = IN_PR, stored?: Readonly<Record<string, unknown>>, placed: UiOpenResult = { isPlaced: true }) {
  const clock = startsSession(on)
  on('session.id', () => ({ value: SESSION_ID }))
  const runs: { argv: readonly string[]; stdin?: string }[] = []
  on('process.run', ($, e) => { runs.push({ argv: e.argv, stdin: e.init?.stdin }); return { value: answerOf(e.argv, script) } })
  const opened: string[] = []
  const closed: string[] = []
  const focused: (string | undefined)[] = []
  const toasts: string[] = []
  on('ui.open', ($, e) => { opened.push(e.id); return { value: placed } })
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  on('ui.close', ($, e) => { closed.push(e.id); return { value: undefined } })
  on('ui.invalidate', () => ({ value: undefined }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.focus', ($, e) => { focused.push(e.element); return {} })
  const store = new Map<string, unknown>(Object.entries(stored ?? {}))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => { store.set(e.key, e.value); return { value: undefined } })
  on('store.delete', ($, e) => { store.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...store.keys()] }))
  return { clock, runs, opened, closed, focused, store, toasts }
}
