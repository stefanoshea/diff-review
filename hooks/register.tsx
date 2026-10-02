/* @jsx h */
import type { EngineInterface, Register } from 'claude-code'
import { CommentStore, type StoreOps } from './comments/store.ts'
import { fileOf, inOneHunk } from './diff/address.ts'
import type { FileDiff, Side } from './diff/types.ts'
import { createPendingReview } from './send/github.ts'
import { payloadOf } from './send/payload.ts'
import { fetchDiff, type DiffFetch } from './git/fetch-diff.ts'
import { runnerOf, type Runner } from './git/run.ts'
import { uncommittedOf } from './git/uncommitted.ts'
import { MemoryStore } from './memory/store.ts'
import { prNumberOf, prRefOf, resolvePrTarget, resolveTarget, type Target, type TargetFailure } from './git/target.ts'
import { Names } from './names.ts'
import { DEFAULT_REVIEW_SKILL, reviewPlanOf, riskPromptOf, serveAddComment, serveGetDiff, serveListComments, serveSetRisk } from './tools.ts'
import { askTextOf, type AskSelection } from './view/ask-text.ts'
import { newModel, type Editing, type Model, type Risk } from './view/model.ts'
import { paneTree, type Actions } from './view/pane.tsx'
import { centeredTopOf, commentOrderOf, indexOfKey, LayoutCache, snapOffset, type CommentStop, type Layout } from './view/rows.ts'

const REFRESH_DEBOUNCE_MS = 800
const REDRAW_MS = 16
const HEAD_POLL_MS = 5000
const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'Bash'] as const

type Timer = { cancel: () => void }
type Timers = { refresh?: Timer; redraw?: Timer; poll?: Timer }

type ChainStep = { label: string; run: () => Promise<unknown> }
type Chain = { steps: ChainStep[]; label: string; isArmed: boolean; turnId: string | null }

type State = { chain: Chain | null; model: Model; store: CommentStore | null; memory: MemoryStore | null; isOpen: boolean; timers: Timers; lastHead: string; generation: number; prNumber: number | null; prRepo: string | null; cursorPath: string | null; cursorCommentId: string | null; scrollTop: number; bodyCount: number; contentRows: number; columns: number; reviewSkill: string; layout: LayoutCache; sessionId: string | null }

const newState = (): State => ({ chain: null, model: newModel(), store: null, memory: null, isOpen: false, timers: {}, lastHead: '', generation: 0, prNumber: null, prRepo: null, cursorPath: null, cursorCommentId: null, scrollTop: 0, bodyCount: 20, contentRows: 0, columns: 80, reviewSkill: DEFAULT_REVIEW_SKILL, layout: new LayoutCache(), sessionId: null })

const layoutOf = (state: State, columns: number): Layout =>
  state.layout.get(state.model.files, () => state.store?.all() ?? [], state.model, columns, state.store?.revision ?? 0)

const baseKey = (toplevel: string, branch: string) => `base:${toplevel}:${branch}`
const openKey = (toplevel: string) => `open:${toplevel}`
type OpenMarker = { prNumber: number | null; prRepo?: string | null; sessionId?: string }
const openMarkerOf = (state: State): OpenMarker => ({ prNumber: state.prNumber, prRepo: state.prRepo, sessionId: state.sessionId ?? undefined })
const riskKeyOf = (commentKey: string) => `risk:${commentKey.slice(Names.STORE_PREFIX.length)}`

const storeOpsOf = ($: EngineInterface): StoreOps => ({
  get: k => $.store.get(k),
  set: (k, v) => $.store.set(k, v),
  delete: k => $.store.delete(k),
  now: () => $.clock.now(),
})

const onFail = (state: State, $: EngineInterface) => (error: unknown) => {
  state.model.footer = String(error)
  redraw(state, $)
}

const cancelTimers = (state: State) => {
  for (const t of Object.values(state.timers)) t?.cancel()
  state.timers = {}
}

const redraw = (state: State, $: EngineInterface) => {
  if (state.timers.redraw) return
  state.timers.redraw = $.clock.after(REDRAW_MS, () => {
    state.timers.redraw = undefined
    void $.ui.invalidate('ui.render')
  })
}

