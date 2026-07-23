import type { HttpClient } from '../http.js'
import type {
  ApiResponse,
  MediaPost,
  MediaPostStatus,
  CreateMediaPostInput,
  PublishingLimitInfo,
} from '../types.js'

export class MediaPostsResource {
  constructor(private readonly http: HttpClient) {}

  async create(input: CreateMediaPostInput): Promise<MediaPost> {
    const res = await this.http.post<ApiResponse<MediaPost>>('/api/media-posts', {
      post_type: input.postType,
      media: input.media,
      caption: input.caption,
      scheduled_at: input.scheduledAt,
    })
    return res.data
  }

  async list(opts: { status?: MediaPostStatus; limit?: number } = {}): Promise<MediaPost[]> {
    const params = new URLSearchParams()
    if (opts.status) params.set('status', opts.status)
    if (opts.limit) params.set('limit', String(opts.limit))
    const qs = params.toString()
    const res = await this.http.get<ApiResponse<MediaPost[]>>(
      `/api/media-posts${qs ? `?${qs}` : ''}`,
    )
    return res.data
  }

  async get(id: string): Promise<MediaPost> {
    const res = await this.http.get<ApiResponse<MediaPost>>(`/api/media-posts/${id}`)
    return res.data
  }

  async cancel(id: string): Promise<void> {
    await this.http.delete(`/api/media-posts/${id}`)
  }

  async publishNow(id: string): Promise<MediaPost> {
    const res = await this.http.post<ApiResponse<MediaPost>>(`/api/media-posts/${id}/publish-now`)
    return res.data
  }

  async publishingLimit(): Promise<PublishingLimitInfo> {
    const res = await this.http.get<ApiResponse<PublishingLimitInfo>>(
      '/api/media-posts/publishing-limit',
    )
    return res.data
  }
}
