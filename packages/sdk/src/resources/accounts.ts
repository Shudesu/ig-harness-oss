import type { HttpClient } from '../http.js'
import type { ApiResponse, IgAccount, AddIgAccountInput, AccountConnectionReport } from '../types.js'

/**
 * Instagram account management. Adding/deactivating requires the owner role;
 * listing requires owner or admin. Tokens are always returned masked.
 */
export class AccountsResource {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<IgAccount[]> {
    const res = await this.http.get<ApiResponse<IgAccount[]>>('/api/accounts')
    return res.data
  }

  async add(input: AddIgAccountInput): Promise<IgAccount & { verification?: string }> {
    const res = await this.http.post<ApiResponse<IgAccount & { verification?: string }>>('/api/accounts', input)
    return res.data
  }

  /** "解除": deactivate the account (the default account cannot be deactivated). Data is kept. */
  async deactivate(id: string): Promise<IgAccount> {
    const res = await this.http.patch<ApiResponse<IgAccount>>(`/api/accounts/${encodeURIComponent(id)}`, { isActive: false })
    return res.data
  }

  async reactivate(id: string): Promise<IgAccount> {
    const res = await this.http.patch<ApiResponse<IgAccount>>(`/api/accounts/${encodeURIComponent(id)}`, { isActive: true })
    return res.data
  }

  async connection(id: string): Promise<AccountConnectionReport | null> {
    const res = await this.http.get<ApiResponse<AccountConnectionReport | null>>(`/api/accounts/${encodeURIComponent(id)}/connection`)
    return res.data
  }

  /** Re-run the webhook/permission check; subscribe=true also re-runs subscribed_apps. */
  async checkConnection(id: string, options: { subscribe?: boolean } = {}): Promise<AccountConnectionReport> {
    const res = await this.http.post<ApiResponse<AccountConnectionReport>>(`/api/accounts/${encodeURIComponent(id)}/connection-check`, { subscribe: options.subscribe === true })
    return res.data
  }

  /**
   * B-07: connection-health contract. Single account, or all accounts when
   * id is omitted (returns { accounts, nextActions }). refresh=true re-runs
   * the Graph-backed probes immediately.
   */
  async connectionHealth(id?: string, options: { refresh?: boolean } = {}): Promise<unknown> {
    if (id) {
      const res = await this.http.get<ApiResponse<unknown>>(
        `/api/connection-health?account_id=${encodeURIComponent(id)}${options.refresh ? '&refresh=true' : ''}`,
      )
      return res.data
    }
    const res = await this.http.get<ApiResponse<unknown>>(`/api/connection-health${options.refresh ? '?refresh=true' : ''}`)
    return res.data
  }

  /** B-08: read the app-side webhook subscriptions for the account's app. */
  async appWebhook(id: string): Promise<unknown> {
    const res = await this.http.get<ApiResponse<unknown>>(`/api/accounts/${encodeURIComponent(id)}/app-webhook`)
    return res.data
  }

  /** B-09: repair the app-side subscription (owner, approval required). Refuses a foreign callback URL. */
  async fixAppWebhook(id: string): Promise<unknown> {
    const res = await this.http.post<ApiResponse<unknown>>(`/api/accounts/${encodeURIComponent(id)}/fix-app-webhook`, {})
    return res.data
  }

  /**
   * B-01: update existing credentials (owner). Only sent fields change; the
   * response never echoes secrets (masked tokens, hasAppSecret booleans).
   */
  async update(id: string, input: { accessToken?: string; appSecret?: string; verifyToken?: string; isActive?: boolean }): Promise<IgAccount> {
    const res = await this.http.patch<ApiResponse<IgAccount>>(`/api/accounts/${encodeURIComponent(id)}`, input)
    return res.data
  }
}