const refresh = async (state: State, $: EngineInterface) => {
  const gen = ++state.generation
  const run: Runner = runnerOf((argv, init) => $.process.run(argv, init))
  if (state.model.phase !== 'ready') state.model.phase = 'loading'

  let target: Target | TargetFailure
  if (state.prNumber !== null) {
    target = await resolvePrTarget(run, state.prNumber, state.prRepo)
    if (gen !== state.generation) return
  } else {
    const probe = await resolveTarget(run)
    if (gen !== state.generation) return
    if ('error' in probe) {
      state.model = { ...state.model, phase: 'error', error: probe.error }
      redraw(state, $)
      return
    }
    const override = (await $.store.get(baseKey(probe.toplevel, probe.branch))) as string | undefined
    if (gen !== state.generation) return
    target = override ? await resolveTarget(run, override) : probe
    if (gen !== state.generation) return
  }
  if ('error' in target) {
    state.model = { ...state.model, phase: 'error', error: target.error }
    redraw(state, $)
    return
  }
  const key = state.prNumber !== null ? CommentStore.prKeyOf(target.repoKey, state.prNumber) : CommentStore.keyOf(target.repoKey, target.branch)
  if (!state.store || state.store.key !== key) {
    const freshStore = new CommentStore(storeOpsOf($), key)
    await freshStore.load()
    if (gen !== state.generation) return
    state.store = freshStore
    const risk = (await $.store.get(riskKeyOf(key))) as Risk | undefined
    if (gen !== state.generation) return
    state.model.risk = risk ?? null
    state.model.showRisk = true
  }
  const memoryKey = MemoryStore.keyOf(target.repoKey)
  if (!state.memory || state.memory.key !== memoryKey) {
    const freshMemory = new MemoryStore(storeOpsOf($), memoryKey)
    await freshMemory.load()
    if (gen !== state.generation) return
    state.memory = freshMemory
  }
  const diff = await fetchDiff(run, target)
  if (gen !== state.generation) return
  const lastRefreshAt = await $.clock.now()
  if (gen !== state.generation) return
  state.lastHead = target.headSha
  state.model = { ...state.model, phase: 'ready', error: null, target, files: diff.files, isDiffTruncated: diff.isTruncated, lastRefreshAt }
  state.model.footer = footerOf(state.store, target, diff)
  if (state.isOpen) await $.store.set(openKey(target.toplevel), openMarkerOf(state))
  redraw(state, $)
}

const footerOf = (store: CommentStore, target: Target, diff: DiffFetch): string => {
  const source = target.diffSource
  if (source.kind === 'github' && diff.error) return `no diff from the GitHub API for ${source.nameWithOwner}#${source.number}: ${diff.error}`
  if (source.kind === 'github' && diff.files.length === 0) return `no diff from the GitHub API for ${source.nameWithOwner}#${source.number} (too large, or no access)`
  if (diff.error) return `git diff failed: ${diff.error}`
  const last = diff.files.at(-1)
  if (diff.isTruncated) return last ? `diff cut at 4 MiB: files after ${last.path} are missing` : 'diff cut at 4 MiB'
  const orphans = store.orphans(diff.files)
  if (orphans.length) return `${orphans.length} comment(s) no longer on the diff`
  return target.sendBlocked ? `send: ${target.sendBlocked}` : `send ready · ${store.open().length} open`
}

const scheduleRefresh = (state: State, $: EngineInterface) => {
  if (!state.isOpen || state.prNumber !== null) return
  state.timers.refresh?.cancel()
  state.timers.refresh = $.clock.after(REFRESH_DEBOUNCE_MS, () => { void refresh(state, $) })
}

