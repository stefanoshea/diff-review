import type { On } from 'claude-code'
import { mock, type MockClock } from 'claude-code/testing'

export function startsSession(on: On, now = 0): MockClock {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__diff-review__${e.name}` } }))
  return mock.clock(on, { now })
}
