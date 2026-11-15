import { createAppSecretProof } from './proof.js';
import { graphApiVersion } from './config.js';
export { DEFAULT_GRAPH_API_VERSION } from './config.js';
import { parseGraphUsage, type GraphObservation } from './usage.js';
import { InstagramApiError, InstagramTransportError } from './errors.js';
import type {
  SendTextPayload,
  SendImagePayload,
  SendTemplatePayload,
  SendQuickReplyPayload,
  GenericTemplateElement,
  QuickReplyItem,
  UserProfile,
  MediaInfo,
  RichMessageBlock,
  CardBlock,
  RichMessageContext,
  CreateContainerParams,
  ContainerStatus,
  PublishingLimit,
} from "./types.js";

export const MAX_RICH_MESSAGE_BLOCKS = 10;

/**
 * How the token was issued.
 * - instagram_login: Instagram API with Instagram Login (IGAA… tokens, graph.instagram.com)
 * - facebook_login: Instagram API with Facebook Login / Unified login (EAA… user or
 *   system-user tokens, graph.facebook.com). New Meta apps only offer this one.
 */
export type IgConnectionType = 'instagram_login' | 'facebook_login';
export const IG_CONNECTION_TYPES: readonly IgConnectionType[] = ['instagram_login', 'facebook_login'];

export function graphHost(connectionType: IgConnectionType = 'instagram_login'): string {
  return connectionType === 'facebook_login' ? 'https://graph.facebook.com' : 'https://graph.instagram.com';
}

/**
 * Best-effort token kind from its prefix. Facebook user / page / system-user
 * tokens start with "EAA"; Instagram Login tokens start with "IG" (IGAA/IGQV…).
 * Unknown prefixes return null so callers keep the historical default.
 */
export function detectTokenConnectionType(token: string): IgConnectionType | null {
  const value = token.trim();
  if (/^EAA/.test(value)) return 'facebook_login';
  if (/^IG/.test(value)) return 'instagram_login';
  return null;
}

/** Webhook fields subscribed per account; same field names for both login types. */
export const IG_WEBHOOK_FIELDS = ['messages', 'messaging_postbacks', 'messaging_referral', 'comments'] as const;

export class InstagramClient {
  private accessToken: string;
  private igUserId: string;
  private baseUrl: string;
  readonly connectionType: IgConnectionType;
  private pageId?: string;
  private timeoutMs: number;
  private maxReadRetries: number;
  private onResponse?: (observation: GraphObservation) => Promise<void> | void;
  private appSecret?: string;
  private beforeRequest?: () => Promise<void> | void;

  private transformMessage?: (recipientId: string, message: unknown, recipient: { id?: string; comment_id?: string }) => Promise<unknown>;

