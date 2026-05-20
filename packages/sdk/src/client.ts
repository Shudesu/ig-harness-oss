import { HttpClient } from './http.js'
import { FriendsResource } from './resources/friends.js'
import { FollowersResource } from './resources/followers.js'
import { TagsResource } from './resources/tags.js'
import { ScenariosResource } from './resources/scenarios.js'
import { BroadcastsResource } from './resources/broadcasts.js'
import { RichMenusResource } from './resources/rich-menus.js'
import { CommentRulesResource } from './resources/comment-rules.js'
import { TrackedLinksResource } from './resources/tracked-links.js'
import { FormsResource } from './resources/forms.js'
import { StaffResource } from './resources/staff.js'
import { ImagesResource } from './resources/images.js'
import { EngagementGatesResource } from './resources/engagement-gates.js'
import { LineConnectionsResource } from './resources/line-connections.js'
import { RichMessagesResource } from './resources/rich-messages.js'
import { PostsResource } from './resources/posts.js'
import { AdPlatformsResource } from './resources/ad-platforms.js'
import type { InstagramHarnessConfig } from './types.js'

export class InstagramHarness {
  readonly friends: FriendsResource
  readonly followers: FollowersResource
  readonly tags: TagsResource
  readonly scenarios: ScenariosResource
  readonly broadcasts: BroadcastsResource
  readonly richMenus: RichMenusResource
  readonly commentRules: CommentRulesResource
  readonly trackedLinks: TrackedLinksResource
  readonly forms: FormsResource
  readonly staff: StaffResource
  readonly images: ImagesResource
  readonly engagementGates: EngagementGatesResource
  readonly lineConnections: LineConnectionsResource
  readonly richMessages: RichMessagesResource
  readonly posts: PostsResource
  readonly adPlatforms: AdPlatformsResource

  constructor(config: InstagramHarnessConfig) {
    const apiUrl = config.apiUrl.replace(/\/$/, '')

    const http = new HttpClient({
      baseUrl: apiUrl,
      apiKey: config.apiKey,
      timeout: config.timeout ?? 30_000,
    })

    this.friends = new FriendsResource(http)
    this.followers = new FollowersResource(http)
    this.tags = new TagsResource(http)
    this.scenarios = new ScenariosResource(http)
    this.broadcasts = new BroadcastsResource(http)
    this.richMenus = new RichMenusResource(http)
    this.commentRules = new CommentRulesResource(http)
    this.trackedLinks = new TrackedLinksResource(http)
    this.forms = new FormsResource(http)
    this.staff = new StaffResource(http)
    this.images = new ImagesResource(http)
    this.engagementGates = new EngagementGatesResource(http)
    this.lineConnections = new LineConnectionsResource(http)
    this.richMessages = new RichMessagesResource(http)
    this.posts = new PostsResource(http)
    this.adPlatforms = new AdPlatformsResource(http)
  }
}
