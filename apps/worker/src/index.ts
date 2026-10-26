import { publicPageHeaders } from './lib/html.js';
import { beginActivity, endActivity } from './lib/activity.js';
import { scheduledWork } from './lib/scheduled-work.js';
import { encryptLegacyAccountTokens } from './lib/token-crypto.js';
import { armScheduler } from './lib/scheduler-client.js';
export { TenantScheduler } from './tenant-scheduler.js';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { escapeHtml } from './lib/security.js';
import { permissionMiddleware } from './middleware/permissions.js';
import { dataDeletion } from './routes/data-deletion.js';
import { listIgAccounts, getIgAccountById, updateIgAccount } from '@ig-harness/db';
import { processStepDeliveries } from './services/step-delivery.js';
import { processScheduledBroadcasts } from './services/broadcast.js';
import { processFollowupDrip } from './services/engagement-gate.js';
import { authMiddleware } from './middleware/auth.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { pruneExpiredMessages } from './services/retention.js';
import { processQueuedWebhooks } from './routes/webhook.js';
import { processCommentRuleJobs } from './services/comment-rule-jobs.js';
import { webhook } from './routes/webhook.js';
import { friends } from './routes/friends.js';
import { tags } from './routes/tags.js';
import { scenarios } from './routes/scenarios.js';
import { broadcasts } from './routes/broadcasts.js';
import { commentRules } from './routes/comment-rules.js';
import { health } from './routes/health.js';
import { trackedLinks } from './routes/tracked-links.js';
import { forms } from './routes/forms.js';
import { staff } from './routes/staff.js';
import { images } from './routes/images.js';
import { crossLink } from './routes/cross-link.js';
import { engagementGates } from './routes/engagement-gates.js';
import { posts } from './routes/posts.js';
import { richMessages } from './routes/rich-messages.js';
import { integrations } from './routes/integrations.js';
import { lineConnections } from './routes/line-connections.js';
import { accounts } from './routes/accounts.js';
import { capabilities } from './routes/capabilities.js';
import { mediaPosts } from './routes/media-posts.js';
import { processMediaPosts } from './services/media-publish.js';
import { ensureDefaultAccount, getAccountClient, toIgAccountRef } from './lib/accounts.js';
import { recordCronRun, recordTokenValidity } from './lib/health.js';

export type Env = {
  Bindings: {
    DB: D1Database;
    TENANT_SCHEDULER?: DurableObjectNamespace;
    IMAGES: R2Bucket;
    // ASSETS is optional: create-ig-harness deploys without an [assets] binding,
    // so callers MUST guard `env.ASSETS` before invoking `.fetch` (see notFound below).
    ASSETS?: Fetcher;
    TOKEN_ENCRYPTION_KEY?: string;
    IG_APP_SECRET: string;
    IG_ACCESS_TOKEN: string;
    IG_USER_ID: string;
    IG_VERIFY_TOKEN: string;
    API_KEY: string;
    WORKER_URL: string;
    IG_USERNAME?: string;
    CONTACT_EMAIL?: string;
    ADMIN_ORIGINS?: string;
    MESSAGES_RETENTION_DAYS?: string;
    LINE_ADD_URL?: string;
    LINE_LIFF_ID?: string;
    LINE_HARNESS_LINK_SECRET?: string;
  };
  Variables: {
    staff: { id: string; name: string; role: 'owner' | 'admin' | 'staff' };
  };
};

const app = new Hono<Env>();

// Same-origin by default; Pages/custom admin origins must be explicit.
app.use('*', cors({ origin: (origin, c) => {
  const allowed = (c.env.ADMIN_ORIGINS ?? '').split(',').map((s: string) => s.trim()).filter(Boolean);
  allowed.push(new URL(c.req.url).origin);
  return allowed.includes(origin) ? origin : null;
} }));

app.use('*', async (c, next) => {
  if (['/connect','/line','/data-deletion','/privacy-policy','/terms-of-service'].includes(c.req.path)) publicPageHeaders(c);
  await next();
});

// Rate limiting — runs before auth to block abuse early
app.use('*', rateLimitMiddleware);