  constructor(opts: { connectionType?: IgConnectionType; pageId?: string | null; transformMessage?: (recipientId: string, message: unknown, recipient: { id?: string; comment_id?: string }) => Promise<unknown>; accessToken: string; igUserId: string; apiVersion?: string; timeoutMs?: number; maxReadRetries?: number; appSecret?: string; beforeRequest?: () => Promise<void> | void; onResponse?: (observation: GraphObservation) => Promise<void> | void }) {
    this.accessToken = opts.accessToken;
    this.transformMessage = opts.transformMessage;
    this.igUserId = opts.igUserId;
    const version = graphApiVersion(opts.apiVersion);
    this.appSecret = opts.appSecret;
    this.onResponse = opts.onResponse;
    this.beforeRequest = opts.beforeRequest;
    this.connectionType = opts.connectionType ?? 'instagram_login';
    if (!IG_CONNECTION_TYPES.includes(this.connectionType)) throw new Error('Invalid connection type');
    this.pageId = opts.pageId || undefined;
    this.baseUrl = `${graphHost(this.connectionType)}/${version}`;
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.maxReadRetries = opts.maxReadRetries ?? 2;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 30_000) throw new Error('Invalid request timeout');
    if (!Number.isInteger(this.maxReadRetries) || this.maxReadRetries < 0 || this.maxReadRetries > 3) throw new Error('Invalid retry count');
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    await this.beforeRequest?.();
    if (method === 'POST' && path.endsWith('/messages') && this.transformMessage && body && typeof body === 'object') {
      const payload = body as { recipient?: { id?: string; comment_id?: string }; message?: unknown };
      if (payload.message) body = { ...payload, message: await this.transformMessage(payload.recipient?.id ?? '', payload.message, payload.recipient ?? {}) };
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${this.accessToken}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let requestUrl = `${this.baseUrl}${path}`;
    if (this.appSecret) {
      const url = new URL(requestUrl); url.searchParams.set('appsecret_proof', await createAppSecretProof(this.accessToken,this.appSecret)); requestUrl = url.href;
    }
    const observe = async (value: GraphObservation) => { try { await this.onResponse?.(value); } catch { /* observability must not turn a successful send into an error */ } };
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let error: InstagramApiError | InstagramTransportError;
      try {
        const res = await fetch(requestUrl, {
          method, headers, signal: controller.signal,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        const usage = parseGraphUsage(res.headers);
        let value: unknown;
        try { value=await res.json(); } catch (error) { if(res.ok) throw error; }
        const graphError=value && typeof value==='object' ? (value as {error?:{code?:number;error_subcode?:number}}).error : undefined;
        if (res.ok && !graphError) { await observe({ status: res.status, usage }); return value as T; }
        const graph=graphError ?? {};
        const retryHeader = res.headers?.get('retry-after');
        const retryMs = retryHeader ? (/^\d+$/.test(retryHeader) ? Number(retryHeader) * 1000 : Date.parse(retryHeader) - Date.now()) : undefined;
        await observe({ status: res.status, code: graph.code, subcode: graph.error_subcode, retryAfterMs: retryMs, usage });
        error = new InstagramApiError(`Instagram API error ${res.status}${graph.code ? ` (code ${graph.code})` : ''}`, res.status, graph.code, graph.error_subcode, retryMs);
      } catch {
        // Never include a URL, token, or raw upstream response in the error.
        error = new InstagramTransportError(controller.signal.aborted);
      } finally { clearTimeout(timer); }
      const retryable = error instanceof InstagramTransportError || error.retryable;
      if (method !== 'GET' || !retryable || attempt >= this.maxReadRetries) throw error;
      const waitMs = error instanceof InstagramApiError && error.retryAfterMs !== undefined ? Math.max(0, error.retryAfterMs) : 250 * 2 ** attempt;
      // Do not sleep through a long upstream backoff inside a Worker invocation.
      if (!Number.isFinite(waitMs) || waitMs > 2000) throw error;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  /**
   * Messaging node. Instagram Login sends from the IG user. With Facebook
   * Login the documented node is the linked Page when one is known; without a
   * Page (Unified login with an Instagram-only business asset) the IG user id
   * is used, which Meta accepts for system-user tokens.
   */
  private messagesPath(): string {
    return `/${encodeURIComponent(this.webhookNode())}/messages`;
  }

  async sendText(recipientId: string, text: string): Promise<{ recipient_id: string; message_id: string }> {
    const payload: SendTextPayload = {
      recipient: { id: recipientId },
      message: { text },
    };
    return this.request("POST", this.messagesPath(), payload);
  }

  /** One private reply per comment. No automatic retries for mutations. */
  async sendPrivateReply(commentId: string, text: string): Promise<{ recipient_id: string; message_id: string }> {
    if (!commentId || !text || text.length > 1000) throw new Error('Private reply requires a comment ID and 1..1000 characters');
    const result=await this.request<{recipient_id:string;message_id:string}>('POST', this.messagesPath(), { recipient: { comment_id: commentId }, message: { text } });
    if (typeof result?.message_id!=='string' || !result.message_id || typeof result.recipient_id!=='string') throw new InstagramTransportError(false);
    return result;
  }

  async getCommentTimestamp(commentId: string): Promise<string> {
    const value = await this.request<{ timestamp?: string }>('GET', `/${encodeURIComponent(commentId)}?fields=timestamp`);
    if (!value.timestamp || !Number.isFinite(Date.parse(value.timestamp))) throw new Error('Comment creation time could not be verified');
    return value.timestamp;
  }

  async sendImage(recipientId: string, imageUrl: string): Promise<{ recipient_id: string; message_id: string }> {
    const payload: SendImagePayload = {
      recipient: { id: recipientId },
      message: {
        attachment: {
          type: "image",
          payload: { url: imageUrl },
        },
      },
    };
    return this.request("POST", this.messagesPath(), payload);
  }

  async sendGenericTemplate(
    recipientId: string,
    elements: GenericTemplateElement[],
  ): Promise<{ recipient_id: string; message_id: string }> {
    const payload: SendTemplatePayload = {
      recipient: { id: recipientId },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "generic",
            elements,
          },
        },
      },
    };
    return this.request("POST", this.messagesPath(), payload);
  }

