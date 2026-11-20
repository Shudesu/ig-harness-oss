import { messagingEligibility } from '../services/messaging-window.js';
import { isOutboundPaused } from '../services/human-touch.js';
import { Hono } from 'hono';
import {
  getForms,
  getFormById,
  createForm,
  updateForm,
  deleteForm,
  getFormSubmissions,
  createFormSubmission,
  jstNow,
} from '@ig-harness/db';
import { getFriendById, getIgAccountById } from '@ig-harness/db';
import { issueFormToken, verifyTrackingToken } from '../lib/tracking-token.js';
import { addTagToFriend, enrollFriendInScenario } from '@ig-harness/db';
import type { Form as DbForm, FormSubmission as DbFormSubmission } from '@ig-harness/db';
import { resolveAccount, getAccountClient } from '../lib/accounts.js';
import type { Env } from '../index.js';

const forms = new Hono<Env>();

function serializeForm(row: DbForm) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    fields: JSON.parse(row.fields || '[]') as unknown[],
    onSubmitTagId: row.on_submit_tag_id,
    onSubmitScenarioId: row.on_submit_scenario_id,
    onSubmitMessageType: row.on_submit_message_type,
    onSubmitMessageContent: row.on_submit_message_content,
    saveToMetadata: Boolean(row.save_to_metadata),
    isActive: Boolean(row.is_active),
    submitCount: row.submit_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeSubmission(row: DbFormSubmission & { friend_name?: string | null }) {
  return {
    id: row.id,
    formId: row.form_id,
    friendId: row.friend_id,
    friendName: row.friend_name || null,
    data: JSON.parse(row.data || '{}') as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

// GET /api/forms — list all forms
forms.get('/api/forms', async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account) return c.json({ success: false, error: 'account not found' }, 404);
    const items = await getForms(c.env.DB, { accountId: account.id });
    return c.json({ success: true, data: items.map(serializeForm) });
  } catch (err) {
    console.error('GET /api/forms error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/forms/:id — get form
forms.get('/api/forms/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const form = await getFormById(c.env.DB, id);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    return c.json({ success: true, data: serializeForm(form) });
  } catch (err) {
    console.error('GET /api/forms/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/forms — create form
forms.post('/api/forms', async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account) return c.json({ success: false, error: 'account not found' }, 404);
    const body = await c.req.json<{
      name: string;
      description?: string | null;
      fields?: unknown[];
      onSubmitTagId?: string | null;
      onSubmitScenarioId?: string | null;
      onSubmitMessageType?: 'text' | 'flex' | null;
      onSubmitMessageContent?: string | null;
      saveToMetadata?: boolean;
    }>();

    if (!body.name) {
      return c.json({ success: false, error: 'name is required' }, 400);
    }

    const form = await createForm(c.env.DB, {
      name: body.name,
      description: body.description ?? null,
      fields: JSON.stringify(body.fields ?? []),
      onSubmitTagId: body.onSubmitTagId ?? null,
      onSubmitScenarioId: body.onSubmitScenarioId ?? null,
      onSubmitMessageType: body.onSubmitMessageType ?? null,
      onSubmitMessageContent: body.onSubmitMessageContent ?? null,
      saveToMetadata: body.saveToMetadata,
      accountId: account.id,
    });

    return c.json({ success: true, data: serializeForm(form) }, 201);
  } catch (err) {
    console.error('POST /api/forms error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/forms/:id — update form
forms.put('/api/forms/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      name?: string;
      description?: string | null;
      fields?: unknown[];
      onSubmitTagId?: string | null;
      onSubmitScenarioId?: string | null;
      onSubmitMessageType?: 'text' | 'flex' | null;
      onSubmitMessageContent?: string | null;
      saveToMetadata?: boolean;
      isActive?: boolean;
    }>();

    const updated = await updateForm(c.env.DB, id, {
      name: body.name,
      description: body.description,
      fields: body.fields !== undefined ? JSON.stringify(body.fields) : undefined,
      onSubmitTagId: body.onSubmitTagId,
      onSubmitScenarioId: body.onSubmitScenarioId,
      onSubmitMessageType: body.onSubmitMessageType,
      onSubmitMessageContent: body.onSubmitMessageContent,
      saveToMetadata: body.saveToMetadata,
      isActive: body.isActive,
    });

    if (!updated) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }

    return c.json({ success: true, data: serializeForm(updated) });
  } catch (err) {
    console.error('PUT /api/forms/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/forms/:id
forms.delete('/api/forms/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const form = await getFormById(c.env.DB, id);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    await deleteForm(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/forms/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/forms/:id/submissions — list submissions
forms.get('/api/forms/:id/submissions', async (c) => {
  try {
    const id = c.req.param('id');
    const form = await getFormById(c.env.DB, id);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    const submissions = await getFormSubmissions(c.env.DB, id);
    return c.json({ success: true, data: submissions.map(serializeSubmission) });
  } catch (err) {
    console.error('GET /api/forms/:id/submissions error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/forms/:id/token — issue a signed per-follower form token (auth required).
// Embed the returned token in the form link sent to that follower; the public
// submit endpoint resolves the submitter only from this token.
forms.post('/api/forms/:id/token', async (c) => {
  try {
    const formId = c.req.param('id');
    const form = await getFormById(c.env.DB, formId);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    const body = await c.req.json<{ followerId?: unknown }>().catch(() => ({} as { followerId?: unknown }));
    const followerId = typeof body.followerId === 'number' ? String(body.followerId) : body.followerId;
    if (typeof followerId !== 'string' || !/^[1-9]\d*$/.test(followerId)) {
      return c.json({ success: false, error: 'followerId is required' }, 400);
    }
    const friend = await getFriendById(c.env.DB, followerId);
    if (!friend || (form.account_id && friend.account_id !== form.account_id)) {
      return c.json({ success: false, error: 'Follower not found for this form' }, 404);
    }
    const token = await issueFormToken(c.env, formId, followerId);
    if (!token) {
      return c.json({ success: false, error: 'Form token signing key is not configured' }, 503);
    }
    return c.json({ success: true, data: { token } });
  } catch (err) {
    console.error('POST /api/forms/:id/token error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/forms/:id/submit — submit form (public)
forms.post('/api/forms/:id/submit', async (c) => {
  try {
    const formId = c.req.param('id');
    const form = await getFormById(c.env.DB, formId);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    if (!form.is_active) {
      return c.json({ success: false, error: 'This form is no longer accepting responses' }, 400);
    }

    // Body ids (friendId / lineUserId) are deliberately ignored: this endpoint
    // is public, so the submitter is identified only by a signed form token.
    const body = await c.req.json<{
      token?: string;
      data?: Record<string, unknown>;
    }>();

    const submissionData = body.data ?? {};

    // Validate required fields
    const fields = JSON.parse(form.fields || '[]') as Array<{
      name: string;
      label: string;
      type: string;
      required?: boolean;
    }>;

    for (const field of fields) {
      if (field.required) {
        const val = submissionData[field.name];
        if (val === undefined || val === null || val === '') {
          return c.json(
            { success: false, error: `${field.label} は必須項目です` },
            400,
          );
        }
      }
    }

    // Resolve the submitter only from a signed form token (issueFormToken).
    // Without one the submission is stored anonymously with no side effects.
    let friendId: string | null = null;
    if (body.token !== undefined) {
      const payload = typeof body.token === 'string'
        ? await verifyTrackingToken(c.env, body.token, 'form', formId)
        : null;
      if (!payload?.followerId) {
        return c.json({ success: false, error: 'Invalid or expired form token' }, 400);
      }
      const friend = await getFriendById(c.env.DB, payload.followerId);
      // The follower must exist and belong to the form's account (when set).
      if (!friend || (form.account_id && friend.account_id !== form.account_id)) {
        return c.json({ success: false, error: 'Invalid or expired form token' }, 400);
      }
      // followers.id is numeric in SQLite — coerce so downstream string-typed
      // helpers (createFormSubmission, addTagToFriend, ...) get a consistent shape.
      friendId = String(friend.id);
    }

    // Save submission (friendId null if not resolved — avoids FK constraint)
    const submission = await createFormSubmission(c.env.DB, {
      formId,
      friendId: friendId || null,
      data: JSON.stringify(submissionData),
    });

    // Side effects (best-effort, don't fail the request)
    if (friendId) {
      const db = c.env.DB;
      const now = jstNow();

      const sideEffects: Promise<unknown>[] = [];

      // Save response data to friend's metadata
      if (form.save_to_metadata) {
        sideEffects.push(
          (async () => {
            const friend = await getFriendById(db, friendId!);
            if (!friend) return;
            const existing = JSON.parse(friend.metadata || '{}') as Record<string, unknown>;
            const merged = { ...existing, ...submissionData };
            await db
              .prepare(`UPDATE followers SET metadata = ?, updated_at = ? WHERE id = ?`)
              .bind(JSON.stringify(merged), now, friendId)
              .run();
          })(),
        );
      }

      // Add tag
      if (form.on_submit_tag_id) {
        sideEffects.push(addTagToFriend(db, friendId, form.on_submit_tag_id));
      }

      // Enroll in scenario
      if (form.on_submit_scenario_id) {
        sideEffects.push(enrollFriendInScenario(db, friendId, form.on_submit_scenario_id));
      }

      // Send confirmation message via IG DM
      sideEffects.push(
        (async () => {
          console.log('Form reply: starting for friendId', friendId);
          const friend = await getFriendById(db, friendId!);
          if (!friend) { console.log('Form reply: friend not found'); return; }
          const igsid = friend.igsid;
          if (!igsid) { console.log('Form reply: no igsid'); return; }
          console.log('Form reply: sending to', igsid);
          // Public submits carry no ?account_id= — the form's owning account
          // (not the deploy default) must send the confirmation DM.
          const account = form.account_id
            ? await getIgAccountById(c.env.DB, form.account_id)
            : await resolveAccount(c);
          if (!account) { console.log('Form reply: no IG account configured'); return; }
          if (friend.account_id !== account.id || await messagingEligibility(db,friend.id,account.id) !== 'eligible') return;
          // Operator stop switch (U22): confirmations are sends — skip while paused.
          if (await isOutboundPaused(c.env.DB)) return;
          const igClient = await getAccountClient(c.env, c.env.DB, account);

          // Build summary text from answers
          const entries = Object.entries(submissionData as Record<string, unknown>);
          const lines = entries.map(([key, value]) => {
            const field = form.fields ? (JSON.parse(form.fields) as Array<{ name: string; label: string }>).find((f: { name: string }) => f.name === key) : null;
            const label = field?.label || key;
            const val = Array.isArray(value) ? value.join(', ') : (value !== null && value !== undefined && value !== '') ? String(value) : '-';
            return `${label}: ${val}`;
          });

          const summaryText = `Form submitted!\n\n${lines.join('\n')}`;
          await igClient.sendText(igsid, summaryText);

          // If form has a custom on_submit_message, send it
          if (form.on_submit_message_type && form.on_submit_message_content) {
            const { expandVariables } = await import('../services/step-delivery.js');
            const friendData = {
              id: friend!.id,
              display_name: friend!.name,
            };
            const expanded = expandVariables(form.on_submit_message_content, friendData);
            const msgType = form.on_submit_message_type as string;
            let parsed: Record<string,unknown>;
            try { parsed=JSON.parse(expanded); } catch { parsed={text:expanded}; }
            // Parsing failures may fall back to text; network failures must not
            // trigger a second send with a different representation.
            if (msgType==='image' && typeof parsed.url==='string') await igClient.sendImage(igsid,parsed.url);
            else await igClient.sendText(igsid,typeof parsed.text==='string'?parsed.text:expanded);
          }
        })(),
      );

      if (sideEffects.length > 0) {
        const results = await Promise.allSettled(sideEffects);
        for (const r of results) {
          if (r.status === 'rejected') console.error('Form side-effect failed:', r.reason);
        }
      }
    }

    return c.json({ success: true, data: serializeSubmission(submission) }, 201);
  } catch (err) {
    console.error('POST /api/forms/:id/submit error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { forms };
