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

export async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getApiKey()}`,
      ...options?.headers,
    },
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
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
  analytics?: GateAnalytics
}

/** Shape returned by GET /api/engagement-gates/:id — analytics is guaranteed present. */
export type EngagementGateWithAnalytics = EngagementGate & { analytics: GateAnalytics }

export const engagementGatesApi = {
  list: async (): Promise<EngagementGate[]> => {
    const res = await fetchApi<ApiResponse<EngagementGate[]>>('/api/engagement-gates')
    return res.data ?? []
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
