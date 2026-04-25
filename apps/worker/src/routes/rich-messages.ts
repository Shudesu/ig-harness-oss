import { Hono } from 'hono';
import {
  createRichMessage,
  listRichMessages,
  getRichMessage,
  updateRichMessage,
  deleteRichMessage,
  findGatesUsingRichMessage,
  hasCheckFollowPostback,
} from '@ig-harness/db';
import type { RichMessageKind } from '@ig-harness/db';
import type { RichMessageBlock } from '@ig-harness/ig-sdk';
import { InstagramClient } from '@ig-harness/ig-sdk';
import { getIGAccessToken } from '../lib/ig-token.js';
import type { Env } from '../index.js';

const VALID_KINDS: readonly RichMessageKind[] = ['cta', 'reward', 'reminder', 'generic'];

// Accepts https:// URLs OR placeholder-only strings like `{REWARD_URL}`.
// Interpolation at send time substitutes {IGSID}, {GATE_ID}, {DELIVERY_ID},
// {REWARD_URL}, {FOLLOWER_USERNAME}.
function isValidUrlOrPlaceholder(value: string): boolean {
  if (/^https:\/\//.test(value)) return true;
  // Strip all {...} placeholders and see if what's left is empty or a valid
  // URL start. Callers are expected to ensure the *expanded* URL is https.
  const stripped = value.replace(/\{\{?\s*[A-Z_]+\s*\}?\}/g, '').trim();
  if (stripped.length === 0) return true;
  return /^https:\/\//.test(stripped);
}

function validateButton(button: unknown, path: string): string | null {
  if (!button || typeof button !== 'object') return `${path} is not an object`;
  const b = button as Record<string, unknown>;
  if (typeof b.label !== 'string' || b.label.length === 0) return `${path}.label required (non-empty string)`;
  if (b.type === 'postback') {
    if (typeof b.payload !== 'string' || b.payload.length === 0) return `${path}.payload required for postback`;
  } else if (b.type === 'url') {
    if (typeof b.url !== 'string' || !isValidUrlOrPlaceholder(b.url)) {
      return `${path}.url must be https URL or placeholder (e.g. {REWARD_URL})`;
    }
  } else {
    return `${path}.type must be 'postback' or 'url' (got ${String(b.type)})`;
  }
  return null;
}

function validateCard(card: unknown, path: string): string | null {
  if (!card || typeof card !== 'object') return `${path} is not an object`;
  const c = card as Record<string, unknown>;
  if (typeof c.title !== 'string' || c.title.length === 0) return `${path}.title required (non-empty string)`;
  if (c.image_url !== undefined && (typeof c.image_url !== 'string' || !isValidUrlOrPlaceholder(c.image_url))) {
    return `${path}.image_url must be https URL or placeholder`;
  }
  if (!Array.isArray(c.buttons) || c.buttons.length < 1 || c.buttons.length > 3) {
    return `${path}.buttons must contain 1..3 entries`;
  }
  for (let j = 0; j < c.buttons.length; j++) {
    const err = validateButton(c.buttons[j], `${path}.buttons[${j}]`);
    if (err) return err;
  }
  return null;
}

function validateBlocks(blocks: unknown): { ok: true; blocks: RichMessageBlock[] } | { ok: false; error: string } {
  if (!Array.isArray(blocks)) return { ok: false, error: 'blocks must be an array' };
  if (blocks.length === 0 || blocks.length > 5) {
    return { ok: false, error: 'blocks must contain 1 to 5 entries' };
  }

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i] as Record<string, unknown>;
    if (!b || typeof b !== 'object') return { ok: false, error: `blocks[${i}] is not an object` };
    switch (b.type) {
      case 'text':
        if (typeof b.text !== 'string') return { ok: false, error: `blocks[${i}].text required` };
        if ((b.text as string).length === 0 || (b.text as string).length > 1000) {
          return { ok: false, error: `blocks[${i}].text length must be 1..1000` };
        }
        break;
      case 'image':
        if (typeof b.url !== 'string' || !/^https:\/\//.test(b.url)) {
          return { ok: false, error: `blocks[${i}].url must be https URL` };
        }
        break;
      case 'card': {
        const err = validateCard(b, `blocks[${i}]`);
        if (err) return { ok: false, error: err };
        break;
      }
      case 'carousel': {
        if (!Array.isArray(b.cards) || b.cards.length < 1 || b.cards.length > 10) {
          return { ok: false, error: `blocks[${i}].cards must contain 1..10 entries` };
        }
        for (let j = 0; j < b.cards.length; j++) {
          const err = validateCard(b.cards[j], `blocks[${i}].cards[${j}]`);
          if (err) return { ok: false, error: err };
        }
        break;
      }
      case 'quick_replies': {
        if (typeof b.text !== 'string' || b.text.length === 0 || b.text.length > 1000) {
          return { ok: false, error: `blocks[${i}].text length must be 1..1000` };
        }
        if (!Array.isArray(b.replies) || b.replies.length < 1 || b.replies.length > 13) {
          return { ok: false, error: `blocks[${i}].replies must contain 1..13 entries` };
        }
        for (let j = 0; j < b.replies.length; j++) {
          const r = b.replies[j] as Record<string, unknown>;
          if (!r || typeof r !== 'object') return { ok: false, error: `blocks[${i}].replies[${j}] is not an object` };
          if (typeof r.label !== 'string' || r.label.length === 0) {
            return { ok: false, error: `blocks[${i}].replies[${j}].label required` };
          }
          if (typeof r.payload !== 'string' || r.payload.length === 0) {
            return { ok: false, error: `blocks[${i}].replies[${j}].payload required` };
          }
        }
        break;
      }
      default:
        return { ok: false, error: `blocks[${i}].type unsupported: ${String(b.type)}` };
    }
  }
  return { ok: true, blocks: blocks as RichMessageBlock[] };
}

