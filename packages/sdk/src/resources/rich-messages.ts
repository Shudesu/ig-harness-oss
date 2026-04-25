import type { HttpClient } from '../http.js'
import type {
  ApiResponse,
  CreateRichMessageInput,
  RichMessage,
  RichMessageKind,
  UpdateRichMessageInput,
} from '../types.js'

export class RichMessagesResource {
  constructor(private readonly http: HttpClient) {}

  async list(params: { kind?: RichMessageKind; limit?: number } = {}): Promise<RichMessage[]> {
    const qs = new URLSearchParams()
    if (params.kind) qs.set('kind', params.kind)
    if (params.limit !== undefined) qs.set('limit', String(params.limit))
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    const res = await this.http.get<ApiResponse<RichMessage[]>>(`/api/rich-messages${suffix}`)
    return res.data
  }

  async create(input: CreateRichMessageInput): Promise<RichMessage> {
    const res = await this.http.post<ApiResponse<RichMessage>>('/api/rich-messages', input)
    return res.data
  }

  async get(id: string): Promise<RichMessage> {
    const res = await this.http.get<ApiResponse<RichMessage>>(`/api/rich-messages/${id}`)
    return res.data
  }

  async update(id: string, patch: UpdateRichMessageInput): Promise<RichMessage> {
    const res = await this.http.patch<ApiResponse<RichMessage>>(`/api/rich-messages/${id}`, patch)
    return res.data
  }

  async delete(id: string, opts: { force?: boolean } = {}): Promise<void> {
    const suffix = opts.force ? '?force=1' : ''
    await this.http.delete(`/api/rich-messages/${id}${suffix}`)
  }

  async testSend(
    id: string,
    toIgsid: string,
    opts: { rewardUrl?: string; followerUsername?: string } = {},
  ): Promise<{ sent_blocks: number; sent_at: string }> {
    const res = await this.http.post<ApiResponse<{ sent_blocks: number; sent_at: string }>>(
      `/api/rich-messages/${id}/test-send`,
      {
        to_igsid: toIgsid,
        reward_url: opts.rewardUrl,
        follower_username: opts.followerUsername,
      },
    )
    return res.data
  }
}
