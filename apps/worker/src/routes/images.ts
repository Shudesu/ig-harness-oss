import { Hono } from 'hono';
import { getFriendByIgsid, getIgAccountById, getDefaultIgAccount } from '@ig-harness/db';
import { getAccountClient } from '../lib/accounts.js';
import type { Env } from '../index.js';

const PROFILE_PIC_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days in ms

const images = new Hono<Env>();

// POST /api/images — upload image (base64 or binary)
images.post('/api/images', async (c) => {
  try {
    const contentType = c.req.header('Content-Type') || '';

    let data: ArrayBuffer;
    let mimeType: string;
    let filename: string | undefined;

    if (contentType.includes('application/json')) {
      const body = await c.req.json<{
        data: string;
        mimeType?: string;
        filename?: string;
      }>();

      if (!body.data) {
        return c.json({ success: false, error: 'data (base64) is required' }, 400);
      }

      let base64 = body.data;
      if (base64.startsWith('data:')) {
        const match = base64.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          mimeType = match[1];
          base64 = match[2];
        }
      }
      mimeType ??= body.mimeType ?? 'image/png';
      filename = body.filename;

      const binary = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
      data = binary.buffer;
    } else {
      data = await c.req.arrayBuffer();
      mimeType = contentType.split(';')[0] || 'image/png';
    }

    if (data.byteLength > 5 * 1024 * 1024) {
      return c.json({ success: false, error: 'Image too large (max 5MB)' }, 400);
    }

    const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(mimeType)) {
      return c.json({ success: false, error: `Unsupported image type: ${mimeType}. Allowed: ${allowedTypes.join(', ')}` }, 400);
    }

    const ext = mimeType.split('/')[1] === 'jpeg' ? 'jpg' : mimeType.split('/')[1];
    const id = crypto.randomUUID();
    const key = `${id}.${ext}`;

    await c.env.IMAGES.put(key, data, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { originalFilename: filename ?? key },
    });

    const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
    const url = `${workerUrl}/images/${key}`;

    return c.json({
      success: true,
      data: { id, key, url, mimeType, size: data.byteLength },
    }, 201);
  } catch (err) {
    console.error('POST /api/images error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/images — list uploaded images (authed, for gallery UI)
images.get('/api/images', async (c) => {
  const cursor = c.req.query('cursor') ?? undefined;
  const rawLimit = Number(c.req.query('limit') ?? '50');
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 50, 1), 200);

  // delimiter '/' keeps this gallery to operator-uploaded images only:
  // profile-picture cache objects live under the `profile-pics/` prefix
  // (written by GET /images/profile-pics/:igsid) and are rolled up into
  // delimitedPrefixes instead of polluting `objects`. Pagination stays
  // correct because the cache keys never enter the object listing.
  const listed = await c.env.IMAGES.list({ limit, cursor, delimiter: '/' });
  const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;

  const items = listed.objects.map((obj) => ({
    key: obj.key,
    url: `${workerUrl}/images/${obj.key}`,
    size: obj.size,
    uploaded: obj.uploaded.toISOString(),
    content_type: obj.httpMetadata?.contentType ?? 'application/octet-stream',
    original_filename: obj.customMetadata?.originalFilename,
  }));

  return c.json({
    success: true,
    data: {
      items,
      truncated: listed.truncated,
      cursor: listed.truncated ? listed.cursor : null,
    },
  });
});

// GET /images/profile-pics/:igsid — on-demand profile picture cache (public, no auth)
images.get('/images/profile-pics/:igsid', async (c) => {
  const igsid = c.req.param('igsid');
  const r2Key = `profile-pics/${igsid}`;
  const db = c.env.DB;
  const env = c.env;

  const notAvailable = () =>
    c.json({ success: false, error: 'Profile picture not available' }, 404);

  const serveCached = (obj: R2ObjectBody) =>
    new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType ?? 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });

  // Step 1 — check R2 cache
  let r2Object: R2ObjectBody | null = null;
  try {
    r2Object = await c.env.IMAGES.get(r2Key);
  } catch (err) {
    console.error('[profile-pics] R2 get error:', err);
  }

  const isFresh = (obj: R2ObjectBody): boolean => {
    const cachedAt = obj.customMetadata?.cachedAt;
    if (!cachedAt) return false;
    return Date.now() - new Date(cachedAt).getTime() < PROFILE_PIC_TTL_MS;
  };

  if (r2Object && isFresh(r2Object)) {
    // Fresh cache hit — serve without any DB/Graph call
    return serveCached(r2Object);
  }

  // Step 2 — cache miss or stale: fetch fresh from IG Graph
  try {
    // Resolve account: try follower's account_id first, else default
    const follower = await getFriendByIgsid(db, igsid);
    if (!follower) {
      // Unknown IGSID: this endpoint is public, so don't let arbitrary
      // probes spend Graph API calls. Serve stale if we have it.
      return r2Object ? serveCached(r2Object) : notAvailable();
    }

    let account = null;
    const accountId = follower?.account_id ?? null;

    if (accountId) {
      account = await getIgAccountById(db, accountId);
    }
    if (!account) {
      account = await getDefaultIgAccount(db);
    }

    if (!account) {
      // No account available — fall back to stale or 404
      return r2Object ? serveCached(r2Object) : notAvailable();
    }

    const igClient = await getAccountClient(env, db, account);
    const profile = await igClient.getUserProfile(igsid);

    if (!profile.profile_pic) {
      // No profile_pic on profile
      return r2Object ? serveCached(r2Object) : notAvailable();
    }

    // Fetch CDN URL
    let cdnRes: Response;
    try {
      cdnRes = await fetch(profile.profile_pic);
    } catch (err) {
      console.error('[profile-pics] CDN fetch error:', err);
      return r2Object ? serveCached(r2Object) : notAvailable();
    }

    if (!cdnRes.ok) {
      console.error('[profile-pics] CDN returned non-ok status:', cdnRes.status);
      return r2Object ? serveCached(r2Object) : notAvailable();
    }

    const contentType = cdnRes.headers.get('Content-Type') ?? 'image/jpeg';
    const imageBuffer = await cdnRes.arrayBuffer();

    // Store to R2
    await c.env.IMAGES.put(r2Key, imageBuffer, {
      httpMetadata: { contentType },
      customMetadata: { cachedAt: new Date().toISOString() },
    });

    return new Response(imageBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    console.error('[profile-pics] graph error:', err);
    // Graceful degradation: serve stale if available
    return r2Object ? serveCached(r2Object) : notAvailable();
  }
});

// GET /images/:key — serve image (public, no auth)
images.get('/images/:key', async (c) => {
  const key = c.req.param('key');
  const object = await c.env.IMAGES.get(key);

  if (!object) {
    return c.json({ success: false, error: 'Image not found' }, 404);
  }

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'image/png');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.etag);

  return new Response(object.body, { headers });
});

// DELETE /api/images/:key — delete image
images.delete('/api/images/:key', async (c) => {
  try {
    const key = c.req.param('key');
    await c.env.IMAGES.delete(key);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/images/:key error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { images };
