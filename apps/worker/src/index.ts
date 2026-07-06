import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { listIgAccounts, updateIgAccount } from '@ig-harness/db';
import { processStepDeliveries } from './services/step-delivery.js';
import { processScheduledBroadcasts } from './services/broadcast.js';
import { processFollowupDrip } from './services/engagement-gate.js';
import { authMiddleware } from './middleware/auth.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
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
import { ensureDefaultAccount, getAccountClient, toIgAccountRef } from './lib/accounts.js';
import { recordCronRun, recordTokenValidity } from './lib/health.js';

export type Env = {
  Bindings: {
    DB: D1Database;
    IMAGES: R2Bucket;
    // ASSETS is optional: create-ig-harness deploys without an [assets] binding,
    // so callers MUST guard `env.ASSETS` before invoking `.fetch` (see notFound below).
    ASSETS?: Fetcher;
    IG_APP_SECRET: string;
    IG_ACCESS_TOKEN: string;
    IG_USER_ID: string;
    IG_VERIFY_TOKEN: string;
    API_KEY: string;
    WORKER_URL: string;
    IG_USERNAME?: string;
    CONTACT_EMAIL?: string;
    LINE_ADD_URL?: string;
    LINE_LIFF_ID?: string;
    LINE_HARNESS_LINK_SECRET?: string;
  };
  Variables: {
    staff: { id: string; name: string; role: 'owner' | 'admin' | 'staff' };
  };
};

const app = new Hono<Env>();

// CORS — allow all origins for MVP
app.use('*', cors({ origin: '*' }));

// Rate limiting — runs before auth to block abuse early
app.use('*', rateLimitMiddleware);

// Auth middleware — skips /webhook automatically
app.use('*', authMiddleware);

// Mount route groups
app.route('/', webhook);
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

// LINE Harness UUID linkage endpoint
app.get('/connect', (c) => {
  const uid = c.req.query('uid');
  const token = c.req.query('token');
  if (!uid || !token) {
    return c.html(`<!DOCTYPE html><html><head><title>Error</title></head><body><h1>Invalid link</h1></body></html>`, 400);
  }
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
<div class="token-box">CONNECT:${token}</div>
<a class="btn" href="https://ig.me/m/${c.env.IG_USERNAME ?? 'your_ig_username'}">DMを開く</a>
<p style="margin-top:24px; font-size:13px; color:#999;">このコードを送信すると、LINEアカウントとInstagramアカウントが連携されます。</p>
</body></html>`);
});

// LINE bridge page — intermediate page between IG and LINE
// Test mode: /line?test=1 shows all link patterns for debugging
app.get('/line', (c) => {
  const ref = c.req.query('ref') ?? 'ig';
  const form = c.req.query('form') ?? '';
  const testMode = c.req.query('test') === '1';
  const liffId = c.env.LINE_LIFF_ID ?? '2009622452-FZBrP4Cz';
  const lineAddUrl = c.env.LINE_ADD_URL ?? 'https://korega-saigo-negai.noda-c40.workers.dev/auth/line';

  const params = new URLSearchParams();
  if (ref) params.set('ref', ref);
  if (form) params.set('form', form);
  const qs = params.toString();

  if (testMode) {
    // Test page with all link patterns
    const links = [
      { label: '1. LIFF (no params)', url: `https://liff.line.me/${liffId}`, desc: 'liff.line.me パラメなし' },
      { label: '2. LIFF + params', url: `https://liff.line.me/${liffId}?${qs}`, desc: 'liff.line.me パラメ付き' },
      { label: '3. line:// scheme', url: `line://app/${liffId}`, desc: 'カスタムスキーム' },
      { label: '4. line:// + params', url: `line://app/${liffId}?${qs}`, desc: 'カスタムスキーム+パラメ' },
      { label: '5. /auth/line (OAuth)', url: `${lineAddUrl}?${qs}`, desc: 'LINE OAuth 直' },
      { label: '6. /auth/line no params', url: lineAddUrl, desc: 'LINE OAuth パラメなし' },
      { label: '7. line.me friend add', url: 'https://line.me/R/ti/p/@' , desc: 'line.me 友だち追加（要@ID）' },
      { label: '8. intent:// (Android)', url: `intent://app/${liffId}#Intent;scheme=line;package=jp.naver.line.android;end`, desc: 'Android Intent' },
    ];

    const buttons = links.map(l =>
      `<a class="btn" href="${l.url}"><span class="num">${l.label}</span><span class="url">${l.desc}</span><span class="raw">${l.url.length > 60 ? l.url.slice(0, 57) + '...' : l.url}</span></a>`
    ).join('');

    return c.html(`<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LINE Link Test</title>
<style>
body { font-family: -apple-system, monospace; max-width: 480px; margin: 0 auto; padding: 20px 12px; background: #1a1a2e; color: #eee; }
h1 { font-size: 18px; text-align: center; margin-bottom: 4px; }
.sub { text-align: center; font-size: 12px; color: #888; margin-bottom: 20px; }
.btn { display: block; background: #16213e; border: 1px solid #0f3460; border-radius: 12px; padding: 14px 16px; margin-bottom: 10px; text-decoration: none; color: #eee; }
.btn:active { background: #0f3460; }
.num { display: block; font-size: 15px; font-weight: bold; color: #06C755; }
.url { display: block; font-size: 12px; color: #aaa; margin-top: 2px; }
.raw { display: block; font-size: 10px; color: #555; margin-top: 4px; word-break: break-all; }
.result { margin-top: 16px; padding: 12px; background: #16213e; border-radius: 8px; font-size: 12px; }
</style></head><body>
<h1>LINE Link Pattern Test</h1>
<p class="sub">IGアプリ内ブラウザからどれが動くかテスト</p>
${buttons}
<div class="result">
<strong>UA:</strong><br>
<span id="ua" style="font-size:10px;color:#888;word-break:break-all;"></span>
</div>
<script>document.getElementById('ua').textContent = navigator.userAgent;</script>
</body></html>`);
  }

  // Production: show the bridge page with best working method
  const liffUrl = `https://liff.line.me/${liffId}?${qs}`;
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