const richMessages = new Hono<Env>();

richMessages.get('/api/rich-messages', async (c) => {
  const kind = c.req.query('kind') as RichMessageKind | undefined;
  const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined;
  if (kind && !VALID_KINDS.includes(kind)) {
    return c.json({ success: false, error: `invalid kind: ${kind}` }, 400);
  }
  const messages = await listRichMessages(c.env.DB, { kind, limit });
  return c.json({ success: true, data: messages });
});

richMessages.post('/api/rich-messages', async (c) => {
  const body = await c.req.json<{ name?: string; kind?: RichMessageKind; blocks?: unknown }>();
  if (!body.name || !body.kind) {
    return c.json({ success: false, error: 'name and kind required' }, 400);
  }
  if (!VALID_KINDS.includes(body.kind)) {
    return c.json({ success: false, error: `invalid kind: ${body.kind}` }, 400);
  }
  const v = validateBlocks(body.blocks);
  if (!v.ok) return c.json({ success: false, error: v.error }, 400);

  const rm = await createRichMessage(c.env.DB, {
    name: body.name,
    kind: body.kind,
    blocks: v.blocks,
  });
  return c.json({ success: true, data: rm });
});

richMessages.get('/api/rich-messages/:id', async (c) => {
  const id = c.req.param('id');
  const rm = await getRichMessage(c.env.DB, id);
  if (!rm) return c.json({ success: false, error: 'not found' }, 404);
  return c.json({ success: true, data: rm });
});

richMessages.patch('/api/rich-messages/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ name?: string; kind?: RichMessageKind; blocks?: unknown }>();
  const patch: { name?: string; kind?: RichMessageKind; blocks?: RichMessageBlock[] } = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.kind !== undefined) {
    if (!VALID_KINDS.includes(body.kind)) {
      return c.json({ success: false, error: `invalid kind: ${body.kind}` }, 400);
    }
    patch.kind = body.kind;
  }
  if (body.blocks !== undefined) {
    const v = validateBlocks(body.blocks);
    if (!v.ok) return c.json({ success: false, error: v.error }, 400);
    patch.blocks = v.blocks;

    // If any live gate depends on this message as a CTA or as a reminder
    // (with require_follow=1), the new blocks MUST keep the CHECK_FOLLOW
    // postback. Otherwise deliveries issued with the new blocks stall.
    const refs = await findGatesUsingRichMessage(c.env.DB, id);
    if (refs.length > 0 && !hasCheckFollowPostback(v.blocks)) {
      const blocking: Array<{ id: string; name: string; slot: string }> = [];
      for (const ref of refs) {
        if (ref.slot === 'initial') {
          blocking.push(ref);
        } else if (ref.slot === 'reminder') {
          const gate = await c.env.DB
            .prepare('SELECT require_follow FROM engagement_gates WHERE id = ?')
            .bind(ref.id)
            .first<{ require_follow: number }>();
          if (gate && gate.require_follow === 1) blocking.push(ref);
        }
      }
      if (blocking.length > 0) {
        return c.json(
          {
            success: false,
            error:
              'blocks must keep a postback button with payload "CHECK_FOLLOW:{GATE_ID}:{DELIVERY_ID}" while referenced by live gates',
            references: blocking,
          },
          409,
        );
      }
    }
  }
  await updateRichMessage(c.env.DB, id, patch);
  const rm = await getRichMessage(c.env.DB, id);
  return c.json({ success: true, data: rm });
});

richMessages.delete('/api/rich-messages/:id', async (c) => {
  const id = c.req.param('id');
  const force = c.req.query('force') === '1';
  const refs = await findGatesUsingRichMessage(c.env.DB, id);
  if (refs.length > 0 && !force) {
    return c.json(
      { success: false, error: 'in use by engagement gates', references: refs },
      409,
    );
  }
  await deleteRichMessage(c.env.DB, id);
  return c.json({ success: true });
});

/**
 * Test-send a rich message to an arbitrary IGSID (typically the operator's own).
 * Body: { to_igsid: string }
 */
richMessages.post('/api/rich-messages/:id/test-send', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ to_igsid?: string; reward_url?: string; follower_username?: string }>();
  if (!body.to_igsid) {
    return c.json({ success: false, error: 'to_igsid required' }, 400);
  }
  const rm = await getRichMessage(c.env.DB, id);
  if (!rm) return c.json({ success: false, error: 'not found' }, 404);

  const igClient = new InstagramClient({
    accessToken: await getIGAccessToken(c.env),
    igUserId: c.env.IG_USER_ID,
  });

  try {
    const res = await igClient.sendRichMessage(body.to_igsid, rm.blocks, {
      rewardUrl: body.reward_url ?? null,
      followerUsername: body.follower_username ?? null,
      // Stable placeholder values so postback payloads don't collapse to empty
      // strings during preview.
      gateId: 'preview-gate',
      deliveryId: 'preview-delivery',
    });
    return c.json({ success: true, data: { sent_blocks: res.sentBlocks, sent_at: new Date().toISOString() } });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

export { richMessages };