// Auth middleware — skips /webhook automatically
app.use('*', authMiddleware);
app.use('*', permissionMiddleware);
app.use('/api/*', async (c, next) => {
  if (!c.get('staff') || ['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) || c.req.path.startsWith('/api/data-deletion') || c.req.path.startsWith('/api/internal/')) return next();
  const activity = await beginActivity(c.env.DB);
  if (!activity) return c.json({ error: 'Data deletion is in progress; retry after it completes' }, 409);
  try { await next(); } finally { await endActivity(c.env.DB, activity); }
});

// Called only after authentication. Standalone installs retain their cron clock.
app.post('/api/internal/scheduler/arm', async (c) => {
  if (c.get('staff')?.role !== 'owner') return c.json({ error: 'Forbidden' }, 403);
  await armScheduler(c.env);
  return c.json({ armed: Boolean(c.env.TENANT_SCHEDULER) });
});
app.use('/api/*', async (c, next) => {
  if (c.env.TENANT_SCHEDULER) c.executionCtx.waitUntil(armScheduler(c.env).catch(() => {}));
  await next();
});

// Mount route groups
app.route('/', webhook);
app.route('/', dataDeletion);
app.route('/', friends);
app.route('/', tags);
app.route('/', scenarios);
app.route('/', broadcasts);
app.route('/', commentRules);
app.route('/', health);
app.route('/', trackedLinks);
app.route('/', forms);
app.route('/', staff);
app.route('/', images);
app.route('/', crossLink);
app.route('/', engagementGates);
app.route('/', posts);
app.route('/', richMessages);
app.route('/', integrations);
app.route('/', lineConnections);
app.route('/', accounts);
app.route('/', capabilities);
app.route('/', mediaPosts);

// LINE Harness UUID linkage endpoint
app.get('/connect', (c) => {
  const uid = c.req.query('uid');
  const token = c.req.query('token');
  if (!uid || !token || !/^[A-Za-z0-9_-]{8,128}$/.test(token)) {
    return c.html(`<!DOCTYPE html><html><head><title>Error</title></head><body><h1>Invalid link</h1></body></html>`, 400);
  }
  if (c.env.IG_USERNAME && !/^[A-Za-z0-9._]{1,30}$/.test(c.env.IG_USERNAME)) return c.text('Invalid Instagram username configuration', 503);
  // Show page that instructs user to send the token via IG DM
  return c.html(`<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Instagram連携</title>
<style>
body { font-family: -apple-system, sans-serif; max-width: 480px; margin: 40px auto; padding: 0 20px; text-align: center; }
h1 { font-size: 24px; }
.token-box { background: #f0f0f0; padding: 16px; border-radius: 12px; font-size: 20px; font-weight: bold; letter-spacing: 2px; margin: 20px 0; }
.btn { display: inline-block; background: linear-gradient(135deg, #833AB4, #FD1D1D, #F77737); color: white; padding: 14px 28px; border-radius: 25px; text-decoration: none; font-size: 16px; font-weight: bold; margin-top: 16px; }
p { color: #666; line-height: 1.6; }
</style></head><body>
<h1>📱 Instagram連携</h1>
<p>以下のコードをInstagramのDMで送信してください</p>
<div class="token-box">CONNECT:${escapeHtml(token)}</div>
<a class="btn" href="https://ig.me/m/${encodeURIComponent(c.env.IG_USERNAME ?? 'your_ig_username')}">DMを開く</a>
<p style="margin-top:24px; font-size:13px; color:#999;">このコードを送信すると、LINEアカウントとInstagramアカウントが連携されます。</p>
</body></html>`);
});

// LINE bridge page — intermediate page between IG and LINE
app.get('/line', (c) => {
  const ref = c.req.query('ref') ?? 'ig';
  const form = c.req.query('form') ?? '';
  if (c.req.query('test') !== undefined) return c.text('Not found', 404);
  const liffId = c.env.LINE_LIFF_ID;
  const lineAddUrl = c.env.LINE_ADD_URL;
  if (!liffId && !lineAddUrl) return c.text('LINE integration is not configured', 503);
  if (liffId && !/^\d+-[A-Za-z0-9]+$/.test(liffId)) return c.text('Invalid LINE configuration', 503);
  let target: URL;
  try {
    target = new URL(liffId ? `https://liff.line.me/${liffId}` : lineAddUrl!);
    if (target.protocol !== 'https:') throw new Error('HTTPS required');
  } catch { return c.text('Invalid LINE configuration', 503); }

  const params = new URLSearchParams();
  if (ref) params.set('ref', ref);
  if (form) params.set('form', form);
  const qs = params.toString();

  for (const [key, value] of params) target.searchParams.set(key, value);
  const liffUrl = escapeHtml(target.href);
  return c.html(`<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LINE特典を受け取る</title>
<style>
body { font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px; text-align: center; background: #f8f9fa; }
.card { background: white; border-radius: 16px; padding: 32px 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
h1 { font-size: 22px; margin: 0 0 12px; }
p { color: #666; line-height: 1.6; margin: 8px 0; }
.btn-line { display: inline-block; background: #06C755; color: white; padding: 16px 32px; border-radius: 25px; text-decoration: none; font-size: 17px; font-weight: bold; margin-top: 20px; width: 80%; }
.emoji { font-size: 48px; margin-bottom: 16px; }
.note { font-size: 12px; color: #aaa; margin-top: 24px; }
</style></head><body>
<div class="card">
<div class="emoji">🎁</div>
<h1>限定特典をお届けします</h1>
<p>LINEに友だち追加して<br>特典を受け取ってください</p>
<a class="btn-line" href="${liffUrl}">LINEで受け取る</a>
<p class="note">※ボタンをタップするとLINEアプリが開きます</p>
</div>
</body></html>`);
});

// Handle CONNECT token in DM webhook (processed in webhook.ts handleMessagingEvent)

// Privacy policy page (required for Meta app public mode)
app.get('/privacy-policy', (c) => {
  return c.html(`<!DOCTYPE html><html><head><title>Privacy Policy - Instagram Harness</title></head><body>
<h1>Privacy Policy</h1>
<p>Instagram Harness is a self-hosted Instagram DM automation tool. Each user deploys their own instance.</p>
<p>This instance processes Instagram messages and comments solely for the account owner's automation purposes.</p>
<p>No data is shared with third parties. All data is stored in the account owner's Cloudflare D1 database.</p>
<p>Contact: ${escapeHtml(c.env.CONTACT_EMAIL ?? 'admin@example.com')}</p>
</body></html>`);
});

// Terms of Service page (recommended for Meta app public mode)
app.get('/terms-of-service', (c) => {
  return c.html(`<!DOCTYPE html><html><head><title>Terms of Service - Instagram Harness</title></head><body>
<h1>Terms of Service</h1>
<p>This Instagram Harness instance is operated by the account owner for the sole purpose of automating their own Instagram professional account.</p>
<h2>1. Acceptable use</h2>
<p>This instance only interacts with the Instagram account(s) the owner has explicitly connected. It must not be used to spam, harass, or impersonate other users.</p>
<h2>2. Data handling</h2>
<p>All conversation data, follower data, and webhook payloads are stored in the operator's Cloudflare D1 database and are not shared with third parties. See the <a href="/privacy-policy">Privacy Policy</a> for details.</p>
<h2>3. No warranty</h2>
<p>This software is provided "as is" without warranty of any kind. The operator is not liable for any service interruption, data loss, or Meta policy actions on the connected Instagram account.</p>
<h2>4. Compliance with Meta Platform Terms</h2>
<p>This instance is operated in compliance with the <a href="https://developers.facebook.com/terms/">Meta Platform Terms</a> and the <a href="https://developers.facebook.com/devpolicy/">Meta Developer Policies</a>. Use of automation features must respect Instagram's user-facing rules including rate limits and anti-spam policies.</p>
<h2>5. Contact</h2>
<p>Contact: ${escapeHtml(c.env.CONTACT_EMAIL ?? 'admin@example.com')}</p>
</body></html>`);
});

// 404 fallback — API paths return JSON 404, everything else serves from static assets (admin)
export async function handleNotFound(
  request: Request,
  assets: Fetcher | undefined,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path.startsWith('/api/') || path === '/webhook' || path === '/docs' || path === '/openapi.json') {
    return Response.json({ success: false, error: 'Not found' }, { status: 404 });
  }
  // Serve static assets (admin dashboard) when the [assets] binding is configured.
  // create-ig-harness quickstart deploys without it — fall back to JSON 404 so we
  // never invoke `.fetch` on an undefined binding (was logging TypeError on every /).
  if (assets) {
    return assets.fetch(request);
  }
  return Response.json({ success: false, error: 'Not found' }, { status: 404 });
}

app.notFound((c) => handleNotFound(c.req.raw, c.env.ASSETS));

// Scheduled handler for cron triggers
async function scheduled(
  _event: ScheduledEvent,
  env: Env['Bindings'],
  ctx: ExecutionContext,
): Promise<void> {
  if (env.TENANT_SCHEDULER) {
    await armScheduler(env);
    return;
  }
  await runScheduledJobs(env, ctx);
}

export async function runScheduledJobs(
  env: Env['Bindings'],
  ctx: { waitUntil(promise: Promise<unknown>): void },
): Promise<void> {
  await ensureDefaultAccount(env, env.DB);
  // waitUntil keeps the write alive even if scheduled() resolves early.
  ctx.waitUntil(recordCronRun(env.DB).catch(() => {}));
  // `accounts` is the route module above — use a distinct name here.
  await encryptLegacyAccountTokens(env.DB, env.TOKEN_ENCRYPTION_KEY);
  await pruneExpiredMessages(env.DB, env.MESSAGES_RETENTION_DAYS);
  const igAccounts = await listIgAccounts(env.DB, { activeOnly: true });

  for (const account of igAccounts) {
    const [work, lastProbe] = await Promise.all([
      scheduledWork(env.DB, account.id),
      env.DB.prepare('SELECT value FROM integration_settings WHERE key=?').bind(`health:token_valid:${account.id}`).first<{ value: string }>(),
    ]);
    if (!work || work.deletion_locked) continue;
    let lastChecked = 0;
    try { lastChecked = Date.parse(JSON.parse(lastProbe?.value ?? '{}').checked_at) || 0; } catch { /* invalid probe record */ }
    const probeDue = lastChecked <= Date.now() - 60 * 60_000;
    if (!probeDue && ![work.steps, work.broadcasts, work.followups, work.media, work.webhooks, work.comments].some(Boolean)) continue;
    const activity = await beginActivity(env.DB);
    if (!activity) continue;
    try {
      const current = await getIgAccountById(env.DB, account.id);
      if (!current || !current.is_active) continue;
      const igClient = await getAccountClient(env, env.DB, current);
      if (probeDue) {
        try {
          const me = await igClient.getMe();
          await recordTokenValidity(env.DB, account.id, true);
          if (me.username && me.username !== account.username) await updateIgAccount(env.DB, account.id, { username: me.username });
        } catch { await recordTokenValidity(env.DB, account.id, false); }
      }
      const ref = toIgAccountRef(account);
      const tasks: Array<[string, Promise<unknown>]> = [];
      if (work.steps) tasks.push(['steps', processStepDeliveries(env.DB, igClient, env.WORKER_URL, account.id)]);
      if (work.broadcasts) tasks.push(['broadcasts', processScheduledBroadcasts(env.DB, igClient, env.WORKER_URL, account.id)]);
      if (work.followups) tasks.push(['followups', processFollowupDrip(env.DB, igClient, env.WORKER_URL, undefined, ref, account.id)]);
      if (work.media) tasks.push(['media', processMediaPosts(env.DB, igClient, account.id)]);
      if (work.webhooks) tasks.push(['webhooks', processQueuedWebhooks(env.DB, igClient, account, env.WORKER_URL)]);
      else if (work.comments) tasks.push(['comments', processCommentRuleJobs(env.DB, igClient, account.id)]);
      const results = await Promise.allSettled(tasks.map(([, task]) => task));
      results.forEach((result, i) => {
        if (result.status === 'rejected') console.error(`[cron] ${tasks[i]![0]} failed for account=${account.id}`, result.reason instanceof Error ? result.reason.name : 'unknown');
      });
    } catch (error) {
      console.error('[cron] account processing failed', { accountId: account.id, kind: error instanceof Error ? error.name : 'unknown' });
    } finally { await endActivity(env.DB, activity); }
  }
}

export default {
  fetch: app.fetch,
  scheduled,
};