const openPane = async (state: State, $: EngineInterface) => {
  state.isOpen = true
  const opened = await $.ui.open({ id: Names.PANE_ID, title: 'review', focus: true })
  if (!opened.isPlaced) $.ui.toast(`review pane waits: ${opened.reason}`)
  if (state.model.target) await $.store.set(openKey(state.model.target.toplevel), openMarkerOf(state))
  state.timers.poll?.cancel()
  state.timers.poll = $.clock.every(HEAD_POLL_MS, async () => {
    if (state.prNumber !== null) return
    const run: Runner = runnerOf((argv, init) => $.process.run(argv, init))
    const r = await run(['git', '--no-optional-locks', 'rev-parse', 'HEAD'])
    if (r.ok && r.stdout.trim() !== state.lastHead) scheduleRefresh(state, $)
  })
  await refresh(state, $)
}

const clearOpenState = async (state: State, $: EngineInterface) => {
  state.isOpen = false
  state.chain = null
  cancelTimers(state)
  if (state.model.target) await $.store.delete(openKey(state.model.target.toplevel))
}

const closePane = async (state: State, $: EngineInterface) => {
  await clearOpenState(state, $)
  await $.ui.close({ id: Names.PANE_ID })
}

const entryPointOf = (order: readonly CommentStop[], path: string | null, delta: 1 | -1): number => {
  if (path === null) return delta === 1 ? -1 : 0
  const paths = order.map(s => s.path)
  if (delta === 1) {
    const first = paths.indexOf(path)
    return first < 0 ? -1 : first - 1
  }
  const last = paths.lastIndexOf(path)
  return last < 0 ? 0 : last + 1
}

const stepComment = (state: State, $: EngineInterface, delta: 1 | -1) => {
  const order = commentOrderOf(state.model.files, state.store?.all() ?? [], state.model, layoutOf(state, state.columns))
  if (order.length === 0) {
    state.model.footer = state.model.showSent ? 'no comments' : 'no open comments'
    redraw(state, $)
    return
  }
  const at = state.cursorCommentId === null ? -1 : order.findIndex(s => s.id === state.cursorCommentId)
  const from = at >= 0 ? at : entryPointOf(order, state.cursorPath, delta)
  const to = (from + delta + order.length) % order.length
  const stop = order[to]
  if (stop === undefined) return
  const wrapped = at >= 0 && (delta === 1 ? to < at : to > at)
  state.cursorCommentId = stop.id
  state.cursorPath = stop.path
  if (state.model.collapsed.includes(stop.path)) state.model.collapsed = state.model.collapsed.filter(p => p !== stop.path)
  state.model.footer = `comment ${to + 1} of ${order.length}${wrapped ? ' (wrapped)' : ''}`
  const layout = layoutOf(state, state.columns)
  state.contentRows = layout.total
  redraw(state, $)
  centerKey(state, $, `e:${stop.id}`)
  if (!stop.sent) void $.ui.focus({ requestId: Names.PANE_ID, key: `e:${stop.id}` }).catch(() => {})
}

const refuseSend = (state: State, $: EngineInterface, why: string): string => {
  state.model.footer = `cannot send: ${why}`
  redraw(state, $)
  return `review: cannot send: ${why}`
}

const sendReview = async (state: State, $: EngineInterface): Promise<string> => {
  const target = state.model.target
  if (!state.store || !target) return 'review: open the pane first'
  if (target.sendBlocked) return refuseSend(state, $, target.sendBlocked)
  const payload = payloadOf(state.store.all(), state.model.files, target.headSha)
  if ('error' in payload) return refuseSend(state, $, payload.error)
  const run: Runner = runnerOf((argv, init) => $.process.run(argv, init))
  if (target.mode === 'branch') {
    const dirty = await uncommittedOf(run, target.toplevel, [...new Set(payload.comments.map(c => c.path))])
    if (dirty.error) return refuseSend(state, $, `git diff --name-only failed: ${dirty.error}`)
    if (dirty.paths.length) return refuseSend(state, $, `uncommitted changes in ${dirty.paths.join(', ')}; commit and push first`)
  }
  const result = await createPendingReview(run, target, payload)
  if (!result.ok) {
    state.model.footer = `send failed: ${result.error}`
    redraw(state, $)
    return `review: send failed: ${result.error}`
  }
  await state.store.markSent(payload.ids)
  for (const c of state.store.all()) {
    if (c.author !== 'claude' || !payload.ids.includes(c.id)) continue
    await state.memory?.record({ kind: 'accepted', path: c.path, body: c.body }).catch(onFail(state, $))
  }
  state.model.footer = `pending review created, submit on GitHub: ${result.url}`
  redraw(state, $)
  return `review: pending review created with ${payload.ids.length} comment(s). Submit it on GitHub: ${result.url}`
}

