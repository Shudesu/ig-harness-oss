import type {
  Tag,
  CommentRule,
  ApiResponse,
  StaffMember,
} from '@ig-harness/shared'

const API_URL = process.env.NEXT_PUBLIC_API_URL
if (!API_URL) {
  throw new Error(
    'NEXT_PUBLIC_API_URL is not set. Build cannot proceed without a valid API URL. ' +
    'Set it in .env.production (local) or GitHub Secrets (CI).'
  )
}

/**
 * Read the API key from localStorage (set during login).
 */
function getApiKey(): string {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('lh_api_key') || ''
  }
  return ''
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getApiKey()}`,
      ...options?.headers,
    },
  })
  if (!res.ok) {
    // Surface the server's `error` field when possible — otherwise operators
    // only see "API error: 400" with no hint why validation failed.
    let detail = ''
    try {
      const body = await res.clone().json() as { error?: string }
      if (body && typeof body.error === 'string') detail = body.error
    } catch {
      try {
        detail = (await res.text()).slice(0, 200)
      } catch {
        // ignore
      }
    }
    const message = detail ? `API error ${res.status}: ${detail}` : `API error: ${res.status}`
    throw new ApiError(res.status, message)
  }
  return res.json() as Promise<T>
}

// ── Follower types (serialized by the worker's friends route) ──

export interface FollowerApi {
  id: string
  igsid: string | null
  username: string | null
  displayName: string | null
  pictureUrl: string | null
  isFollowing: boolean
  score: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
  tags: Tag[]
}

export type FollowerListResponse = {
  items: FollowerApi[]
  total: number
  page: number
  limit: number
  hasNextPage: boolean
}

export type FollowerListParams = {
  offset?: string
  limit?: string
  tagId?: string
  search?: string
}

// ── Engagement Gate (Campaign) types — wire format is snake_case ──

export interface GateAnalytics {
  triggered: number
  cta_sent: number
  pending_follow: number
  delivered: number
  dropped: number
  follow_rate: number
  line_linked: number
  clicks_total: number
  clicks_unique: number
}

export interface EngagementGate {
  id: string
  name: string
  status: 'active' | 'paused' | 'archived'
  trigger_type: 'comment_on_post' | 'dm_keyword' | 'story_mention'
  target_post_id: string | null
  trigger_keyword: string | null
  require_follow: number
  initial_dm_text: string
  initial_dm_button_label: string
  follow_reminder_dm_text: string
  follow_reminder_button_label: string
  reward_dm_text: string
  reward_url: string | null
  max_loops: number
  initial_dm_rich_message_id?: string | null
  reward_dm_rich_message_id?: string | null
  follow_reminder_dm_rich_message_id?: string | null
  comment_reply_text?: string | null
  followup_dm_sequence?: string | null
  /** LINE Harness cross-link binding. When set, reward DM URLs are auto
   *  rewritten through a LINE Harness tracked link so IG↔LINE userId is
   *  captured on click. */
  line_connection_id?: string | null
  line_pool_slug?: string | null
  line_tracked_link_short?: string | null
  target_post_ids?: string[]
  analytics?: GateAnalytics
}

/** Map returned by GET /api/engagement-gates/post-coverage */
export type PostCoverage = Record<
  string,
  Array<{ gate_id: string; gate_name: string; status: string }>
>


export type RichMessageKind = 'cta' | 'reward' | 'reminder' | 'generic'

export type RichMessageButton =
  | { type: 'postback'; label: string; payload: string }
  | { type: 'url'; label: string; url: string }

export type RichMessageBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; alt?: string }
  | {
      type: 'card'
      title: string
      subtitle?: string
      image_url?: string
      default_url?: string
      buttons: RichMessageButton[]
    }
  | {
      type: 'carousel'
      cards: Array<{
        title: string
        subtitle?: string
        image_url?: string
        default_url?: string
        buttons: RichMessageButton[]
      }>
    }
  | {
      type: 'quick_replies'
      text: string
      replies: Array<{ label: string; payload: string }>
    }

export interface RichMessage {
  id: string
  name: string
  kind: RichMessageKind
  blocks: RichMessageBlock[]
  created_at: string
  updated_at: string
}

export const richMessagesApi = {
  list: async (params: { limit?: number; kind?: RichMessageKind } = {}): Promise<RichMessage[]> => {
    const qs = new URLSearchParams()
    // Backend default is 50; pass the max supported (200) so management
    // screens and usage-scan code see every row without bespoke pagination.
    qs.set('limit', String(Math.min(params.limit ?? 200, 200)))
    if (params.kind) qs.set('kind', params.kind)
    const res = await fetchApi<ApiResponse<RichMessage[]>>(`/api/rich-messages?${qs.toString()}`)
    return res.data ?? []
  },
  get: async (id: string): Promise<RichMessage | null> => {
    try {
      const res = await fetchApi<ApiResponse<RichMessage>>(`/api/rich-messages/${id}`)
      return res.data ?? null
    } catch (err) {
      // Only collapse a genuine 404 to null — auth failures, 500s, and
      // network errors should surface to the caller.
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  },
  create: async (input: { name: string; kind: RichMessageKind; blocks: RichMessageBlock[] }): Promise<RichMessage> => {
    const res = await fetchApi<ApiResponse<RichMessage>>('/api/rich-messages', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    if (!res.data) throw new Error(res.error || 'Failed to create rich message')
    return res.data
  },
  update: async (
    id: string,
    patch: Partial<{ name: string; kind: RichMessageKind; blocks: RichMessageBlock[] }>,
  ): Promise<RichMessage> => {
    const res = await fetchApi<ApiResponse<RichMessage>>(`/api/rich-messages/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    if (!res.data) throw new Error(res.error || 'Failed to update rich message')
    return res.data
  },
  remove: async (id: string, force = false): Promise<void> => {
    const suffix = force ? '?force=1' : ''
    await fetchApi<ApiResponse<null>>(`/api/rich-messages/${id}${suffix}`, { method: 'DELETE' })
  },
  testSend: async (
    id: string,
    body: { to_igsid: string; reward_url?: string; follower_username?: string },
  ): Promise<{ sent_blocks: number; sent_at: string }> => {
    const res = await fetchApi<ApiResponse<{ sent_blocks: number; sent_at: string }>>(
      `/api/rich-messages/${id}/test-send`,
      { method: 'POST', body: JSON.stringify(body) },
    )
    if (!res.data) throw new Error(res.error || 'test-send failed')
    return res.data
  },
}

