import type { HttpClient } from '../http.js'
import type { ApiResponse, CommentRule, CreateCommentRuleInput, UpdateCommentRuleInput } from '../types.js'

export class CommentRulesResource {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<CommentRule[]> {
    const res = await this.http.get<ApiResponse<CommentRule[]>>('/api/comment-rules')
    return res.data
  }

  async get(id: string): Promise<CommentRule> {
    const res = await this.http.get<ApiResponse<CommentRule>>(`/api/comment-rules/${id}`)
    return res.data
  }

  async create(input: CreateCommentRuleInput): Promise<CommentRule> {
    const res = await this.http.post<ApiResponse<CommentRule>>('/api/comment-rules', input)
    return res.data
  }

  async update(id: string, input: UpdateCommentRuleInput): Promise<CommentRule> {
    const res = await this.http.put<ApiResponse<CommentRule>>(`/api/comment-rules/${id}`, input)
    return res.data
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/comment-rules/${id}`)
  }
}