const prTargetOf = (state: State): string | null => {
  const t = state.model.target
  if (t?.mode !== 'pr' || !t.pr) return null
  return t.diffSource.kind === 'github' ? t.pr.url : String(t.pr.number)
}

const startRiskAnalysis = (state: State, $: EngineInterface) => {
  state.model.footer = 'asked Claude: risk analysis'
  redraw(state, $)
  const memory = state.memory?.promptText() ?? ''
  $.clock.after(REDRAW_MS, () => {
    void $.prompt.submit({ text: riskPromptOf(prTargetOf(state), memory) }).catch(onFail(state, $))
  })
}

const runChainStep = (state: State, $: EngineInterface) => {
  const chain = state.chain
  const step = chain?.steps.shift()
  if (!chain || !step) { state.chain = null; return }
  chain.label = step.label
  chain.isArmed = true
  chain.turnId = null
  void step.run().catch(error => {
    if (state.chain === chain) state.chain = null
    onFail(state, $)(error)
  })
}

const startClaudeReview = (state: State, $: EngineInterface) => {
  const target = prTargetOf(state)
  state.model.footer = `asked Claude: risk analysis, then ${state.reviewSkill}`
  redraw(state, $)
  const memory = state.memory?.promptText() ?? ''
  const plan = reviewPlanOf(state.reviewSkill, target, memory)
  state.chain = {
    steps: [
      { label: 'risk analysis', run: () => $.prompt.submit({ text: riskPromptOf(target, memory) }) },
      { label: state.reviewSkill, run: () => $.command.run({ command: plan.command, args: plan.args }) },
      { label: 'draft comments', run: () => $.prompt.submit({ text: plan.followUp }) },
    ],
    label: '',
    isArmed: false,
    turnId: null,
  }
  $.clock.after(REDRAW_MS, () => runChainStep(state, $))
}

const applyRisk = async (state: State, $: EngineInterface, risk: Risk) => {
  state.model.risk = risk
  state.model.showRisk = true
  const low = new Set(risk.files.filter(f => f.level === 'low').map(f => f.path))
  state.model.collapsed = [...new Set([...state.model.collapsed, ...state.model.files.map(f => f.path).filter(p => low.has(p))])]
  state.scrollTop = 0
  redraw(state, $)
  if (state.store) await $.store.set(riskKeyOf(state.store.key), risk)
}

const scrollBy = (state: State, $: EngineInterface, by: number) => {
  const layout = layoutOf(state, state.columns)
  const to = snapOffset(layout.tops, layout.total, state.bodyCount, state.scrollTop, by)
  if (to === state.scrollTop) return
  state.scrollTop = to
  redraw(state, $)
}

const revealKey = (state: State, $: EngineInterface, key: string) => {
  const layout = layoutOf(state, state.columns)
  const index = indexOfKey(layout, key)
  if (index < 0) return
  const top = layout.tops[index] ?? 0
  const margin = 2
  if (top < state.scrollTop + margin) scrollBy(state, $, top - margin - state.scrollTop)
  else if (top + margin >= state.scrollTop + state.bodyCount) scrollBy(state, $, top + margin + 1 - state.bodyCount - state.scrollTop)
}

const centerKey = (state: State, $: EngineInterface, key: string) => {
  const layout = layoutOf(state, state.columns)
  const index = indexOfKey(layout, key)
  if (index < 0) return
  const top = layout.tops[index] ?? 0
  const height = layout.heights[index] ?? 1
  const wanted = centeredTopOf(top, height, state.bodyCount)
  scrollBy(state, $, wanted - state.scrollTop)
}

const VERBS = new Set(['open', 'pr', 'branch', 'close', 'refresh', 'send', 'clear', 'base', 'claude', 'risk', 'note', 'memory'])