export interface UploadedImageItem {
  key: string
  url: string
  size: number
  uploaded: string
  content_type: string
  original_filename?: string
}

export interface MediaItem {
  id: string
  caption?: string
  media_type: string
  media_product_type?: string
  media_url?: string
  thumbnail_url?: string
  permalink: string
  timestamp: string
}

export const postsApi = {
  listMyMedia: async (
    params: { productType?: 'REELS' | 'FEED' | 'STORY' | 'all'; limit?: number } = {},
  ): Promise<MediaItem[]> => {
    const qs = new URLSearchParams()
    if (params.productType) qs.set('product_type', params.productType)
    if (params.limit) qs.set('limit', String(params.limit))
    const res = await fetchApi<ApiResponse<MediaItem[]>>(
      `/api/posts/my-media${qs.toString() ? `?${qs.toString()}` : ''}`,
    )
    return res.data ?? []
  },
}

// ── LINE Harness integration (X Harness-style multi-connection) ──

export interface LineConnection {
  id: string
  name: string
  worker_url: string
  api_key_masked: string
  account_id: string | null
  is_default: boolean
  created_at: string
  updated_at: string
}

export interface LineHarnessTrackedLink {
  id: string
  name: string
  originalUrl: string
  trackingUrl: string
  tagId: string | null
  scenarioId: string | null
  isActive: boolean
  clickCount: number
  createdAt: string
  updatedAt: string
}

export interface LineHarnessPool {
  id: string
  slug: string
  name: string
}

