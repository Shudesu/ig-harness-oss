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

// Keep the existing default until the deployment is verified against a newer
// Graph release. Callers can opt in without patching this package.
export const DEFAULT_GRAPH_API_VERSION = 'v21.0';
export const MAX_RICH_MESSAGE_BLOCKS = 10;

export class InstagramClient {
  private accessToken: string;
  private igUserId: string;
  private baseUrl: string;
  private timeoutMs: number;
  private maxReadRetries: number;

  constructor(opts: { accessToken: string; igUserId: string; apiVersion?: string; timeoutMs?: number; maxReadRetries?: number }) {
    this.accessToken = opts.accessToken;
    this.igUserId = opts.igUserId;
    const version = opts.apiVersion ?? DEFAULT_GRAPH_API_VERSION;
    if (!/^v\d+\.\d+$/.test(version)) throw new Error('Invalid Graph API version');
    this.baseUrl = `https://graph.instagram.com/${version}`;
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
    const headers: Record<string, string> = { Authorization: `Bearer ${this.accessToken}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let error: InstagramApiError | InstagramTransportError;
      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          method, headers, signal: controller.signal,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        if (res.ok) return await res.json() as T;
        let graph: { code?: number; error_subcode?: number } = {};
        try { graph = ((await res.json()) as { error?: typeof graph }).error ?? {}; } catch { /* non-JSON upstream error */ }
        const retryHeader = res.headers?.get('retry-after');
        const retryMs = retryHeader ? (/^\d+$/.test(retryHeader) ? Number(retryHeader) * 1000 : Date.parse(retryHeader) - Date.now()) : undefined;
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

  async sendText(recipientId: string, text: string): Promise<{ recipient_id: string; message_id: string }> {
    const payload: SendTextPayload = {
      recipient: { id: recipientId },
      message: { text },
    };
    return this.request("POST", `/${this.igUserId}/messages`, payload);
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
    return this.request("POST", `/${this.igUserId}/messages`, payload);
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
    return this.request("POST", `/${this.igUserId}/messages`, payload);
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
    return this.request("POST", `/${this.igUserId}/messages`, payload);
  }

  /**
   * Cheapest possible token liveness probe. Succeeds only when the token is
   * actually usable — expiry alone misses checkpoint/freeze invalidation
   * (OAuthException code 190), which is exactly what monitoring must catch.
   */
  async getMe(): Promise<{ user_id?: string; username?: string; id?: string }> {
    return this.request("GET", `/me?fields=user_id,username`);
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
    // IG Graph API requires query-parameter encoding for /replies, not JSON body.
    // Sending JSON returns "Object does not exist" because the API can't parse
    // the message and falls back to looking up the comment by id only.
    return this.request('POST', `/${commentId}/replies?message=${encodeURIComponent(message)}`);
  }

  /**
   * Post a top-level comment to a media owned by the authenticated IG user.
   * This works under Standard Access (unlike /{comment_id}/replies, which
   * needs Advanced Access for external commenters' comments). Used as a
   * Standard-Access-friendly substitute for replyToComment by writing
   * "@username message" as a regular comment on the media — UX-wise this
   * is functionally identical to a public reply.
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
    return this.request('POST', `/${this.igUserId}/media?${qs.toString()}`);
  }

  /** Check container processing status (videos are processed asynchronously). */
  async getContainerStatus(creationId: string): Promise<ContainerStatus> {
    return this.request('GET', `/${creationId}?fields=status_code,status`);
  }

  /** Publish a FINISHED container (step 2 of Content Publishing). */
  async publishMedia(creationId: string): Promise<{ id: string }> {
    const qs = new URLSearchParams({ creation_id: creationId });
    return this.request('POST', `/${this.igUserId}/media_publish?${qs.toString()}`);
  }

  /** Content publishing rate limit (100 posts per 24h rolling window). */
  async getPublishingLimit(): Promise<PublishingLimit> {
    const res = await this.request<{ data?: PublishingLimit[] }>(
      'GET',
      `/${this.igUserId}/content_publishing_limit?fields=quota_usage,config`,
    );
    return res.data?.[0] ?? { quota_usage: 0 };
  }
}
