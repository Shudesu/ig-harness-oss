import { describe, it, expect, vi } from 'vitest'
import { EngagementGatesResource } from '../../src/resources/engagement-gates.js'
import type { HttpClient } from '../../src/http.js'

function mockHttp(overrides: Partial<HttpClient> = {}): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  } as unknown as HttpClient
}

const sampleGate = {
  id: 'gate-1',
  name: 'Lead Magnet',
  status: 'active' as const,
  trigger_type: 'comment_on_post' as const,
  target_post_id: 'post_123',
  trigger_keyword: 'interested',
  require_follow: 1,
  initial_dm_text: 'Thanks for commenting!',
  initial_dm_button_label: '特典を受け取る',
  follow_reminder_dm_text: 'Please follow us',
  follow_reminder_button_label: 'フォローしたよ',
  reward_dm_text: 'Here is your reward',
  reward_url: 'https://example.com/reward',
  max_loops: 0,
  created_at: '2026-04-08T00:00:00Z',
  updated_at: '2026-04-08T00:00:00Z',
}

describe('EngagementGatesResource', () => {
  it('list() calls GET /api/engagement-gates and returns EngagementGate[]', async () => {
    const http = mockHttp({
      get: vi.fn().mockResolvedValue({ success: true, data: [sampleGate] }),
    })
    const resource = new EngagementGatesResource(http)
    const result = await resource.list()
    expect(http.get).toHaveBeenCalledWith('/api/engagement-gates')
    expect(result).toEqual([sampleGate])
  })

  it('create(input) calls POST /api/engagement-gates with input', async () => {
    const input = {
      name: 'Lead Magnet',
      trigger_type: 'comment_on_post' as const,
      target_post_id: 'post_123',
      trigger_keyword: 'interested',
      initial_dm_text: 'Thanks for commenting!',
      follow_reminder_dm_text: 'Please follow us',
      reward_dm_text: 'Here is your reward',
      reward_url: 'https://example.com/reward',
    }
    const http = mockHttp({
      post: vi.fn().mockResolvedValue({ success: true, data: sampleGate }),
    })
    const resource = new EngagementGatesResource(http)
    const result = await resource.create(input)
    expect(http.post).toHaveBeenCalledWith('/api/engagement-gates', input)
    expect(result).toEqual(sampleGate)
  })

  it('get(id) calls GET /api/engagement-gates/:id and returns gate with analytics', async () => {
    const withAnalytics = {
      ...sampleGate,
      analytics: {
        triggered: 10,
        cta_sent: 3,
        pending_follow: 2,
        delivered: 4,
        dropped: 1,
        follow_rate: 0.4,
        line_linked: 2,
      },
    }
    const http = mockHttp({
      get: vi.fn().mockResolvedValue({ success: true, data: withAnalytics }),
    })
    const resource = new EngagementGatesResource(http)
    const result = await resource.get('gate-1')
    expect(http.get).toHaveBeenCalledWith('/api/engagement-gates/gate-1')
    expect(result).toEqual(withAnalytics)
  })

  it('update(id, patch) calls PATCH /api/engagement-gates/:id with patch', async () => {
    const patch = { status: 'paused' as const }
    const updated = { ...sampleGate, status: 'paused' as const }
    const http = mockHttp({
      patch: vi.fn().mockResolvedValue({ success: true, data: updated }),
    })
    const resource = new EngagementGatesResource(http)
    const result = await resource.update('gate-1', patch)
    expect(http.patch).toHaveBeenCalledWith('/api/engagement-gates/gate-1', patch)
    expect(result).toEqual(updated)
  })

  it('delete(id) calls DELETE /api/engagement-gates/:id', async () => {
    const http = mockHttp({
      delete: vi.fn().mockResolvedValue({ success: true, data: null }),
    })
    const resource = new EngagementGatesResource(http)
    await resource.delete('gate-1')
    expect(http.delete).toHaveBeenCalledWith('/api/engagement-gates/gate-1')
  })

  it('listDeliveries(id) calls GET /api/engagement-gates/:id/deliveries', async () => {
    const deliveries = [
      {
        id: 'delivery-1',
        gate_id: 'gate-1',
        follower_id: 42,
        igsid: 'igsid_abc',
        status: 'delivered' as const,
        loop_count: 0,
        last_check_at: null,
        triggered_at: '2026-04-08T00:00:00Z',
        delivered_at: '2026-04-08T00:01:00Z',
        metadata: '{}',
      },
    ]
    const http = mockHttp({
      get: vi.fn().mockResolvedValue({ success: true, data: deliveries }),
    })
    const resource = new EngagementGatesResource(http)
    const result = await resource.listDeliveries('gate-1')
    expect(http.get).toHaveBeenCalledWith('/api/engagement-gates/gate-1/deliveries')
    expect(result).toEqual(deliveries)
  })
})
