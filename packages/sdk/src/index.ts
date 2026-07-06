export { InstagramHarness } from './client.js'
export { InstagramHarnessError } from './errors.js'
export { parseDelay } from './delay.js'

// Resource classes (for advanced usage / type narrowing)
export { FriendsResource } from './resources/friends.js'
export { FollowersResource } from './resources/followers.js'
export { TagsResource } from './resources/tags.js'
export { ScenariosResource } from './resources/scenarios.js'
export { BroadcastsResource } from './resources/broadcasts.js'
export { RichMenusResource } from './resources/rich-menus.js'
export { CommentRulesResource } from './resources/comment-rules.js'
export { TrackedLinksResource } from './resources/tracked-links.js'
export { FormsResource } from './resources/forms.js'
export { StaffResource } from './resources/staff.js'
export { ImagesResource } from './resources/images.js'
export { EngagementGatesResource } from './resources/engagement-gates.js'
export { LineConnectionsResource } from './resources/line-connections.js'
export { AdPlatformsResource } from './resources/ad-platforms.js'

// All types
export type {
  InstagramHarnessConfig,
  ApiResponse,
  PaginatedData,
  ScenarioTriggerType,
  MessageType,
  BroadcastStatus,
  Friend,
  FriendListParams,
  Follower,
  FollowerListParams,
  Tag,
  CreateTagInput,
  Scenario,
  ScenarioListItem,
  ScenarioWithSteps,
  ScenarioStep,
  CreateScenarioInput,
  CreateStepInput,
  UpdateScenarioInput,
  UpdateStepInput,
  FriendScenarioEnrollment,
  Broadcast,
  CreateBroadcastInput,
  UpdateBroadcastInput,
  RichMenu,
  CreateRichMenuInput,
  RichMenuAction,
  RichMenuArea,
  RichMenuBounds,
  AdPlatform,
  AdPlatformName,
  ConversionLog,
  ConversionLogStatus,
  CreateAdPlatformInput,
  UpdateAdPlatformInput,
  SegmentRule,
  SegmentCondition,
  StepDefinition,
  CommentRule,
  CreateCommentRuleInput,
  UpdateCommentRuleInput,
  CommentRuleTrigger,
  CommentRuleAction,
  TrackedLink,
  LinkClick,
  TrackedLinkWithClicks,
  CreateTrackedLinkInput,
  FormField,
  Form,
  CreateFormInput,
  UpdateFormInput,
  FormSubmission,
  StaffRole,
  StaffMember,
  StaffProfile,
  CreateStaffInput,
  UpdateStaffInput,
  UploadedImage,
  UploadImageInput,
  EngagementGate,
  EngagementGateWithAnalytics,
  EngagementGateStatus,
  EngagementGateTriggerType,
  GateDeliveryStatus,
  GateAnalytics,
  GateDelivery,
  CreateEngagementGateInput,
  UpdateEngagementGateInput,
  LineConnection,
  CreateLineConnectionInput,
  UpdateLineConnectionInput,
  LineHarnessTrackedLink,
  LineHarnessPool,
} from './types.js'
