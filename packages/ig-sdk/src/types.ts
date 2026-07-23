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

// ── Change Events (Comments / Mentions / Story Insights) ──
// Discriminated union on `field` so consumers can narrow `value` after
// checking `field`. Previously `value` was always typed as `CommentValue`,
// which broke `handleMentionEvent` whose payload shape is different.

export interface CommentValue {
  id: string;
  text: string;
  from: { id: string; username: string };
  media: { id: string; media_product_type: string };
  created_time: string;
}

export interface MentionValue {
  media_id?: string;
  comment_id?: string;
  mentioned_user_id?: string;
}

export interface StoryInsightsValue {
  [key: string]: unknown;
}

export type ChangeEvent =
  | { field: "comments"; value: CommentValue }
  | { field: "mentions"; value: MentionValue }
  | { field: "story_insights"; value: StoryInsightsValue };

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
  media_product_type?: "FEED" | "REELS" | "STORY" | "AD";
  media_url?: string;
  thumbnail_url?: string;
  timestamp: string;
  permalink: string;
}

// ── Rich Message Blocks ──
// Reusable structured DM templates that expand to one-or-more IG Messenger
// API calls at send time.

export type RichMessageBlock =
  | TextBlock
  | ImageBlock
  | CardBlock
  | CarouselBlock
  | QuickRepliesBlock;

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ImageBlock {
  type: "image";
  url: string;
  alt?: string;
}

export interface CardBlock {
  type: "card";
  title: string;
  subtitle?: string;
  image_url?: string;
  default_url?: string;
  buttons: RichMessageButton[];
}

export interface CarouselBlock {
  type: "carousel";
  cards: Array<Omit<CardBlock, "type">>;
}

export interface QuickRepliesBlock {
  type: "quick_replies";
  text: string;
  replies: Array<{ label: string; payload: string }>;
}

export type RichMessageButton =
  | { type: "postback"; label: string; payload: string }
  | { type: "url"; label: string; url: string };

export interface RichMessageContext {
  gateId?: string;
  deliveryId?: string;
  rewardUrl?: string | null;
  followerUsername?: string | null;
}

// ── Content Publishing ──
export interface CreateContainerParams {
  imageUrl?: string;
  videoUrl?: string;
  /**
   * REELS = feed video (single video feed posts are reels on this API),
   * STORIES = story, CAROUSEL = carousel parent,
   * VIDEO = video child inside a carousel.
   */
  mediaType?: 'REELS' | 'STORIES' | 'CAROUSEL' | 'VIDEO';
  caption?: string;
  children?: string[];
  isCarouselItem?: boolean;
}

export interface ContainerStatus {
  id: string;
  status_code: 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED';
  status?: string;
}

export interface PublishingLimit {
  quota_usage: number;
  config?: { quota_total: number; quota_duration: number };
}
