export const Names = {
  PLUGIN: 'diff-review',
  PANE_ID: 'diff-review',
  COMMAND: 'diff-review',
  TOOL_ADD: 'add_comment',
  TOOL_LIST: 'list_comments',
  TOOL_DIFF: 'get_diff',
  TOOL_RISK: 'set_risk',
  STORE_PREFIX: 'review:',
} as const

export const toolName = (short: string): `mcp__${string}__${string}` => `mcp__${Names.PLUGIN}__${short}`
