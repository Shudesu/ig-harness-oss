// ─── Config ─────────────────────────────────────────────
export interface LineHarnessConfig {
  apiUrl: string
  apiKey: string
  timeout?: number  // default: 30000ms
  lineAccountId?: string  // default account for multi-account setups
}

export interface InstagramHarnessConfig {
  apiUrl: string
  apiKey: string
  timeout?: number  // default: 30000ms
  /** Scope all SDK calls to this IG account (multi-account deploys). Omit for the default account. */
  accountId?: string
}

// ─── API Response ───────────────────────────────────────
// HttpClient throws on non-2xx, so SDK consumers always receive the success case
export interface ApiResponse<T> {
  success: boolean
  data: T
  error?: string
}

export interface PaginatedData<T> {
  items: T[]
  total: number
  page: number
  limit: number
  hasNextPage: boolean
}

// ─── Common ─────────────────────────────────────────────
export type ScenarioTriggerType = 'friend_add' | 'tag_added' | 'manual'
export type MessageType = 'text' | 'image' | 'flex'
export type BroadcastStatus = 'draft' | 'scheduled' | 'sending' | 'sent'

// ─── Friend ─────────────────────────────────────────────
export interface Friend {
  id: string
  lineUserId: string
  displayName: string | null
  pictureUrl: string | null
  statusMessage: string | null
  isFollowing: boolean
  metadata: Record<string, unknown>
  tags: Tag[]
  createdAt: string
  updatedAt: string
}

export interface FriendListParams {
  limit?: number
  offset?: number
  tagId?: string
  search?: string
  metadata?: Record<string, string>
  accountId?: string
}

// ─── Tag ────────────────────────────────────────────────
export interface Tag {
  id: string
  name: string
  color: string
  createdAt: string
}

export interface CreateTagInput {
  name: string
  color?: string
}