// Data deletion callback (required for Meta app)
app.post('/data-deletion', async (c) => {
  const body = await c.req.json<{ signed_request?: string }>();
  const confirmationCode = crypto.randomUUID();
  return c.json({
    url: `${new URL('/data-deletion', c.req.url).origin}/data-deletion?code=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
});

app.get('/data-deletion', (c) => {
  const code = c.req.query('code');
  return c.html(`<!DOCTYPE html><html><head><title>Data Deletion</title></head><body>
<h1>Data Deletion Request</h1>
<p>Confirmation code: ${code ?? 'N/A'}</p>
<p>Your data has been scheduled for deletion.</p>
</body></html>`);
});

// Privacy policy page (required for Meta app public mode)
app.get('/privacy-policy', (c) => {
  return c.html(`<!DOCTYPE html><html><head><title>Privacy Policy - Instagram Harness</title></head><body>
<h1>Privacy Policy</h1>
<p>Instagram Harness is a self-hosted Instagram DM automation tool. Each user deploys their own instance.</p>
<p>This instance processes Instagram messages and comments solely for the account owner's automation purposes.</p>
<p>No data is shared with third parties. All data is stored in the account owner's Cloudflare D1 database.</p>
<p>Contact: ${c.env.CONTACT_EMAIL ?? 'admin@example.com'}</p>
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
<p>Contact: ${c.env.CONTACT_EMAIL ?? 'admin@example.com'}</p>
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
  await ensureDefaultAccount(env, env.DB);
  // waitUntil keeps the write alive even if scheduled() resolves early.
  ctx.waitUntil(recordCronRun(env.DB).catch(() => {}));
  // `accounts` is the route module above — use a distinct name here.
  const igAccounts = await listIgAccounts(env.DB, { activeOnly: true });

  for (const account of igAccounts) {
    let igClient;
    try {
      // Includes a pre-expiry token refresh per account.
      igClient = await getAccountClient(env, env.DB, account);
    } catch (err) {
      console.error(`[cron] client init failed for ${account.ig_user_id}; skipping:`, err);
      continue;
    }
    // Liveness probe: a real Graph call catches checkpoint/freeze-dead
    // tokens (code 190) that expiry math reports as healthy. The same
    // response self-heals the display username (admin shows @username
    // instead of a raw ig_user_id) and keeps it fresh after renames.
    ctx.waitUntil(
      igClient
        .getMe()
        .then(async (me) => {
          await recordTokenValidity(env.DB, account.id, true);
          if (me.username && me.username !== account.username) {
            await updateIgAccount(env.DB, account.id, { username: me.username });
          }
        })
        .catch(() => recordTokenValidity(env.DB, account.id, false).catch(() => {})),
    );
    const ref = toIgAccountRef(account);
    await Promise.allSettled([
      processStepDeliveries(env.DB, igClient, env.WORKER_URL, account.id),
      processScheduledBroadcasts(env.DB, igClient, env.WORKER_URL, account.id),
      processFollowupDrip(env.DB, igClient, env.WORKER_URL, undefined, ref, account.id),
    ]);
  }
}

export default {
  fetch: app.fetch,
  scheduled,
};