  async sendQuickReply(
    recipientId: string,
    text: string,
    quickReplies: QuickReplyItem[],
  ): Promise<{ recipient_id: string; message_id: string }> {
    const payload: SendQuickReplyPayload = {
      recipient: { id: recipientId },
      message: { text, quick_replies: quickReplies },
    };
    return this.request("POST", this.messagesPath(), payload);
  }

  /**
   * Cheapest possible token liveness probe. Succeeds only when the token is
   * actually usable — expiry alone misses checkpoint/freeze invalidation
   * (OAuthException code 190), which is exactly what monitoring must catch.
   */
  async getMe(): Promise<{ user_id?: string; username?: string; id?: string }> {
    if (this.connectionType === 'facebook_login') {
      // A Facebook / system-user token's /me is the Facebook user, not the IG
      // account. Read the IG user node and expose it in the Instagram Login shape
      // so health probes compare the same identifier.
      if (!/^\d+$/.test(this.igUserId)) throw new Error('Facebook Login requires a numeric Instagram user id');
      const value = await this.request<{ id?: string; username?: string }>('GET', `/${this.igUserId}?fields=id,username`);
      return { user_id: value.id, username: value.username, id: value.id };
    }
    return this.request("GET", `/me?fields=user_id,username`);
  }

  /**
   * Facebook Login / Unified login only: IG professional accounts this token
   * can act for. Unified login system-user tokens list them through
   * /me/assigned_instagram_accounts (no Page); Page-linked Facebook Login user
   * tokens through /me/accounts → instagram_business_account.
   */
  async listLinkedInstagramAccounts(): Promise<Array<{ pageId?: string; pageName?: string; igUserId: string; username?: string }>> {
    if (this.connectionType !== 'facebook_login') throw new Error('Linked account lookup requires Facebook Login');
    try {
      const assigned = await this.request<{ data?: Array<{ id?: string; username?: string }> }>('GET', '/me/assigned_instagram_accounts?fields=id,username&limit=100');
      const found = (assigned.data ?? []).flatMap((a) => (a.id && /^\d+$/.test(a.id) ? [{ igUserId: a.id, username: a.username }] : []));
      if (found.length) return found;
    } catch (error) {
      // Not a system-user token (or edge unavailable): fall back to Pages.
      if (!(error instanceof InstagramApiError)) throw error;
    }
    const json = await this.request<{ data?: Array<{ id?: string; name?: string; instagram_business_account?: { id?: string; username?: string } }> }>(
      'GET', '/me/accounts?fields=id,name,instagram_business_account{id,username}&limit=100',
    );
    return (json.data ?? []).flatMap((page) => {
      const ig = page.instagram_business_account;
      if (!page.id || !ig?.id || !/^\d+$/.test(ig.id)) return [];
      return [{ pageId: page.id, pageName: page.name, igUserId: ig.id, username: ig.username }];
    });
  }

  /**
   * Subscribe this account to the app's webhooks. Instagram Login and Unified
   * login subscribe the IG user (POST /{ig-user-id}/subscribed_apps); Page-linked
   * Facebook Login subscribes the Page when one is known. Returns the node.
   */
  /** Node that owns the per-account webhook subscription (see subscribeWebhooks). */
  webhookNode(): string {
    return this.connectionType === 'facebook_login' && this.pageId ? this.pageId : this.igUserId;
  }

