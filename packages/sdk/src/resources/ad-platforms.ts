import type { HttpClient } from '../http.js'
import type {
  AdPlatform,
  AdPlatformName,
  ApiResponse,
  ConversionLog,
  CreateAdPlatformInput,
  UpdateAdPlatformInput,
} from '../types.js'

export class AdPlatformsResource {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<AdPlatform[]> {
    const res = await this.http.get<ApiResponse<AdPlatform[]>>('/api/ad-platforms')
    return res.data
  }

  async create(input: CreateAdPlatformInput): Promise<AdPlatform> {
    const res = await this.http.post<ApiResponse<AdPlatform>>('/api/ad-platforms', input)
    return res.data
  }

  async update(id: string, input: UpdateAdPlatformInput): Promise<AdPlatform> {
    const res = await this.http.patch<ApiResponse<AdPlatform>>(`/api/ad-platforms/${id}`, input)
    return res.data
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/ad-platforms/${id}`)
  }

  async test(
    name: AdPlatformName,
    eventName: string,
    friendId?: string,
  ): Promise<{ success: boolean; error?: string }> {
    const res = await this.http.post<ApiResponse<{ success: boolean; error?: string }>>(
      '/api/ad-platforms/test',
      { name, eventName, friendId },
    )
    return res.data
  }

  async getLogs(platformId: string, limit = 50): Promise<ConversionLog[]> {
    const res = await this.http.get<ApiResponse<ConversionLog[]>>(
      `/api/ad-platforms/${platformId}/logs?limit=${limit}`,
    )
    return res.data
  }
}