const parseArgs = (raw: string): { verb: string; rest: string[] } => {
  const words = raw.split(/\s+/).filter(Boolean).filter(w => w !== `/${Names.COMMAND}` && w !== Names.COMMAND)
  if (words.length === 0) return { verb: 'open', rest: [] }
  const at = words.findIndex(w => VERBS.has(w.toLowerCase()) || prNumberOf(w) !== null)
  if (at < 0) return { verb: 'unknown', rest: words }
  const head = words[at]!
  const rest = words.slice(at + 1)
  if (VERBS.has(head.toLowerCase())) return { verb: head.toLowerCase(), rest }
  return { verb: 'pr', rest: [head, ...rest] }
}

const statusText = (state: State) => {
  if (state.model.phase === 'error') return `review: ${state.model.error}`
  const t = state.model.target
  if (!t) return 'review: loading'
  if (t.mode === 'pr' && t.pr) {
    const where = t.diffSource.kind === 'github' ? `${t.pr.nameWithOwner} ` : ''
    return `review: ${where}PR #${t.pr.number} ${t.branch} → ${t.base} @${t.headSha.slice(0, 7)}, ${state.model.files.length} file(s), ${state.store?.open().length ?? 0} open comment(s)`
  }
  return `review: ${t.branch} → ${t.base}${t.pr ? ` (PR #${t.pr.number})` : ''}, ${state.model.files.length} file(s), ${state.store?.open().length ?? 0} open comment(s)`
}

const addressOfDraft = (files: readonly FileDiff[], editing: Editing): { path: string; side: Side; line: number; startLine?: number } => {
  const end = editing.endLine ?? editing.line
  if (end === editing.line || !inOneHunk(files, editing.path, editing.side, editing.line, end)) return { path: editing.path, side: editing.side, line: editing.line }
  return { path: editing.path, side: editing.side, line: Math.max(editing.line, end), startLine: Math.min(editing.line, end) }
}

const actionsOf = (state: State, $: EngineInterface): Actions => ({
  refresh: () => { void refresh(state, $).catch(onFail(state, $)) },
  sendReview: () => { void sendReview(state, $).catch(onFail(state, $)) },
  claudeReview: () => startClaudeReview(state, $),
  toggleRisk: () => { state.model.showRisk = !state.model.showRisk; redraw(state, $) },
  toggleFiles: () => { state.model.showFiles = !state.model.showFiles; redraw(state, $) },
  toggleSent: () => { state.model.showSent = !state.model.showSent; redraw(state, $) },
  toggleFile: path => {
    const c = state.model.collapsed
    state.model.collapsed = c.includes(path) ? c.filter(p => p !== path) : [...c, path]
    state.cursorPath = path
    state.cursorCommentId = null
    redraw(state, $)
  },
  focusFile: path => {
    state.model.collapsed = state.model.files.map(f => f.path).filter(p => p !== path)
    state.model.showFiles = false
    state.cursorPath = path
    state.cursorCommentId = null
    redraw(state, $)
  },
  commentUp: () => stepComment(state, $, -1),
  commentDown: () => stepComment(state, $, 1),
  expandAll: () => { if (state.model.collapsed.length) state.model.collapsed = []; redraw(state, $) },
  startComment: (path, side, line) => {
    const editing = state.model.editing
    if (editing && editing.path === path && editing.side === side && editing.endLine === null && line !== editing.line) {
      editing.endLine = line
      redraw(state, $)
      return
    }
    state.model.editing = { path, side, line, endLine: null, commentId: null, draft: '' }
    redraw(state, $)
  },
  startEdit: id => {
    const c = state.store?.all().find(x => x.id === id)
    if (c) state.model.editing = { path: c.path, side: c.side, line: c.line, endLine: null, commentId: c.id, draft: c.body }
    redraw(state, $)
  },
  remove: id => {
    const c = state.store?.all().find(x => x.id === id)
    if (c && c.author === 'claude' && c.sentAt === null) void state.memory?.record({ kind: 'rejected', path: c.path, body: c.body }).catch(onFail(state, $))
    void state.store?.remove(id).then(() => redraw(state, $)).catch(onFail(state, $))
  },
  submitDraft: value => {
    const editing = state.model.editing
    const body = value.trim()
    state.model.editing = null
    if (!editing || !state.store || !body) { redraw(state, $); return }
    const prior = editing.commentId ? state.store.all().find(x => x.id === editing.commentId) : undefined
    if (prior && prior.author === 'claude' && prior.body !== body) {
      void state.memory?.record({ kind: 'corrected', path: prior.path, body: prior.body, newBody: body }).catch(onFail(state, $))
    }
    const done = editing.commentId ? state.store.edit(editing.commentId, body) : state.store.add({ ...addressOfDraft(state.model.files, editing), body, author: 'user' })
    void Promise.resolve(done).then(() => redraw(state, $)).catch(onFail(state, $))
  },
  updateDraft: value => { if (state.model.editing) state.model.editing.draft = value },
  saveDraft: () => actionsOf(state, $).submitDraft(state.model.editing?.draft ?? ''),
  ask: () => {
    const editing = state.model.editing
    if (!editing || !state.model.target) return
    const file = fileOf(state.model.files, editing.path)
    const from = Math.min(editing.line, editing.endLine ?? editing.line)
    const to = Math.max(editing.line, editing.endLine ?? editing.line)
    const sel: AskSelection = { path: editing.path, side: editing.side, from, to }
    const text = file ? askTextOf(state.model.target, file, sel, editing.draft) : editing.draft
    state.model.editing = null
    state.model.footer = `asked Claude about ${editing.path}:${from}-${to}`
    redraw(state, $)
    void $.prompt.submit({ text }).catch(onFail(state, $))
  },
  cancelDraft: () => { state.model.editing = null; redraw(state, $) },
  cycleBase: () => {
    void (async () => {
      if (!state.model.target) return
      const key = baseKey(state.model.target.toplevel, state.model.target.branch)
      const current = (await $.store.get(key)) as string | undefined
      if (current) await $.store.delete(key)
      else await $.store.set(key, state.model.target.base === 'main' ? 'master' : 'main')
      await refresh(state, $)
    })().catch(onFail(state, $))
  },
})

const answerCommand = async (state: State, $: EngineInterface, args: string | undefined): Promise<string> => {
  const raw = (args ?? '').trim()
  const { verb, rest } = parseArgs(raw)
  switch (verb) {
    case 'unknown':
      return `review: unknown input "${raw}" (use: pr <number|url>, claude, risk, note <text>, memory [clear], branch, close, refresh, send, clear, base <ref>)`
    case 'close':
      await closePane(state, $)
      return 'review: pane closed'
    case 'refresh':
      if (state.isOpen) await refresh(state, $); else await openPane(state, $)
      return statusText(state)
    case 'send':
      if (!state.isOpen) await openPane(state, $)
      return sendReview(state, $)
    case 'claude':
      if (!state.isOpen) await openPane(state, $)
      startClaudeReview(state, $)
      return `review: asked Claude for a risk analysis, then a review with ${state.reviewSkill} and draft comments`
    case 'risk':
      if (!state.isOpen) await openPane(state, $)
      startRiskAnalysis(state, $)
      return 'review: asked Claude for a risk analysis'
    case 'clear':
      await state.store?.clear()
      redraw(state, $)
      return 'review: comments cleared'
    case 'note': {
      const text = rest.join(' ').trim()
      if (!text) return 'review: usage: /diff-review note <what Claude should remember about your reviews>'
      if (!state.isOpen) await openPane(state, $)
      if (!state.memory) return 'review: cannot read the repository, so nothing was noted'
      await state.memory.record({ kind: 'note', body: text })
      return `review: noted (${state.memory.countOf('note')} notes)`
    }
    case 'memory': {
      if (!state.isOpen) await openPane(state, $)
      if (rest[0]?.toLowerCase() === 'clear') {
        await state.memory?.clear()
        return 'review: feedback memory cleared'
      }
      return state.memory?.promptText(8000) || 'review: no feedback memory yet for this repository'
    }
    case 'pr': {
      const ref = prRefOf(rest.join(' '))
      if (ref === null) return 'review: usage: /diff-review pr <number|url|owner/repo#number>'
      const n = ref.number
      state.prNumber = n
      state.prRepo = ref.nameWithOwner || null
      state.model.footer = ref.nameWithOwner ? `loading ${ref.nameWithOwner}#${n}` : `loading PR #${n}`
      state.scrollTop = 0
      if (!state.isOpen) await openPane(state, $); else await refresh(state, $)
      return statusText(state)
    }
    case 'branch':
      state.prNumber = null
      state.prRepo = null
      await refresh(state, $)
      return statusText(state)
    case 'base': {
      if (state.prNumber !== null) return 'review: base override applies to branch mode only'
      if (!state.model.target) await openPane(state, $)
      if (state.model.target) {
        await $.store.set(baseKey(state.model.target.toplevel, state.model.target.branch), rest.join(' '))
        await refresh(state, $)
      }
      return statusText(state)
    }
    default:
      await openPane(state, $)
      return statusText(state)
  }
}

export const register: Register = (on, options) => {
  const state = newState()
  if (typeof options.reviewSkill === 'string' && options.reviewSkill.trim()) state.reviewSkill = options.reviewSkill.trim()

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'diff-review',
      description: 'Review the branch diff with draft comments; send them as a pending GitHub review',
      argumentHint: '[pr <number|url>|claude|risk|note <text>|memory [clear]|branch|close|refresh|send|clear|base <ref>]',
    })
    await $.tool.register({
      name: 'add_comment',
      description: 'Add a draft review comment on a line of the diff shown in the /diff-review pane. Drafts are triaged by the user before the review is sent. side RIGHT uses new-file line numbers (added or unchanged lines); LEFT uses old-file numbers (removed lines). One finding per call. Refused when the pane is closed or the line is not on the diff.',
      inputSchema: { type: 'object', required: ['path', 'line', 'body'], properties: {
        path: { type: 'string', description: 'Repository-relative path as shown in the review pane' },
        line: { type: 'integer', minimum: 1 },
        side: { type: 'string', enum: ['LEFT', 'RIGHT'], default: 'RIGHT' },
        body: { type: 'string', minLength: 1, maxLength: 4000 },
      } },
    })
    await $.tool.register({
      name: 'list_comments',
      description: 'List the open draft review comments in the /diff-review pane, grouped by file.',
      inputSchema: { type: 'object', properties: {} },
    })
    await $.tool.register({
      name: 'set_risk',
      description: 'Record the risk analysis of the diff shown in the /diff-review pane: overall level, summary, review dimensions that need human judgment, decisions for the reviewer, and a level per file. Low-risk files collapse in the pane; files sort by risk. Call once per analysis; a new call replaces the old one.',
      inputSchema: { type: 'object', required: ['level', 'summary', 'files'], properties: {
        level: { type: 'string', enum: ['low', 'medium', 'high'] },
        summary: { type: 'string', minLength: 1, maxLength: 1000 },
        dimensions: { type: 'array', items: { type: 'string' }, description: 'Review dimensions needing human judgment, e.g. architecture, security, data, tests' },
        decisions: { type: 'array', items: { type: 'string' }, description: 'Up to 5 decisions only the reviewer can make, one sentence each' },
        files: { type: 'array', items: { type: 'object', required: ['path', 'level'], properties: {
          path: { type: 'string' },
          level: { type: 'string', enum: ['low', 'medium', 'high'] },
          reason: { type: 'string', maxLength: 200 },
        } } },
      } },
    })
    await $.tool.register({
      name: 'get_diff',
      description: 'Read the diff shown in the /diff-review pane, with R<n>/L<n> line numbers that add_comment accepts. Optional path returns one file in full.',
      inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Repository-relative path; omit for the whole diff' } } },
    })
    if (e.isInteractive) {
      try {
        state.sessionId = await $.session.id()
        const run: Runner = runnerOf((argv, init) => $.process.run(argv, init))
        const top = await run(['git', '--no-optional-locks', 'rev-parse', '--show-toplevel'])
        if (top.ok) {
          const key = openKey(top.stdout.trim())
          const stored = (await $.store.get(key)) as OpenMarker | undefined
          if (stored && stored.sessionId === state.sessionId) {
            state.prNumber = stored.prNumber
            state.prRepo = stored.prRepo ?? null
            await openPane(state, $)
          } else if (stored) {
            await $.store.delete(key)
          }
        }
      } catch {}
    }
    return result
  })

  on('command.run', { command: 'diff-review' }, async ($, e, next) => {
    const passed = await next(e)
    return { ...passed, text: await answerCommand(state, $, e.args) }
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.requestId !== Names.PANE_ID) return next(e)
    const { Box, Text, Button, Input } = await $.ui.resolve(e)
    const layout = layoutOf(state, e.props.bodyColumns)
    return paneTree({ Box, Text, Button, Input }, state.model, state.store?.all() ?? [], layout, actionsOf(state, $), e.props.bodyColumns, { path: state.cursorPath, commentId: state.cursorCommentId }, { offset: state.scrollTop, bodyRows: e.props.scroll.bodyRows }, (w, bodyCount) => { state.bodyCount = bodyCount; state.contentRows = w.total; state.columns = e.props.bodyColumns })
  })

  on('ui.close', { id: 'diff-review' }, async ($, e, next) => {
    await clearOpenState(state, $)
    state.model.editing = null
    return next(e)
  })

  on('ui.scroll', { requestId: 'diff-review' }, async ($, e) => {
    scrollBy(state, $, e.by)
    return {}
  })

  on('ui.focus', { plugin: 'diff-review' }, async ($, e, next) => {
    if (e.element?.startsWith('h:')) { state.cursorPath = e.element.slice(2); state.cursorCommentId = null }
    if (e.element?.startsWith('e:') || e.element?.startsWith('d:')) state.cursorCommentId = e.element.slice(2)
    if (e.element) revealKey(state, $, e.element)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (state.chain?.isArmed) {
      state.chain.turnId = e.turnId
      state.chain.isArmed = false
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const chain = state.chain
    if (chain && e.agentId === undefined && e.turnId === chain.turnId) {
      chain.turnId = null
      if (e.reason !== 'answer') {
        state.chain = null
        state.model.footer = `claude review stopped: ${chain.label} ended (${e.reason})`
        redraw(state, $)
      } else {
        $.clock.after(REDRAW_MS, () => { if (state.chain === chain) runChainStep(state, $) })
      }
    }
    return next(e)
  })

  on('tool.call', { tool: EDIT_TOOLS }, async ($, e, next) => {
    const result = await next(e)
    scheduleRefresh(state, $)
    return result
  })

  on('tool.call', { tool: 'mcp__diff-review__add_comment' }, async ($, e) => {
    const a = await serveAddComment(e as unknown as Record<string, unknown>, { store: state.store, files: state.model.files, isOpen: state.isOpen })
    if (a.ok) redraw(state, $)
    return a.ok ? { result: a.text } : { deny: a.text }
  })

  on('tool.call', { tool: 'mcp__diff-review__set_risk' }, async ($, e) => {
    const a = serveSetRisk(e as unknown as Record<string, unknown>, { store: state.store, files: state.model.files, isOpen: state.isOpen, headSha: state.model.target?.headSha })
    if (a.ok && a.risk) await applyRisk(state, $, a.risk)
    return a.ok ? { result: a.text } : { deny: a.text }
  })

  on('tool.call', { tool: 'mcp__diff-review__get_diff' }, async ($, e) => {
    const a = serveGetDiff(e as unknown as Record<string, unknown>, { store: state.store, files: state.model.files, isOpen: state.isOpen, isDiffTruncated: state.model.isDiffTruncated })
    return a.ok ? { result: a.text } : { deny: a.text }
  })

  on('tool.call', { tool: 'mcp__diff-review__list_comments' }, async () => {
    const a = serveListComments({ store: state.store, files: state.model.files, isOpen: state.isOpen })
    return a.ok ? { result: a.text } : { deny: a.text }
  })
}
