import type { HttpClient } from '../http.js'
import type { ApiResponse, Broadcast, CreateBroadcastInput, UpdateBroadcastInput, SegmentCondition } from '../types.js'

export class BroadcastsResource {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<Broadcast[]> {
    const res = await this.http.get<ApiResponse<Broadcast[]>>('/api/broadcasts')
    return res.data
  }

  async get(id: string): Promise<Broadcast> {
    const res = await this.http.get<ApiResponse<Broadcast>>(`/api/broadcasts/${id}`)
    return res.data
  }

  async create(input: CreateBroadcastInput): Promise<Broadcast> {
    const res = await this.http.post<ApiResponse<Broadcast>>('/api/broadcasts', broadcastPayload(input))
    return res.data
  }

  async update(id: string, input: UpdateBroadcastInput): Promise<Broadcast> {
    const res = await this.http.put<ApiResponse<Broadcast>>(`/api/broadcasts/${id}`, broadcastPayload(input))
    return res.data
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/broadcasts/${id}`)
  }

  async send(id: string): Promise<Broadcast> {
    const res = await this.http.post<ApiResponse<Broadcast>>(`/api/broadcasts/${id}/send`)
    return res.data
  }

  async sendToSegment(id: string, conditions: SegmentCondition): Promise<Broadcast> {
    throw new Error('Segment broadcasts are not supported by the Instagram API server; use a tag filter.');
  }
}

/** Normalize the historical SDK names to the worker contract at one boundary. */
export function broadcastPayload(input: CreateBroadcastInput | UpdateBroadcastInput): Record<string, unknown> {
  const value = input as any;
  if (value.messageType && !['text', 'image', 'template', 'quick_reply'].includes(value.messageType)) throw new Error('Unsupported Instagram broadcast message type');
  if (value.targetType && !['all', 'tag'].includes(value.targetType)) throw new Error('Unsupported Instagram broadcast target');
  const payload: Record<string, unknown> = {};
  if (value.name !== undefined || value.title !== undefined) payload.name = value.name ?? value.title;
  if (value.messageType !== undefined) payload.messageType = value.messageType;
  if (value.body !== undefined) payload.body = value.body;
  else if (value.messageContent !== undefined) payload.body = value.messageType === 'text' || value.messageType === undefined ? JSON.stringify({ text: value.messageContent }) : value.messageContent;
  if (value.tagFilter !== undefined) payload.tagFilter = value.tagFilter;
  else if (value.targetType === 'tag') {
    if (!value.targetTagId) throw new Error('targetTagId is required for tag broadcasts');
    payload.tagFilter = JSON.stringify({ tagId: value.targetTagId });
  } else if (value.targetType === 'all') payload.tagFilter = null;
  if (value.scheduledAt !== undefined) payload.scheduledAt = value.scheduledAt;
  return payload;
}
