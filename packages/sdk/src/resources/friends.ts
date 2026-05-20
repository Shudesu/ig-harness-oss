import type { HttpClient } from '../http.js'
import type { ApiResponse, Friend, FriendListParams, PaginatedData } from '../types.js'

export class FriendsResource {
  constructor(private readonly http: HttpClient) {}

  async list(params?: FriendListParams): Promise<PaginatedData<Friend>> {
    const query = new URLSearchParams()
    if (params?.limit !== undefined) query.set('limit', String(params.limit))
    if (params?.offset !== undefined) query.set('offset', String(params.offset))
    if (params?.tagId !== undefined) query.set('tagId', params.tagId)
    if (params?.search) query.set('search', params.search)
    if (params?.accountId) query.set('accountId', params.accountId)
    if (params?.metadata) {
      for (const [key, value] of Object.entries(params.metadata)) {
        query.set(`metadata[${key}]`, value)
      }
    }
    const qs = query.toString()
    const res = await this.http.get<ApiResponse<PaginatedData<Friend>>>(
      qs ? `/api/friends?${qs}` : '/api/friends',
    )
    return res.data
  }

  async get(id: string): Promise<Friend> {
    const res = await this.http.get<ApiResponse<Friend>>(`/api/friends/${id}`)
    return res.data
  }

  async count(): Promise<number> {
    const res = await this.http.get<ApiResponse<{ count: number }>>('/api/friends/count')
    return res.data.count
  }

  async addTag(friendId: string, tagId: string): Promise<void> {
    await this.http.post(`/api/friends/${friendId}/tags`, { tagId })
  }

  async removeTag(friendId: string, tagId: string): Promise<void> {
    await this.http.delete(`/api/friends/${friendId}/tags/${tagId}`)
  }

  async sendMessage(
    friendId: string,
    content: string,
    messageType = 'text',
    altText?: string,
  ): Promise<{ messageId: string }> {
    const res = await this.http.post<ApiResponse<{ messageId: string }>>(
      `/api/friends/${friendId}/messages`,
      { messageType, content, altText },
    )
    return res.data
  }

  async setMetadata(friendId: string, fields: Record<string, unknown>): Promise<Friend> {
    const res = await this.http.put<ApiResponse<Friend>>(
      `/api/friends/${friendId}/metadata`,
      fields,
    )
    return res.data
  }

  async setRichMenu(friendId: string, richMenuId: string): Promise<void> {
    await this.http.post(`/api/friends/${friendId}/rich-menu`, { richMenuId })
  }

  async removeRichMenu(friendId: string): Promise<void> {
    await this.http.delete(`/api/friends/${friendId}/rich-menu`)
  }
}
