import type { HttpClient } from '../http.js'
import type {
  ApiResponse,
  BulkApplyGatesInput,
  BulkApplyGatesResult,
  ReelInfo,
} from '../types.js'

export class PostsResource {
  constructor(private readonly http: HttpClient) {}

  async listMyReels(limit = 50): Promise<ReelInfo[]> {
    const res = await this.http.get<ApiResponse<ReelInfo[]>>(
      `/api/posts/my-reels?limit=${limit}`,
    )
    return res.data
  }

  async bulkApplyGates(input: BulkApplyGatesInput): Promise<BulkApplyGatesResult> {
    const res = await this.http.post<ApiResponse<BulkApplyGatesResult>>(
      '/api/posts/bulk-apply-gates',
      input,
    )
    return res.data
  }

  async getCommenters(mediaId: string, limit = 50): Promise<unknown[]> {
    const res = await this.http.get<ApiResponse<unknown[]>>(
      `/api/posts/${mediaId}/commenters?limit=${limit}`,
    )
    return res.data
  }
}