  async subscribeWebhooks(fields: readonly string[] = IG_WEBHOOK_FIELDS): Promise<{ node: string; fields: string[] }> {
    if (!fields.length || fields.some((f) => !/^[a-z_]+$/.test(f))) throw new Error('Invalid webhook field list');
    const node = this.webhookNode();
    const path = `/${encodeURIComponent(node)}/subscribed_apps`;
    const qs = new URLSearchParams({ subscribed_fields: fields.join(',') });
    const result = await this.request<{ success?: boolean }>('POST', `${path}?${qs.toString()}`);
    if (result?.success !== true) throw new InstagramTransportError(false);
    const current = await this.request<{ data?: Array<{ subscribed_fields?: string[] }> }>('GET', path);
    const active = new Set((current.data ?? []).flatMap((entry) => entry.subscribed_fields ?? []));
    const missing = fields.filter((field) => !active.has(field));
    if (missing.length) throw new Error(`Webhook subscription is incomplete: ${missing.join(',')}`);
    return { node, fields: [...fields] };
  }

  async getUserProfile(igsid: string): Promise<UserProfile> {
    return this.request("GET", `/${igsid}?fields=id,username,name,profile_pic,is_user_follow_business,is_business_follow_user,follower_count,is_verified_user`);
  }

  /**
   * List comments on a media (post). Used by the dashboard to preview commenters.
   */
  async getMediaComments(mediaId: string, limit = 50): Promise<Array<{ id: string; text: string; username: string; from_id: string; timestamp: string }>> {
    const json = await this.request<{ data?: Array<{ id: string; text: string; username?: string; from?: { id: string; username: string }; timestamp: string }> }>(
      'GET', `/${mediaId}/comments?fields=id,text,username,from{id,username},timestamp&limit=${limit}`,
    );
    return (json.data ?? []).map((c) => ({
      id: c.id,
      text: c.text,
      username: c.from?.username ?? c.username ?? '',
      from_id: c.from?.id ?? '',
      timestamp: c.timestamp,
    }));
  }

  async replyToComment(commentId: string, message: string): Promise<{ id: string }> {
    // Use the documented message parameter encoding; access level is a separate concern.
    return this.request('POST', `/${commentId}/replies?message=${encodeURIComponent(message)}`);
  }

  /**
   * Post a top-level comment to owned media. This is visibly different from
   * a nested reply and does not bypass permission/access-level requirements.
   */
  async postCommentToMedia(mediaId: string, message: string): Promise<{ id: string }> {
    return this.request('POST', `/${mediaId}/comments?message=${encodeURIComponent(message)}`);
  }

  async getMediaInfo(mediaId: string): Promise<MediaInfo> {
    return this.request(
      "GET",
      `/${mediaId}?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,timestamp,permalink`,
    );
  }

  /**
   * List the authenticated user's own media (posts + reels).
   * Callers typically filter by media_product_type === 'REELS' for reels only.
   */
  async getMyMedia(limit = 50): Promise<MediaInfo[]> {
    const json = await this.request<{ data?: MediaInfo[] }>('GET', `/${this.igUserId}/media?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,timestamp,permalink&limit=${limit}`);
    return json.data ?? [];
  }

