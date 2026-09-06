# Instagram Harness API Reference

## Authentication

All API endpoints require Bearer token authentication (except `/webhook`, `/privacy-policy`, `/data-deletion`, `/connect`).

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" https://your-worker.workers.dev/api/...
```

---

## Followers

### List Followers
```
GET /api/friends?limit=50&offset=0&search=username&tagId=1
```

### Get Follower Detail
```
GET /api/friends/:id
```
Returns follower with tags and scenario enrollments.

### Update Follower Metadata
```
PUT /api/friends/:id/metadata
{"key": "value"}
```

### Add Tag to Follower
```
POST /api/friends/:id/tags
{"tagId": 1}
```

### Remove Tag from Follower
```
DELETE /api/friends/:id/tags/:tagId
```

### Send DM to Follower
```
POST /api/friends/:id/messages
{"messageType": "text", "content": "{\"text\": \"Hello!\"}"}
```

Message types: `text`, `image`, `template`, `quick_reply`

---

## Tags

### List Tags
```
GET /api/tags
```

### Create Tag
```
POST /api/tags
{"name": "IG流入", "color": "#E91E63"}
```

### Delete Tag
```
DELETE /api/tags/:id
```

---

## Comment Rules

### List Rules
```
GET /api/comment-rules
```

### Create Rule
```
POST /api/comment-rules
{
  "name": "仕組みコメント→DM",
  "mediaId": "18073511762631259",  // null = all posts
  "keyword": "仕組み",              // null = all comments
  "matchType": "contains",          // exact | contains | regex
  "responseType": "text",           // text | image | template | quick_reply
  "responseBody": {"text": "ありがとう！"},
  "replyText": "@{{username}} DMを送りました！",  // null = default
  "delaySeconds": 0
}
```

### Variables in responseBody
- `{{igsid}}` — Instagram Scoped ID
- `{{username}}` — Instagram username
- `{{follower_id}}` — Internal follower ID

### Update Rule
```
PUT /api/comment-rules/:id
{"isActive": false}
```

### Delete Rule
```
DELETE /api/comment-rules/:id
```

---

## Scenarios (Step Delivery)

### List Scenarios
```
GET /api/scenarios
```

### Create Scenario
```
POST /api/scenarios
{
  "name": "Welcome Sequence",
  "triggerType": "dm_keyword",  // dm_keyword | comment | manual | follower_add
  "triggerKeyword": "プレゼント"
}
```

### Add Step
```
POST /api/scenarios/:id/steps
{
  "stepOrder": 1,
  "delayMinutes": 0,
  "messageType": "text",
  "body": "{\"text\": \"Welcome!\"}"
}
```

### Enroll Follower
```
POST /api/scenarios/:id/enroll/:followerId
```

---

## Broadcasts

### Create Broadcast
```
POST /api/broadcasts
{
  "name": "Campaign 2026",
  "messageType": "text",
  "body": "{\"text\": \"📢 Big announcement!\"}",
  "tagFilter": "{\"tagId\": 1}",   // optional — filter by tag
  "scheduledAt": "2026-04-03T09:00:00Z"  // optional — schedule
}
```

### Send Broadcast
```
POST /api/broadcasts/:id/send
```

### List Broadcasts
```
GET /api/broadcasts
```

---

## Forms

### Create Form
```
POST /api/forms
{
  "name": "Signup Form",
  "fields": [
    {"name": "name", "type": "text", "required": true},
    {"name": "email", "type": "email", "required": true}
  ]
}
```

### Get Submissions
```
GET /api/forms/:id/submissions
```

---

## Tracked Links

### Create Tracked Link
```
POST /api/tracked-links
{
  "name": "LINE CTA",
  "destinationUrl": "https://liff.line.me/xxx?ref=ig_campaign"
}
```

Generates a short URL: `https://your-worker.workers.dev/r/:refCode`

### Get Click Stats
```
GET /api/tracked-links/:id
```

---

## Staff

### List Staff
```
GET /api/staff
```

### Create Staff Member
```
POST /api/staff
{"name": "Admin", "role": "admin"}
```
Returns API key for the new staff member.

---

## Images

### Upload Image
```
POST /api/images
Content-Type: multipart/form-data
file: (binary)
```
Uploads to R2. Returns URL for use in DM messages.

---

## Webhook

### Meta Verification
```
GET /webhook?hub.mode=subscribe&hub.verify_token=TOKEN&hub.challenge=CHALLENGE
```

### Event Reception
```
POST /webhook
X-Hub-Signature-256: sha256=...
```
Handles: `messages`, `messaging_postbacks`, `messaging_referral`, `comments`, `mentions`

---

## SDK Usage

```typescript
import { InstagramHarness } from '@ig-harness/sdk';

const client = new InstagramHarness({
  apiUrl: 'https://your-worker.workers.dev',
  apiKey: 'your-api-key',
});

// List followers
const { items } = await client.followers.list();

// Create tag
const tag = await client.tags.create({ name: 'VIP', color: '#FFD700' });

// Create comment rule
await client.commentRules.create({
  name: 'Promo',
  keyword: 'info',
  matchType: 'contains',
  responseType: 'text',
  responseBody: { text: 'Thanks!' },
});

// Create scenario
const scenario = await client.scenarios.create({
  name: 'Welcome',
  triggerType: 'dm_keyword',
  triggerKeyword: 'start',
});

// Send broadcast
const broadcast = await client.broadcasts.create({
  name: 'Announcement',
  messageType: 'text',
  body: JSON.stringify({ text: 'Hello everyone!' }),
});
```

---

## MCP Server

23 tools available for Claude Code integration:

| Tool | Description |
|------|-------------|
| `list_followers` | List followers with filters |
| `get_follower_detail` | Get follower + tags + scenarios |
| `manage_followers` | Update metadata, score |
| `manage_tags` | CRUD + assign/remove |
| `create_comment_rule` | Auto DM on comments |
| `manage_comment_rules` | List/update/delete/toggle |
| `send_dm` | Send DM (text/image/template/quick_reply) |
| `broadcast` | Mass DM to all/tag segment |
| `create_scenario` | Step delivery sequence |
| `manage_scenarios` | CRUD + step management |
| `enroll_in_scenario` | Enroll follower |
| `create_form` | DM-based forms |
| `manage_forms` | CRUD |
| `get_form_submissions` | Retrieve answers |
| `create_tracked_link` | URL click tracking |
| `manage_tracked_links` | CRUD |
| `get_link_clicks` | Click analytics |
| `manage_outgoing_webhooks` | Webhook destinations |
| `manage_staff` | API key management |
| `upload_image` | R2 image hosting |
| `account_summary` | Overview stats |

### MCP Configuration

```json
{
  "mcpServers": {
    "instagram-harness": {
      "command": "node",
      "args": ["path/to/instagram-harness/packages/mcp-server/dist/index.js"],
      "env": {
        "INSTAGRAM_HARNESS_API_URL": "https://your-worker.workers.dev",
        "INSTAGRAM_HARNESS_API_KEY": "your-api-key"
      }
    }
  }
}
```
