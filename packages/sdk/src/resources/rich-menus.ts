import type { HttpClient } from '../http.js'
import type { ApiResponse, CreateRichMenuInput, RichMenu } from '../types.js'

export class RichMenusResource {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<RichMenu[]> {
    const res = await this.http.get<ApiResponse<RichMenu[]>>('/api/rich-menus')
    return res.data
  }

  async create(input: CreateRichMenuInput): Promise<RichMenu> {
    const res = await this.http.post<ApiResponse<RichMenu>>('/api/rich-menus', input)
    return res.data
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/rich-menus/${id}`)
  }

  async setDefault(id: string): Promise<void> {
    await this.http.post(`/api/rich-menus/${id}/default`, {})
  }

  async uploadImage(id: string, imageData: string, contentType: string): Promise<void> {
    await this.http.post(`/api/rich-menus/${id}/image`, { imageData, contentType })
  }
}