// ─── Scenario ───────────────────────────────────────────
export interface Scenario {
  id: string
  name: string
  description: string | null
  triggerType: ScenarioTriggerType
  triggerTagId: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface ScenarioListItem extends Scenario {
  stepCount: number
}

export interface ScenarioWithSteps extends Scenario {
  steps: ScenarioStep[]
}

export interface ScenarioStep {
  id: string
  scenarioId: string
  stepOrder: number
  delayMinutes: number
  messageType: MessageType
  messageContent: string
  conditionType: string | null
  conditionValue: string | null
  nextStepOnFalse: number | null
  createdAt: string
}

export interface CreateScenarioInput {
  name: string
  description?: string
  triggerType: ScenarioTriggerType
  triggerTagId?: string
  isActive?: boolean
}

export interface CreateStepInput {
  stepOrder: number
  delayMinutes: number
  messageType: MessageType
  messageContent: string
  conditionType?: string | null
  conditionValue?: string | null
  nextStepOnFalse?: number | null
}

export interface UpdateScenarioInput {
  name?: string
  description?: string | null
  triggerType?: ScenarioTriggerType
  triggerTagId?: string | null
  isActive?: boolean
}

export interface UpdateStepInput {
  stepOrder?: number
  delayMinutes?: number
  messageType?: MessageType
  messageContent?: string
  conditionType?: string | null
  conditionValue?: string | null
  nextStepOnFalse?: number | null
}

export interface FriendScenarioEnrollment {
  id: string
  friendId: string
  scenarioId: string
  currentStepOrder: number
  status: 'active' | 'paused' | 'completed'
  startedAt: string
  nextDeliveryAt: string | null
  updatedAt: string
}

// ─── Broadcast ──────────────────────────────────────────
export interface Broadcast {
  id: string
  title: string
  messageType: MessageType
  messageContent: string
  targetType: 'all' | 'tag'
  targetTagId: string | null
  status: BroadcastStatus
  scheduledAt: string | null
  sentAt: string | null
  totalCount: number
  successCount: number
  lineRequestId?: string | null
  aggregationUnit?: string | null
  createdAt: string
}

export interface BroadcastInsight {
  id: string
  broadcastId: string
  delivered: number | null
  uniqueImpression: number | null
  uniqueClick: number | null
  uniqueMediaPlayed: number | null
  openRate: number | null
  clickRate: number | null
  status: 'pending' | 'ready' | 'failed'
  retryCount: number
  fetchedAt: string | null
  createdAt: string
}

export interface BroadcastWithInsight extends Broadcast {
  insight?: BroadcastInsight | null
}

export interface CreateBroadcastInput {
  title: string
  messageType: MessageType
  messageContent: string
  targetType: 'all' | 'tag'
  targetTagId?: string
  scheduledAt?: string
  altText?: string
}

export interface UpdateBroadcastInput {
  title?: string
  messageType?: MessageType
  messageContent?: string
  targetType?: 'all' | 'tag'
  targetTagId?: string | null
  scheduledAt?: string | null
}

// ─── Rich Menu ──────────────────────────────────────────
export interface RichMenuBounds {
  x: number
  y: number
  width: number
  height: number
}

export type RichMenuAction =
  | { type: 'postback'; data: string; displayText?: string; label?: string }
  | { type: 'message'; text: string; label?: string }
  | { type: 'uri'; uri: string; label?: string }
  | { type: 'datetimepicker'; data: string; mode: 'date' | 'time' | 'datetime'; label?: string }
  | { type: 'richmenuswitch'; richMenuAliasId: string; data: string; label?: string }

export interface RichMenuArea {
  bounds: RichMenuBounds
  action: RichMenuAction
}

export interface RichMenu {
  richMenuId: string
  size: { width: number; height: number }
  selected: boolean
  name: string
  chatBarText: string
  areas: RichMenuArea[]
}

export interface CreateRichMenuInput {
  size: { width: number; height: number }
  selected: boolean
  name: string
  chatBarText: string
  areas: RichMenuArea[]
}

// ─── Ad Platforms ──────────────────────────────────────
export type AdPlatformName = 'meta' | 'x' | 'google' | 'tiktok'

export interface AdPlatform {
  id: string
  name: AdPlatformName
  displayName: string | null
  config: Record<string, unknown>
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateAdPlatformInput {
  name: AdPlatformName
  displayName?: string
  config: Record<string, unknown>
}

export interface UpdateAdPlatformInput {
  name?: AdPlatformName
  displayName?: string
  config?: Record<string, unknown>
  isActive?: boolean
}

export type ConversionLogStatus = 'sent' | 'failed'

export interface ConversionLog {
  id: string
  platformId: string
  eventName: string
  friendId: string | null
  status: ConversionLogStatus
  error: string | null
  sentAt: string | null
  createdAt: string
}

// ─── Segment ─────────────────────────────────────────────
export interface SegmentRule {
  type: 'tag_exists' | 'tag_not_exists' | 'metadata_equals' | 'metadata_not_equals' | 'ref_code' | 'is_following'
  value: string | boolean | { key: string; value: string }
}

export interface SegmentCondition {
  operator: 'AND' | 'OR'
  rules: SegmentRule[]
}

// ─── Tracked Links ──────────────────────────────────────────
export interface TrackedLink {
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

export interface LinkClick {
  id: string
  friendId: string | null
  friendDisplayName: string | null
  clickedAt: string
}

export interface TrackedLinkWithClicks extends TrackedLink {
  clicks: LinkClick[]
}

export interface CreateTrackedLinkInput {
  name: string
  originalUrl: string
  tagId?: string | null
  scenarioId?: string | null
}

// ─── Forms ──────────────────────────────────────────────
export interface FormField {
  name: string
  label: string
  type: 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'date'
  required?: boolean
  options?: string[]  // for select, radio, checkbox
  placeholder?: string
}

export interface Form {
  id: string
  name: string
  description: string | null
  fields: FormField[]
  onSubmitTagId: string | null
  onSubmitScenarioId: string | null
  onSubmitMessageType: 'text' | 'flex' | null
  onSubmitMessageContent: string | null
  saveToMetadata: boolean
  isActive: boolean
  submitCount: number
  createdAt: string
  updatedAt: string
}

export interface CreateFormInput {
  name: string
  description?: string
  fields: FormField[]
  onSubmitTagId?: string | null
  onSubmitScenarioId?: string | null
  onSubmitMessageType?: 'text' | 'flex' | null
  onSubmitMessageContent?: string | null
  saveToMetadata?: boolean
}

export interface UpdateFormInput {
  name?: string
  description?: string | null
  fields?: FormField[]
  onSubmitTagId?: string | null
  onSubmitScenarioId?: string | null
  onSubmitMessageType?: 'text' | 'flex' | null
  onSubmitMessageContent?: string | null
  saveToMetadata?: boolean
  isActive?: boolean
}

export interface FormSubmission {
  id: string
  formId: string
  friendId: string | null
  data: Record<string, unknown>
  createdAt: string
}

// ─── Calendar ───────────────────────────────────────────
export interface CalendarConnection {
  id: string
  calendarId: string
  authType: string
  isActive: boolean
  createdAt: string
}

export interface CalendarSlot {
  startAt: string
  endAt: string
  available: boolean
}

export interface CalendarBooking {
  id: string
  connectionId: string
  friendId: string | null
  eventId: string | null
  title: string
  startAt: string
  endAt: string
  status: 'confirmed' | 'cancelled' | 'completed'
  createdAt: string
}

// ─── Staff ──────────────────────────────────────────────
export type StaffRole = 'owner' | 'admin' | 'staff'

export interface StaffMember {
  id: string
  name: string
  email: string | null
  role: StaffRole
  /**
   * Masked API key (e.g. `lh_****1234`).
   * The full key is only returned once — on create or regenerate-key responses.
   */
  apiKey: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface StaffProfile {
  id: string
  name: string
  role: StaffRole
  email: string | null
}

export interface CreateStaffInput {
  name: string
  email?: string
  role: 'admin' | 'staff'
}

export interface UpdateStaffInput {
  name?: string
  email?: string | null
  role?: StaffRole
  isActive?: boolean
}

// ─── High-Level ─────────────────────────────────────────
export interface StepDefinition {
  delay: string
  type: MessageType
  content: string
}

// ─── Follower ───────────────────────────────────────────
export interface Follower {
  id: string
  igUserId: string
  username: string | null
  name: string | null
  profilePicUrl: string | null
  isFollowing: boolean
  metadata: Record<string, unknown>
  tags: Tag[]
  createdAt: string
  updatedAt: string
}

export interface FollowerListParams {
  page?: number
  pageSize?: number
  tagId?: number
  search?: string
}

// ─── Comment Rules ──────────────────────────────────────
export type CommentRuleTrigger = 'keyword' | 'any_comment'
export type CommentRuleAction = 'send_dm' | 'add_tag' | 'enroll_scenario'

export interface CommentRule {
  id: string
  name: string
  postId: string | null
  triggerType: CommentRuleTrigger
  keywords: string[]
  action: CommentRuleAction
  actionValue: string | null
  replyComment: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateCommentRuleInput {
  name: string
  postId?: string | null
  triggerType: CommentRuleTrigger
  keywords?: string[]
  action: CommentRuleAction
  actionValue?: string | null
  replyComment?: string | null
  isActive?: boolean
}

export interface UpdateCommentRuleInput {
  name?: string
  postId?: string | null
  triggerType?: CommentRuleTrigger
  keywords?: string[]
  action?: CommentRuleAction
  actionValue?: string | null
  replyComment?: string | null
  isActive?: boolean
}

// ─── Engagement Gates ───────────────────────────────────
export type EngagementGateStatus = 'active' | 'paused' | 'archived'
export type EngagementGateTriggerType = 'comment_on_post' | 'dm_keyword' | 'story_mention'
export type GateDeliveryStatus = 'triggered' | 'cta_sent' | 'pending_follow' | 'delivered' | 'dropped'

export interface EngagementGate {
  id: string
  name: string
  status: EngagementGateStatus
  trigger_type: EngagementGateTriggerType
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
  initial_dm_rich_message_id: string | null
  reward_dm_rich_message_id: string | null
  follow_reminder_dm_rich_message_id: string | null
  comment_reply_text: string | null
  followup_dm_sequence: string | null
  /**
   * LINE Harness cross-link binding. When set, reward / CTA / reminder
   * DMs rewrite outbound URLs through a LINE Harness tracked link so the
   * recipient's IGSID rides along `?ig=<IGSID>` on click — capturing the
   * IG↔LINE userId pair on first friend-add.
   *   - line_connection_id: id from /api/line-connections
   *   - line_pool_slug:     LINE-side traffic pool used for attribution
   *   - line_tracked_link_short: cached tracked-link short id, populated
   *     lazily on first delivery (read-only from the SDK consumer's
   *     perspective; the worker sets it).
   */
  line_connection_id: string | null
  line_pool_slug: string | null
  line_tracked_link_short: string | null
  /** Hydrated list of IG post ids this gate applies to. Empty = all posts. */
  target_post_ids?: string[]
  created_at: string
  updated_at: string
}

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

export interface EngagementGateWithAnalytics extends EngagementGate {
  analytics: GateAnalytics
}

export interface CreateEngagementGateInput {
  name: string
  status?: EngagementGateStatus
  trigger_type: EngagementGateTriggerType
  target_post_id?: string | null
  trigger_keyword?: string | null
  require_follow?: number
  initial_dm_text?: string
  initial_dm_button_label?: string
  follow_reminder_dm_text?: string
  follow_reminder_button_label?: string
  reward_dm_text?: string
  reward_url?: string | null
  max_loops?: number
  initial_dm_rich_message_id?: string | null
  reward_dm_rich_message_id?: string | null
  follow_reminder_dm_rich_message_id?: string | null
  comment_reply_text?: string | null
  followup_dm_sequence?: string | null
  /** LINE Harness cross-link binding (see EngagementGate). Setting only
   *  one of the two without the other is allowed but the cross-link
   *  rewriter requires both connection_id + a non-null reward_url to
   *  fire — pool_slug is optional. */
  line_connection_id?: string | null
  line_pool_slug?: string | null
  target_post_ids?: string[]
}

export interface UpdateEngagementGateInput {
  name?: string
  status?: EngagementGateStatus
  trigger_type?: EngagementGateTriggerType
  target_post_id?: string | null
  trigger_keyword?: string | null
  require_follow?: number
  initial_dm_text?: string
  initial_dm_button_label?: string
  follow_reminder_dm_text?: string
  follow_reminder_button_label?: string
  reward_dm_text?: string
  reward_url?: string | null
  max_loops?: number
  initial_dm_rich_message_id?: string | null
  reward_dm_rich_message_id?: string | null
  follow_reminder_dm_rich_message_id?: string | null
  comment_reply_text?: string | null
  followup_dm_sequence?: string | null
  /** LINE Harness cross-link binding (see EngagementGate). Patching
   *  connection_id, pool_slug, or reward_url invalidates the cached
   *  line_tracked_link_short so the next delivery regenerates it. */
  line_connection_id?: string | null
  line_pool_slug?: string | null
  target_post_ids?: string[]
}

export interface GateDelivery {
  id: string
  gate_id: string
  follower_id: number
  igsid: string
  status: GateDeliveryStatus
  loop_count: number
  last_check_at: string | null
  triggered_at: string
  delivered_at: string | null
  metadata: string
}

// ─── Rich Messages ──────────────────────────────────────
export type RichMessageKind = 'cta' | 'reward' | 'reminder' | 'generic'

export type RichMessageBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; alt?: string }
  | {
      type: 'card'
      title: string
      subtitle?: string
      image_url?: string
      default_url?: string
      buttons: Array<
        | { type: 'postback'; label: string; payload: string }
        | { type: 'url'; label: string; url: string }
      >
    }
  | {
      type: 'carousel'
      cards: Array<{
        title: string
        subtitle?: string
        image_url?: string
        default_url?: string
        buttons: Array<
          | { type: 'postback'; label: string; payload: string }
          | { type: 'url'; label: string; url: string }
        >
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

export interface CreateRichMessageInput {
  name: string
  kind: RichMessageKind
  blocks: RichMessageBlock[]
}

export interface UpdateRichMessageInput {
  name?: string
  kind?: RichMessageKind
  blocks?: RichMessageBlock[]
}

// ─── Reels / Bulk Apply ─────────────────────────────────
export interface ReelInfo {
  id: string
  caption?: string
  media_type: string
  media_product_type?: string
  media_url?: string
  thumbnail_url?: string
  timestamp: string
  permalink: string
}

export interface BulkApplyGatesInput {
  reel_ids: string[]
  name_prefix: string
  initial_dm_rich_message_id: string
  reward_dm_rich_message_id: string
  follow_reminder_dm_rich_message_id?: string
  trigger_keyword?: string | null
  require_follow?: boolean
  reward_url?: string
  max_loops?: number
}

export interface BulkApplyGatesResult {
  created: number
  skipped: number
  gates: Array<{ id: string; reel_id: string; status: 'created' | 'skipped' }>
}

// ─── Images ─────────────────────────────────────────────
export interface UploadedImage {
  id: string
  key: string
  url: string
  mimeType: string
  size: number
}

export interface UploadImageInput {
  /** Base64-encoded image data (with or without data URI prefix) */
  data: string
  /** MIME type, e.g. "image/png". Defaults to "image/png" */
  mimeType?: string
  /** Optional original filename */
  filename?: string
}

// ─── LINE Harness cross-platform binding ─────────────────
/**
 * Per-LINE-Harness-deployment connection registered in this IG Harness.
 * One row per LINE Harness instance the operator wants to send IG
 * traffic into; engagement gates reference a connection by id +
 * optionally a traffic-pool slug. Mirrors the shape returned by
 * `GET /api/line-connections` — secrets are masked server-side, so
 * the SDK never sees a raw api_key.
 */
export interface LineConnection {
  id: string
  name: string
  worker_url: string
  /** API key masked to first 4 + last 4 chars (e.g. `lh_0••••8aa3`). */
  api_key_masked: string
  account_id: string | null
  is_default: boolean
  created_at: string
  updated_at: string
}

export interface CreateLineConnectionInput {
  name: string
  worker_url: string
  /** Plaintext API key — only set on create / rotation. The server
   *  stores it and never echoes it back unmasked. */
  api_key: string
  account_id?: string | null
  is_default?: boolean
}

export interface UpdateLineConnectionInput {
  name?: string
  worker_url?: string
  /** Plaintext API key. Send only when rotating; omit to keep the
   *  current value. The server never echoes it back unmasked. */
  api_key?: string
  account_id?: string | null
  /** Promote this connection to default. False/undefined leaves the
   *  current default untouched. */
  is_default?: boolean
}

/**
 * Tracked link returned by LINE Harness `/api/tracked-links` (proxied
 * through this worker). The IG side only ever reads these — we don't
 * own the writer.
 */
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

/** Traffic pool exposed by LINE Harness for the selected connection. */
export interface LineHarnessPool {
  id: string
  slug: string
  name: string
}

// ─── Media Post ─────────────────────────────────────────
export type MediaPostType = 'feed_image' | 'carousel' | 'reel' | 'story'
export type MediaPostStatus = 'scheduled' | 'processing' | 'published' | 'failed' | 'canceled'

export interface MediaPostMediaItem {
  url: string
  type: 'image' | 'video'
}

export interface MediaPost {
  id: string
  accountId: string
  postType: MediaPostType
  media: MediaPostMediaItem[]
  caption: string | null
  status: MediaPostStatus
  scheduledAt: string
  creationId: string | null
  publishedMediaId: string | null
  attemptCount: number
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateMediaPostInput {
  postType: MediaPostType
  media: MediaPostMediaItem[]
  caption?: string
  /** ISO 8601。省略で即時投稿 */
  scheduledAt?: string
}

export interface PublishingLimitInfo {
  quotaUsage: number
  quotaTotal: number
}
