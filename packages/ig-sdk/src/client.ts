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
} from "./types.js";

const GRAPH_API_BASE = "https://graph.instagram.com/v21.0";

export class InstagramClient {
  private accessToken: string;
  private igUserId: string;

  constructor(opts: { accessToken: string; igUserId: string }) {
    this.accessToken = opts.accessToken;
    this.igUserId = opts.igUserId;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${GRAPH_API_BASE}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
    };
    const init: RequestInit = { method, headers };

    if (body) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const res = await fetch(url, init);
    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Instagram API error ${res.status}: ${error}`);
    }
    return res.json() as Promise<T>;
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

  async getUserProfile(igsid: string): Promise<UserProfile> {
    return this.request("GET", `/${igsid}?fields=id,username,name,profile_pic,is_user_follow_business,is_business_follow_user,follower_count,is_verified_user`);
  }

  /**
   * List comments on a media (post). Used by the dashboard to preview commenters.
   */
  async getMediaComments(mediaId: string, limit = 50): Promise<Array<{ id: string; text: string; username: string; from_id: string; timestamp: string }>> {
    const url = `${GRAPH_API_BASE}/${mediaId}/comments?fields=id,text,username,from{id,username},timestamp&limit=${limit}&access_token=${this.accessToken}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`getMediaComments failed: ${res.status} ${await res.text()}`);
    }
    const json = await res.json() as { data?: Array<{ id: string; text: string; username?: string; from?: { id: string; username: string }; timestamp: string }> };
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
    const url = `${GRAPH_API_BASE}/${commentId}/replies?message=${encodeURIComponent(message)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Instagram API error ${res.status}: ${error}`);
    }
    return res.json() as Promise<{ id: string }>;
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
    const url =
      `${GRAPH_API_BASE}/${this.igUserId}/media` +
      `?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,timestamp,permalink` +
      `&limit=${limit}` +
      `&access_token=${this.accessToken}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`getMyMedia failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { data?: MediaInfo[] };
    return json.data ?? [];
  }

  /**
   * Send a multi-block rich message. Each block expands to one IG Messenger
   * API call; blocks are dispatched sequentially with an 800ms pause between
   * them to produce a natural conversational rhythm.
   *
   * Placeholders are interpolated before dispatch:
   *   {IGSID}, {GATE_ID}, {DELIVERY_ID}, {REWARD_URL}, {FOLLOWER_USERNAME}
   */
  async sendRichMessage(
    recipientId: string,
    blocks: RichMessageBlock[],
    context: RichMessageContext = {},
  ): Promise<{ sentBlocks: number }> {
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
      if (i < blocks.length - 1) await new Promise((r) => setTimeout(r, 800));
    }
    return { sentBlocks: sent };
  }
}