  /**
   * Send a multi-block rich message. Each block expands to one IG Messenger
   * API call. Blocks are bounded and dispatched sequentially without artificial
   * sleeps; larger sequences belong in a durable delivery queue.
   *
   * Placeholders are interpolated before dispatch:
   *   {IGSID}, {GATE_ID}, {DELIVERY_ID}, {REWARD_URL}, {FOLLOWER_USERNAME}
   */
  async sendRichMessage(
    recipientId: string,
    blocks: RichMessageBlock[],
    context: RichMessageContext = {},
  ): Promise<{ sentBlocks: number }> {
    if (blocks.length > MAX_RICH_MESSAGE_BLOCKS) throw new Error(`Rich messages support at most ${MAX_RICH_MESSAGE_BLOCKS} blocks; split larger sequences into scheduled steps`);
    const interpolate = (s: string): string =>
      s
        .replace(/\{\{?\s*IGSID\s*\}?\}/g, recipientId)
        .replace(/\{\{?\s*GATE_ID\s*\}?\}/g, context.gateId ?? "")
        .replace(/\{\{?\s*DELIVERY_ID\s*\}?\}/g, context.deliveryId ?? "")
        .replace(/\{\{?\s*REWARD_URL\s*\}?\}/g, context.rewardUrl ?? "")
        .replace(
          /\{\{?\s*FOLLOWER_USERNAME\s*\}?\}/g,
          context.followerUsername ?? "",
        );

    const cardToElement = (
      card: Omit<CardBlock, "type">,
    ): GenericTemplateElement => ({
      title: interpolate(card.title).slice(0, 80),
      subtitle: card.subtitle
        ? interpolate(card.subtitle).slice(0, 80)
        : undefined,
      image_url: card.image_url ? interpolate(card.image_url) : undefined,
      default_action: card.default_url
        ? { type: "web_url", url: interpolate(card.default_url) }
        : undefined,
      buttons: card.buttons.map((b) => {
        if (b.type === "postback") {
          return {
            type: "postback" as const,
            title: interpolate(b.label).slice(0, 20),
            payload: interpolate(b.payload),
          };
        }
        return {
          type: "web_url" as const,
          title: interpolate(b.label).slice(0, 20),
          url: interpolate(b.url),
        };
      }),
    });

    let sent = 0;
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!;
      switch (block.type) {
        case "text":
          await this.sendText(recipientId, interpolate(block.text).slice(0, 1000));
          break;
        case "image":
          await this.sendImage(recipientId, interpolate(block.url));
          break;
        case "card":
          await this.sendGenericTemplate(recipientId, [
            cardToElement({
              title: block.title,
              subtitle: block.subtitle,
              image_url: block.image_url,
              default_url: block.default_url,
              buttons: block.buttons,
            }),
          ]);
          break;
        case "carousel":
          await this.sendGenericTemplate(
            recipientId,
            block.cards.map(cardToElement),
          );
          break;
        case "quick_replies":
          await this.sendQuickReply(
            recipientId,
            interpolate(block.text).slice(0, 1000),
            block.replies.map((r) => ({
              content_type: "text" as const,
              title: interpolate(r.label).slice(0, 20),
              payload: interpolate(r.payload),
            })),
          );
          break;
      }
      sent++;

    }
    return { sentBlocks: sent };
  }

  /**
   * Create a media container (step 1 of Content Publishing).
   * POST /{ig-user-id}/media — params go in the query string (Graph API style,
   * same as postCommentToMedia).
   */
  async createMediaContainer(params: CreateContainerParams): Promise<{ id: string }> {
    const qs = new URLSearchParams();
    if (params.imageUrl) qs.set('image_url', params.imageUrl);
    if (params.videoUrl) qs.set('video_url', params.videoUrl);
    if (params.mediaType) qs.set('media_type', params.mediaType);
    if (params.caption) qs.set('caption', params.caption);
    if (params.children && params.children.length > 0) {
      qs.set('children', params.children.join(','));
    }
    if (params.isCarouselItem) qs.set('is_carousel_item', 'true');
    if (params.mediaType === 'REELS') {
      if (params.coverUrl) qs.set('cover_url', params.coverUrl);
      else if (params.thumbOffset !== undefined) qs.set('thumb_offset', String(params.thumbOffset));
    }
    const result=await this.request<{id:string}>('POST', `/${this.igUserId}/media?${qs.toString()}`);
    if (typeof result?.id!=='string' || !result.id) throw new InstagramTransportError(false);
    return result;
  }

  /** Check container processing status (videos are processed asynchronously). */
  async getContainerStatus(creationId: string): Promise<ContainerStatus> {
    return this.request('GET', `/${creationId}?fields=status_code,status`);
  }

  /** Publish a FINISHED container (step 2 of Content Publishing). */
  async publishMedia(creationId: string): Promise<{ id: string }> {
    const qs = new URLSearchParams({ creation_id: creationId });
    const result=await this.request<{id:string}>('POST', `/${this.igUserId}/media_publish?${qs.toString()}`);
    if (typeof result?.id!=='string' || !result.id) throw new InstagramTransportError(false);
    return result;
  }

  /** Fetch the account's current publishing quota; do not assume one fixed cap. */
  async getPublishingLimit(): Promise<PublishingLimit> {
    const res = await this.request<{ data?: PublishingLimit[] }>(
      'GET',
      `/${this.igUserId}/content_publishing_limit?fields=quota_usage,config`,
    );
    return res.data?.[0] ?? { quota_usage: 0 };
  }
}
