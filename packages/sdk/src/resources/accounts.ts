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
}
