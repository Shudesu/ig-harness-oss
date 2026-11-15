import { describe, it, expect, vi } from 'vitest'
import { AccountsResource } from '../../src/resources/accounts.js'
import type { HttpClient } from '../../src/http.js'

const http = (o: Partial<HttpClient> = {}) => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), ...o }) as unknown as HttpClient

describe('AccountsResource', () => {
  it('list/add/deactivate/checkConnection hit the account endpoints', async () => {
    const h = http({
      get: vi.fn().mockResolvedValue({ success: true, data: [] }),
      post: vi.fn().mockResolvedValue({ success: true, data: { id: 'x' } }),
      patch: vi.fn().mockResolvedValue({ success: true, data: { id: 'x', isActive: false } }),
    })
    const r = new AccountsResource(h)
    await r.list()
    expect(h.get).toHaveBeenCalledWith('/api/accounts')
    await r.add({ accessToken: 't', subscribeWebhooks: true })
    expect(h.post).toHaveBeenCalledWith('/api/accounts', { accessToken: 't', subscribeWebhooks: true })
    await r.deactivate('a/b')
    expect(h.patch).toHaveBeenCalledWith('/api/accounts/a%2Fb', { isActive: false })
    await r.checkConnection('x', { subscribe: true })
    expect(h.post).toHaveBeenLastCalledWith('/api/accounts/x/connection-check', { subscribe: true })
    await r.connection('x')
    expect(h.get).toHaveBeenLastCalledWith('/api/accounts/x/connection')
  })
})
