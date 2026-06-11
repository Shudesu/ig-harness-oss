import { HttpClient } from './http.js'
import { FollowersResource } from './resources/followers.js'
import { TagsResource } from './resources/tags.js'
import { ScenariosResource } from './resources/scenarios.js'
import { BroadcastsResource } from './resources/broadcasts.js'
import { CommentRulesResource } from './resources/comment-rules.js'
import { TrackedLinksResource } from './resources/tracked-links.js'
import { FormsResource } from './resources/forms.js'
import { StaffResource } from './resources/staff.js'
import { ImagesResource } from './resources/images.js'
import { EngagementGatesResource } from './resources/engagement-gates.js'
import { LineConnectionsResource } from './resources/line-connections.js'
import { RichMessagesResource } from './resources/rich-messages.js'
import { PostsResource } from './resources/posts.js'
import type { InstagramHarnessConfig } from './types.js'

export class InstagramHarness {
  readonly followers: FollowersResource
  readonly tags: TagsResource
  readonly scenarios: ScenariosResource
  readonly broadcasts: BroadcastsResource
  readonly commentRules: CommentRulesResource
  readonly trackedLinks: TrackedLinksResource
  readonly forms: FormsResource
  readonly staff: StaffResource
  readonly images: ImagesResource
  readonly engagementGates: EngagementGatesResource
  readonly lineConnections: LineConnectionsResource
  readonly richMessages: RichMessagesResource
  readonly posts: PostsResource

  constructor(config: InstagramHarnessConfig) {
    const apiUrl = config.apiUrl.replace(/\/$/, '')

    const http = new HttpClient({
      baseUrl: apiUrl,
      apiKey: config.apiKey,
      timeout: config.timeout ?? 30_000,
      accountId: config.accountId,
    })

    this.followers = new FollowersResource(http)
    this.tags = new TagsResource(http)
    this.scenarios = new ScenariosResource(http)
    this.broadcasts = new BroadcastsResource(http)
    this.commentRules = new CommentRulesResource(http)
    this.trackedLinks = new TrackedLinksResource(http)
    this.forms = new FormsResource(http)
    this.staff = new StaffResource(http)
    this.images = new ImagesResource(http)
    this.engagementGates = new EngagementGatesResource(http)
    this.lineConnections = new LineConnectionsResource(http)
    this.richMessages = new RichMessagesResource(http)
    this.posts = new PostsResource(http)
  }
}
