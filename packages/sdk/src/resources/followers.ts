import type { HttpClient } from '../http.js'
import type { ApiResponse, PaginatedData, Follower, FollowerListParams } from '../types.js'

export class FollowersResource {
  constructor(private readonly http: HttpClient) {}

  async list(params?: FollowerListParams): Promise<PaginatedData<Follower>> {
    const query = new URLSearchParams()
    // Worker uses limit/offset pagination (from friends.ts)
    if (params?.pageSize !== undefined) query.set('limit', String(params.pageSize))
    if (params?.page !== undefined) {
      const pageSize = params.pageSize ?? 20
      query.set('offset', String((params.page - 1) * pageSize))
    }
    if (params?.search) query.set('search', params.search)
    if (params?.tagId !== undefined) query.set('tagId', String(params.tagId))
    const qs = query.toString()
    const path = qs ? `/api/friends?${qs}` : '/api/friends'
    const res = await this.http.get<ApiResponse<PaginatedData<Follower>>>(path)
    return res.data
  }

  async get(id: string): Promise<Follower> {
    const res = await this.http.get<ApiResponse<Follower>>(`/api/friends/${id}`)
    return res.data
  }

  async count(): Promise<number> {
    const res = await this.http.get<ApiResponse<{ count: number }>>('/api/friends/count')
    return res.data.count
  }

  /**
   * Contacts count (DB rows: users who have interacted with the account)
   * alongside the account's real Instagram follower count. The two diverge in
   * both directions — silent followers never appear in the DB, and past
   * contacts stay after they unfollow — so they are reported separately.
   */
  async countDetails(): Promise<{
    contacts: number
    instagramFollowerCount: number | null
    instagramFollowerCountUpdatedAt: string | null
  }> {
    const res = await this.http.get<
      ApiResponse<{
        count: number
        instagramFollowerCount?: number | null
        instagramFollowerCountUpdatedAt?: string | null
      }>
    >('/api/friends/count')
    return {
      contacts: res.data.count,
      instagramFollowerCount: res.data.instagramFollowerCount ?? null,
      instagramFollowerCountUpdatedAt: res.data.instagramFollowerCountUpdatedAt ?? null,
    }
  }

  async addTag(followerId: string, tagId: string): Promise<void> {
    await this.http.post(`/api/friends/${followerId}/tags`, { tagId })
  }

  async removeTag(followerId: string, tagId: string): Promise<void> {
    await this.http.delete(`/api/friends/${followerId}/tags/${tagId}`)
  }

  async sendMessage(followerId: string, content: string, messageType = 'text'): Promise<{ messageId: string }> {
    const res = await this.http.post<ApiResponse<{ messageId: string }>>(
      `/api/friends/${followerId}/messages`,
      { messageType, content },
    )
    return res.data
  }

  async setMetadata(followerId: string, fields: Record<string, unknown>): Promise<Follower> {
    const res = await this.http.put<ApiResponse<Follower>>(
      `/api/friends/${followerId}/metadata`,
      fields,
    )
    return res.data
  }
}
