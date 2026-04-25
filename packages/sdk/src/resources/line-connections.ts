import type { HttpClient } from '../http.js'
import type {
  ApiResponse,
  CreateLineConnectionInput,
  LineConnection,
  LineHarnessPool,
  LineHarnessTrackedLink,
  UpdateLineConnectionInput,
} from '../types.js'

/**
 * LINE Harness multi-connection registry. Each row is a single LINE
 * Harness deployment (本番 / テスト / アカウント別) the IG Harness can
 * proxy outbound friend-add traffic into. Engagement gates reference a
 * connection by id + optionally a traffic-pool slug; cross-link clicks
 * land on `<worker_url>/r/<short>?ig=<IGSID>&pool=<slug>` and LINE
 * Harness writes `friends.ig_igsid` for attribution.
 *
 * The two `list*` proxy methods (tracked links + traffic pools) are
 * read-only views into the connected LINE Harness — IG Harness doesn't
 * own those resources, it only forwards Bearer-authed reads so the
 * admin UI / CC operator doesn't need a second API key.
 */
export class LineConnectionsResource {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<LineConnection[]> {
    const res = await this.http.get<ApiResponse<LineConnection[]>>('/api/line-connections')
    return res.data
  }

  async create(input: CreateLineConnectionInput): Promise<LineConnection> {
    const res = await this.http.post<ApiResponse<LineConnection>>(
      '/api/line-connections',
      input,
    )
    return res.data
  }

  /**
   * In-place update of a registered connection. The id is stable, so
   * existing engagement_gates referencing this connection keep working
   * after the patch — useful for rotating an `api_key` or correcting a
   * worker_url typo without touching every gate.
   */
  async update(id: string, patch: UpdateLineConnectionInput): Promise<LineConnection> {
    const res = await this.http.patch<ApiResponse<LineConnection>>(
      `/api/line-connections/${id}`,
      patch,
    )
    return res.data
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/line-connections/${id}`)
  }

  /**
   * Promote a connection to default. The default connection is preselected
   * by the campaign wizard and used as a fallback by background jobs that
   * don't carry an explicit connection_id.
   */
  async setDefault(id: string): Promise<void> {
    await this.http.post<ApiResponse<null>>(`/api/line-connections/${id}/set-default`, {})
  }

  /**
   * Probe the LINE Harness side with a 1-row friends list. Returns
   * `{ success: false, error }` instead of throwing so the caller can
   * surface an inline diagnostic without a try/catch dance.
   */
  async test(id: string): Promise<{ success: boolean; error?: string; message?: string }> {
    try {
      const res = await this.http.post<ApiResponse<{ message: string }>>(
        `/api/line-connections/${id}/test`,
        {},
      )
      return { success: true, message: res.data?.message }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async listTrackedLinks(connectionId: string): Promise<LineHarnessTrackedLink[]> {
    const res = await this.http.get<ApiResponse<LineHarnessTrackedLink[]>>(
      `/api/line-connections/${connectionId}/tracked-links`,
    )
    return res.data
  }

  async listTrafficPools(connectionId: string): Promise<LineHarnessPool[]> {
    const res = await this.http.get<ApiResponse<LineHarnessPool[]>>(
      `/api/line-connections/${connectionId}/traffic-pools`,
    )
    return res.data
  }
}
