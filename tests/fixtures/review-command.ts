import type { CommandRunInput } from 'claude-code'

export const review = (args = ''): CommandRunInput => ({ command: 'diff-review', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
