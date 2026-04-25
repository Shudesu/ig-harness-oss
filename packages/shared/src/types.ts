// packages/shared/src/types.ts

// ── Core: Followers ──
export interface Follower {
  id: number;
  igsid: string;
  username: string | null;
  name: string | null;
  profilePicUrl: string | null;
  externalUserId: string | null;
  score: number;
  metadata: Record<string, unknown>;
  firstSeenAt: string;
  updatedAt: string;
}

// ── Tags ──
export interface Tag {
  id: number;
  name: string;
  color: string;
  createdAt: string;
}

export interface FollowerTag {
  followerId: number;
  tagId: number;
  createdAt: string;
}

// ── Comment Rules (IG-specific) ──
export type MatchType = "exact" | "contains" | "regex" | "any_comment";
export type ResponseType = "text" | "image" | "template" | "quick_reply";

export interface CommentRule {
  id: number;
  name: string;
  mediaId: string | null;
  keyword: string | null;
  matchType: MatchType;
  responseType: ResponseType;
  responseBody: Record<string, unknown>;
  delaySeconds: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Messages ──
export type MessageDirection = "in" | "out";
export type MessageType = "text" | "image" | "template" | "quick_reply";
export type TriggerSource = "comment_rule" | "scenario" | "broadcast" | "manual";

export interface MessageLog {
  id: number;
  followerId: number | null;
  direction: MessageDirection;
  messageType: MessageType;
  body: Record<string, unknown>;
  triggerSource: TriggerSource | null;
  createdAt: string;
}

// ── Scenarios ──
export type ScenarioTriggerType = "dm_keyword" | "comment" | "manual" | "follower_add";
export type ScenarioStatus = "active" | "completed" | "cancelled";

export interface Scenario {
  id: number;
  name: string;
  triggerType: ScenarioTriggerType;
  triggerKeyword: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScenarioStep {
  id: number;
  scenarioId: number;
  stepOrder: number;
  delayMinutes: number;
  messageType: MessageType;
  body: Record<string, unknown>;
  createdAt: string;
}

export interface FollowerScenario {
  id: number;
  followerId: number;
  scenarioId: number;
  currentStep: number;
  status: ScenarioStatus;
  nextStepAt: string | null;
  enrolledAt: string;
  updatedAt: string;
}

// ── Broadcasts ──
export type BroadcastStatus = "draft" | "scheduled" | "sending" | "sent";

export interface Broadcast {
  id: number;
  name: string;
  messageType: MessageType;
  body: Record<string, unknown>;
  tagFilter: Record<string, unknown> | null;
  status: BroadcastStatus;
  scheduledAt: string | null;
  sentAt: string | null;
  totalSent: number;
  createdAt: string;
  updatedAt: string;
}

// ── Forms ──
export interface Form {
  id: number;
  name: string;
  fields: Record<string, unknown>[];
  isActive: boolean;
  createdAt: string;
}

export interface FormSubmission {
  id: number;
  formId: number;
  followerId: number;
  answers: Record<string, unknown>;
  submittedAt: string;
}

// ── Tracked Links ──
export interface TrackedLink {
  id: number;
  name: string;
  destinationUrl: string;
  refCode: string;
  clickCount: number;
  createdAt: string;
}

export interface LinkClick {
  id: number;
  linkId: number;
  followerId: number | null;
  clickedAt: string;
}

// ── Outgoing Webhooks ──
export type WebhookEvent = "follower_add" | "dm_received" | "dm_sent" | "comment_received" | "scenario_completed" | "form_submitted" | "broadcast_sent";

export interface OutgoingWebhook {
  id: number;
  name: string;
  url: string;
  events: WebhookEvent[];
  secret: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface WebhookLog {
  id: number;
  webhookId: number;
  event: string;
  payload: Record<string, unknown>;
  statusCode: number | null;
  createdAt: string;
}

// ── Staff ──
export type StaffRole = "owner" | "admin" | "staff";

export interface StaffMember {
  id: number;
  name: string;
  role: StaffRole;
  apiKey: string;
  isActive: boolean;
  createdAt: string;
}

// ── API Response ──
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
