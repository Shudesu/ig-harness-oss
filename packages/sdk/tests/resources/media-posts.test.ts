import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpClient } from '../../src/http.js'
import { MediaPostsResource } from '../../src/resources/media-posts.js'

afterEach(() => vi.unstubAllGlobals())

describe('MediaPostsResource reel cover', () => {
  it.each([
    { options: { coverUrl: 'https://example.com/c.jpg' }, wire: { cover_url: 'https://example.com/c.jpg' } },
    { options: { thumbOffset: 0 }, wire: { thumb_offset: 0 } },
  ])('serializes $options into the HTTP contract', async ({ options, wire }) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ success: true, data: { id: 'post-1' } }))
    vi.stubGlobal('fetch', fetchMock)
    const posts = new MediaPostsResource(new HttpClient({ baseUrl: 'https://example.com', apiKey: 'test-key', timeout: 5000 }))
    await posts.create({
      postType: 'reel', media: [{ url: 'https://example.com/v.mp4', type: 'video', ...options }],
      scheduledAt: '2026-09-07T09:00:00+09:00',
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.media[0]).toEqual({ url: 'https://example.com/v.mp4', type: 'video', ...wire })
    expect(body.scheduled_at).toBe('2026-09-07T09:00:00+09:00')
  })
})
