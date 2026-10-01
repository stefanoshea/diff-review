import type { Side } from '../diff/types.ts'

export type Author = 'user' | 'claude'
export type Comment = { id: string; path: string; side: Side; line: number; startLine?: number; body: string; author: Author; createdAt: number; sentAt: number | null }
export type ReviewState = { comments: Comment[] }
