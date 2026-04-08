import type { HttpClient } from '../http.js'
import type {
  ApiResponse,
  CreateEngagementGateInput,
  EngagementGate,
  EngagementGateWithAnalytics,
  GateDelivery,
  UpdateEngagementGateInput,
} from '../types.js'

export class EngagementGatesResource {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<EngagementGate[]> {
    const res = await this.http.get<ApiResponse<EngagementGate[]>>('/api/engagement-gates')
    return res.data
  }

  async create(input: CreateEngagementGateInput): Promise<EngagementGate> {
    const res = await this.http.post<ApiResponse<EngagementGate>>('/api/engagement-gates', input)
    return res.data
  }

  async get(id: string): Promise<EngagementGateWithAnalytics> {
    const res = await this.http.get<ApiResponse<EngagementGateWithAnalytics>>(
      `/api/engagement-gates/${id}`,
    )
    return res.data
  }

  async update(id: string, patch: UpdateEngagementGateInput): Promise<EngagementGate> {
    const res = await this.http.patch<ApiResponse<EngagementGate>>(
      `/api/engagement-gates/${id}`,
      patch,
    )
    return res.data
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/engagement-gates/${id}`)
  }

  async listDeliveries(id: string): Promise<GateDelivery[]> {
    const res = await this.http.get<ApiResponse<GateDelivery[]>>(
      `/api/engagement-gates/${id}/deliveries`,
    )
    return res.data
  }
}
