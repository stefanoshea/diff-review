import type { TurnCompleteReason } from 'claude-code'
import type { Engine } from 'claude-code/testing'

export async function runTurn($: Engine, turnId: string, reason: Exclude<TurnCompleteReason, 'refusal'> = 'answer') {
  await $.turn.start({ text: '', turnId })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: reason === 'aborted', turnId, reason })
}
