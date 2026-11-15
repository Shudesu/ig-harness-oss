import type { HttpClient } from '../http.js'
import type { ApiResponse } from '../types.js'

/** B-19: ice breakers / persistent menu via the messenger_profile edge. */
export class MessengerProfileResource {
  constructor(private readonly http: HttpClient) {}

  /** fields: comma-separated, e.g. "ice_breakers,persistent_menu". */
  async get(fields = 'ice_breakers,persistent_menu'): Promise<Record<string, unknown>> {
    const res = await this.http.get<ApiResponse<Record<string, unknown>>>(`/api/messenger-profile?fields=${encodeURIComponent(fields)}`)
    return (res.data ?? {}) as Record<string, unknown>
  }

  async set(payload: Record<string, unknown>): Promise<unknown> {
    const res = await this.http.post<ApiResponse<unknown>>('/api/messenger-profile', payload)
    return res.data
  }

  /** fields: comma-separated field names to delete. */
  async delete(fields: string): Promise<unknown> {
    const res = await this.http.delete<ApiResponse<unknown>>(`/api/messenger-profile?fields=${encodeURIComponent(fields)}`)
    return res.data
  }
}
