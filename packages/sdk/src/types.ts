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
  initial_dm_text: string
  initial_dm_button_label?: string
  follow_reminder_dm_text: string
  follow_reminder_button_label?: string
  reward_dm_text: string
  reward_url?: string | null
  max_loops?: number
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
