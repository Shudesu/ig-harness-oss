import type {
  SendTextPayload,
  SendImagePayload,
  SendTemplatePayload,
  SendQuickReplyPayload,
  GenericTemplateElement,
  QuickReplyItem,
  UserProfile,
  MediaInfo,
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
    return this.request("POST", `/${commentId}/replies`, { message });
  }

  async getMediaInfo(mediaId: string): Promise<MediaInfo> {
    return this.request(
      "GET",
      `/${mediaId}?fields=id,caption,media_type,media_url,timestamp,permalink`,
    );
  }
}