export const lineConnectionsApi = {
  list: async (): Promise<LineConnection[]> => {
    const res = await fetchApi<ApiResponse<LineConnection[]>>('/api/line-connections')
    return res.data ?? []
  },
  create: async (input: {
    name: string
    worker_url: string
    api_key: string
    account_id?: string | null
    is_default?: boolean
  }): Promise<LineConnection> => {
    const res = await fetchApi<ApiResponse<LineConnection>>('/api/line-connections', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    if (!res.data) throw new Error('create failed')
    return res.data
  },
  remove: async (id: string): Promise<void> => {
    await fetchApi<ApiResponse<null>>(`/api/line-connections/${id}`, { method: 'DELETE' })
  },
  setDefault: async (id: string): Promise<void> => {
    await fetchApi<ApiResponse<null>>(`/api/line-connections/${id}/set-default`, {
      method: 'POST',
    })
  },
  test: async (id: string): Promise<{ success: boolean; error?: string; message?: string }> => {
    try {
      const res = await fetchApi<ApiResponse<{ message: string }>>(
        `/api/line-connections/${id}/test`,
        { method: 'POST' },
      )
      return { success: true, message: res.data?.message }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  },
  listTrackedLinks: async (connectionId: string): Promise<LineHarnessTrackedLink[]> => {
    const res = await fetchApi<ApiResponse<LineHarnessTrackedLink[]>>(
      `/api/line-connections/${connectionId}/tracked-links`,
    )
    return res.data ?? []
  },
  createTrackedLink: async (
    connectionId: string,
    input: { name: string; originalUrl: string },
  ): Promise<LineHarnessTrackedLink> => {
    const res = await fetchApi<ApiResponse<LineHarnessTrackedLink>>(
      `/api/line-connections/${connectionId}/tracked-links`,
      { method: 'POST', body: JSON.stringify(input) },
    )
    if (!res.data) throw new Error('tracked link create failed')
    return res.data
  },
  listTrafficPools: async (connectionId: string): Promise<LineHarnessPool[]> => {
    const res = await fetchApi<ApiResponse<LineHarnessPool[]>>(
      `/api/line-connections/${connectionId}/traffic-pools`,
    )
    return res.data ?? []
  },
}

export const imagesApi = {
  list: async (cursor?: string, limit = 100): Promise<{ items: UploadedImageItem[]; cursor: string | null }> => {
    const qs = new URLSearchParams({ limit: String(limit) })
    if (cursor) qs.set('cursor', cursor)
    const res = await fetchApi<ApiResponse<{ items: UploadedImageItem[]; cursor: string | null }>>(
      `/api/images?${qs.toString()}`,
    )
    if (!res.data) return { items: [], cursor: null }
    return res.data
  },
  /**
   * Exhaustively page through the R2 listing up to `maxPages`. R2 returns
   * keys in lexicographic order, not upload time, so to present a complete
   * gallery we must follow the cursor until it runs out.
   */
  listAll: async (maxPages = 20, pageSize = 200): Promise<UploadedImageItem[]> => {
    const out: UploadedImageItem[] = []
    let cursor: string | undefined
    for (let page = 0; page < maxPages; page++) {
      const res = await imagesApi.list(cursor, pageSize)
      out.push(...res.items)
      if (!res.cursor) break
      cursor = res.cursor
    }
    return out
  },
  upload: async (file: File): Promise<{ key: string; url: string }> => {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    const mimeMatch = base64.match(/^data:([^;]+);base64,/)
    const mimeType = mimeMatch?.[1] || file.type || 'image/png'
    const payload = base64.split(',')[1] ?? base64
    const res = await fetchApi<ApiResponse<{ key: string; url: string }>>('/api/images', {
      method: 'POST',
      body: JSON.stringify({ data: payload, mimeType, filename: file.name }),
    })
    if (!res.data) throw new Error(res.error || 'upload failed')
    return res.data
  },
  remove: async (key: string): Promise<void> => {
    await fetchApi<ApiResponse<null>>(`/api/images/${key}`, { method: 'DELETE' })
  },
}

/** Shape returned by GET /api/engagement-gates/:id — analytics is guaranteed present. */
export type EngagementGateWithAnalytics = EngagementGate & { analytics: GateAnalytics }

export const engagementGatesApi = {
  list: async (): Promise<EngagementGate[]> => {
    const res = await fetchApi<ApiResponse<EngagementGate[]>>('/api/engagement-gates')
    return res.data ?? []
  },
  postCoverage: async (): Promise<PostCoverage> => {
    const res = await fetchApi<ApiResponse<PostCoverage>>('/api/engagement-gates/post-coverage')
    return res.data ?? {}
  },
  get: async (id: string): Promise<EngagementGateWithAnalytics> => {
    const res = await fetchApi<ApiResponse<EngagementGateWithAnalytics>>(`/api/engagement-gates/${id}`)
    if (!res.data) throw new Error(res.error || 'Failed to fetch engagement gate')
    return res.data
  },
  create: async (data: Partial<EngagementGate>): Promise<EngagementGate> => {
    const res = await fetchApi<ApiResponse<EngagementGate>>('/api/engagement-gates', {
      method: 'POST',
      body: JSON.stringify(data),
    })
    if (!res.data) throw new Error(res.error || 'Failed to create engagement gate')
    return res.data
  },
  update: async (id: string, patch: Partial<EngagementGate>): Promise<EngagementGate> => {
    const res = await fetchApi<ApiResponse<EngagementGate>>(`/api/engagement-gates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    if (!res.data) throw new Error(res.error || 'Failed to update engagement gate')
    return res.data
  },
  delete: async (id: string): Promise<void> => {
    await fetchApi<ApiResponse<null>>(`/api/engagement-gates/${id}`, { method: 'DELETE' })
  },
}

// ── Scenario types (aligned with worker's scenarios route) ──

export interface ScenarioApi {
  id: string
  name: string
  description: string | null
  triggerType: string
  triggerTagId: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  stepCount?: number
}

export const api = {
  followers: {
    // The worker still serves these at /api/friends
    list: (params?: FollowerListParams) => {
      const query: Record<string, string> = {}
      if (params?.offset) query.offset = params.offset
      if (params?.limit) query.limit = params.limit
      if (params?.tagId) query.tagId = params.tagId
      if (params?.search) query.search = params.search
      return fetchApi<ApiResponse<FollowerListResponse>>(
        '/api/friends?' + new URLSearchParams(query)
      )
    },
    get: (id: string) =>
      fetchApi<ApiResponse<FollowerApi>>(`/api/friends/${id}`),
    count: () =>
      fetchApi<ApiResponse<{ count: number }>>('/api/friends/count'),
    addTag: (followerId: string, tagId: string) =>
      fetchApi<ApiResponse<null>>(`/api/friends/${followerId}/tags`, {
        method: 'POST',
        body: JSON.stringify({ tagId }),
      }),
    removeTag: (followerId: string, tagId: string) =>
      fetchApi<ApiResponse<null>>(`/api/friends/${followerId}/tags/${tagId}`, {
        method: 'DELETE',
      }),
  },
  tags: {
    list: () =>
      fetchApi<ApiResponse<Tag[]>>('/api/tags'),
    create: (data: { name: string; color: string }) =>
      fetchApi<ApiResponse<Tag>>('/api/tags', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/tags/${id}`, { method: 'DELETE' }),
  },
  commentRules: {
    list: () =>
      fetchApi<ApiResponse<CommentRule[]>>('/api/comment-rules'),
    get: (id: string) =>
      fetchApi<ApiResponse<CommentRule>>(`/api/comment-rules/${id}`),
    create: (data: Omit<CommentRule, 'id' | 'createdAt' | 'updatedAt'>) =>
      fetchApi<ApiResponse<CommentRule>>('/api/comment-rules', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Omit<CommentRule, 'id' | 'createdAt' | 'updatedAt'>>) =>
      fetchApi<ApiResponse<CommentRule>>(`/api/comment-rules/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/comment-rules/${id}`, { method: 'DELETE' }),
    toggle: (id: string, isActive: boolean) =>
      fetchApi<ApiResponse<CommentRule>>(`/api/comment-rules/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive }),
      }),
  },
  scenarios: {
    list: () =>
      fetchApi<ApiResponse<ScenarioApi[]>>('/api/scenarios'),
    get: (id: string) =>
      fetchApi<ApiResponse<ScenarioApi>>(`/api/scenarios/${id}`),
    create: (data: { name: string; triggerType: string; triggerTagId?: string | null; isActive: boolean }) =>
      fetchApi<ApiResponse<ScenarioApi>>('/api/scenarios', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: { isActive?: boolean; name?: string; triggerType?: string }) =>
      fetchApi<ApiResponse<ScenarioApi>>(`/api/scenarios/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/scenarios/${id}`, { method: 'DELETE' }),
  },
  staff: {
    me: () =>
      fetchApi<ApiResponse<{ id: string; name: string; role: string }>>('/api/staff/me'),
    list: () =>
      fetchApi<ApiResponse<StaffMember[]>>('/api/staff'),
  },
}
