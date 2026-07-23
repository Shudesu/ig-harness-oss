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

    const allowedImageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    const allowedVideoTypes = ['video/mp4', 'video/quicktime'];
    const isVideo = allowedVideoTypes.includes(mimeType);
    if (!allowedImageTypes.includes(mimeType) && !isVideo) {
      return c.json(
        {
          success: false,
          error: `Unsupported media type: ${mimeType}. Allowed: ${[...allowedImageTypes, ...allowedVideoTypes].join(', ')}`,
        },
        400,
      );
    }

    // Videos (reels / video stories) are allowed up to 100MB — the Workers
    // request body limit. Larger files must be hosted externally.
    const maxBytes = isVideo ? 100 * 1024 * 1024 : 5 * 1024 * 1024;
    if (data.byteLength > maxBytes) {
      return c.json(
        { success: false, error: `File too large (max ${isVideo ? '100MB' : '5MB'})` },
        400,
      );
    }

    const subtype = mimeType.split('/')[1];
    const ext = subtype === 'jpeg' ? 'jpg' : subtype === 'quicktime' ? 'mov' : subtype;
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

/**
 * Parse a "Range: bytes=start-end" header against a known total size.
 * Supports suffix ranges ("bytes=-500") and open-ended ranges
 * ("bytes=500-"). Returns null when the header is malformed or the range
 * is unsatisfiable for the given size (caller responds 416).
 */
export function parseByteRange(
  header: string,
  size: number,
): { start: number; end: number } | null {
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const [, startStr, endStr] = match;
  if (startStr === '' && endStr === '') return null;

  let start: number;
  let end: number;
  if (startStr === '') {
    // Suffix range: last N bytes.
    const suffixLength = Number(endStr);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr === '' ? size - 1 : Number(endStr);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= size) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}

// GET /images/:key — serve image (public, no auth)
// Always sets Content-Length + Accept-Ranges, and supports byte-range
// requests: Meta's video fetcher probes hosted files (used for reels/video
// stories) with range/length semantics before ingesting them.
images.get('/images/:key', async (c) => {
  const key = c.req.param('key');
  const rangeHeader = c.req.header('Range');

  if (!rangeHeader) {
    const object = await c.env.IMAGES.get(key);
    if (!object) {
      return c.json({ success: false, error: 'Image not found' }, 404);
    }
    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || 'image/png');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('ETag', object.etag);
    headers.set('Content-Length', String(object.size));
    headers.set('Accept-Ranges', 'bytes');
    return new Response(object.body, { headers });
  }

  // Ranged request — need the full object size first; a ranged R2 get
  // still reports object.size as the FULL size, not the slice, so the
  // slice length must be computed from the parsed range.
  const head = await c.env.IMAGES.head(key);
  if (!head) {
    return c.json({ success: false, error: 'Image not found' }, 404);
  }
  const total = head.size;
  const range = parseByteRange(rangeHeader, total);
  if (!range) {
    const headers = new Headers();
    headers.set('Content-Range', `bytes */${total}`);
    return new Response(null, { status: 416, headers });
  }

  const { start, end } = range;
  const length = end - start + 1;
  const object = await c.env.IMAGES.get(key, { range: { offset: start, length } });
  if (!object) {
    return c.json({ success: false, error: 'Image not found' }, 404);
  }
  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'image/png');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.etag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
  headers.set('Content-Length', String(length));
  return new Response(object.body, { status: 206, headers });
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
