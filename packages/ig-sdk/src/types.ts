// ── Webhook Events ──
export interface WebhookEntry {
  id: string;
  time: number;
  messaging?: MessagingEvent[];
  standby?: MessagingEvent[];
  changes?: ChangeEvent[];
}

export interface WebhookPayload {
  object: "instagram";
  entry: WebhookEntry[];
}

// ── Messaging Events (DM) ──
export interface MessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: IncomingMessage;
  postback?: Postback;
}

export interface IncomingMessage {
  mid: string;
  text?: string;
  attachments?: Attachment[];
  quick_reply?: { payload: string };
  is_echo?: boolean;
}

export interface Attachment {
  type: "image" | "video" | "audio" | "file";
  payload: { url: string };
}

export interface Postback {
  mid: string;
  title: string;
  payload: string;
}

// ── Change Events (Comments) ──
export interface ChangeEvent {
  field: "comments" | "mentions" | "story_insights";
  value: CommentValue;
}

export interface CommentValue {
  id: string;
  text: string;
  from: { id: string; username: string };
  media: { id: string; media_product_type: string };
  created_time: string;
}

// ── Send API Types ──
export interface SendTextPayload {
  recipient: { id: string };
  message: { text: string };
}

export interface SendImagePayload {
  recipient: { id: string };
  message: {
    attachment: {
      type: "image";
      payload: { url: string };
    };
  };
}

export interface GenericTemplateElement {
  title: string;
  subtitle?: string;
  image_url?: string;
  default_action?: {
    type: "web_url";
    url: string;
  };
  buttons?: TemplateButton[];
}

export interface TemplateButton {
  type: "web_url" | "postback";
  title: string;
  url?: string;
  payload?: string;
}

export interface SendTemplatePayload {
  recipient: { id: string };
  message: {
    attachment: {
      type: "template";
      payload: {
        template_type: "generic";
        elements: GenericTemplateElement[];
      };
    };
  };
}

export interface QuickReplyItem {
  content_type: "text";
  title: string;
  payload: string;
}

export interface SendQuickReplyPayload {
  recipient: { id: string };
  message: {
    text: string;
    quick_replies: QuickReplyItem[];
  };
}

// ── User Profile ──
export interface UserProfile {
  id: string;
  username: string;
  name: string;
  profile_pic: string;
  is_user_follow_business?: boolean;
  is_business_follow_user?: boolean;
  follower_count?: number;
  is_verified_user?: boolean;
}

// ── Media Info ──
export interface MediaInfo {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_url?: string;
  timestamp: string;
  permalink: string;
}
