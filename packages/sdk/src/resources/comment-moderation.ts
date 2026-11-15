import type { HttpClient } from '../http.js'
import type { ApiResponse } from '../types.js'

export interface CommentModerationSettings {
  enabled: boolean
  words: string[]
  mediaIds: string[] | null
}

export interface HiddenCommentEntry {
  commentId: string
  mediaId: string | null
  username: string | null
  matchedWord: string
  textSnippet: string
  hiddenAt: string
  undoneAt: string | null
}

/** B-18: comment auto-hide (NG words / spam) with an undo path. */
export class CommentModerationResource {
  constructor(private readonly http: HttpClient) {}

  async get(): Promise<{ settings: CommentModerationSettings; hidden: HiddenCommentEntry[] }> {
    const res = await this.http.get<ApiResponse<{ settings: CommentModerationSettings; hidden: HiddenCommentEntry[] }>>('/api/comment-moderation')
    return res.data ?? { settings: { enabled: false, words: [], mediaIds: null }, hidden: [] }
  }

  async set(settings: { enabled: boolean; words: string[]; mediaIds?: string[] | null }): Promise<CommentModerationSettings> {
    const res = await this.http.put<ApiResponse<CommentModerationSettings>>('/api/comment-moderation', settings)
    return res.data
  }

  /** 元に戻す: un-hide a previously hidden comment. */
  async unhide(commentId: string): Promise<unknown> {
    const res = await this.http.post<ApiResponse<unknown>>('/api/comment-moderation/unhide', { commentId })
    return res.data
  }
}
