import { describe, expect, it, vi, beforeEach } from 'vitest';
import { testDatabase } from '../../test-utils/d1.js';
import {
    DM_PRESENCE_ENABLED_KEY,
    OUTBOUND_PAUSED_KEY,
    OutboundPausedError,
    assertOutboundAllowed,
    decorateWithPresence,
    guardrailSnapshot,
    isDmPresenceEnabled,
    isOutboundPaused,
    isWithinDeliveryWindow,
    sendWithPresence,
    setDmPresenceEnabled,
    setOutboundPaused,
    typingDelayMs,
} from '../human-touch.js';

let state: Awaited<ReturnType<typeof testDatabase>>;
beforeEach(async () => {
    state = await testDatabase();
});

const fakeClient = () => ({
    sendText: vi.fn(async (..._args: unknown[]) => ({ message_id: 'm1' })),
    sendSenderAction: vi.fn(async (..._args: unknown[]) => undefined),
});

describe('presence setting (U18, default OFF)', () => {
    it('defaults to OFF', async () => {
        expect(await isDmPresenceEnabled(state.db)).toBe(false);
    });

    it('persists the ON/OFF toggle', async () => {
        await setDmPresenceEnabled(state.db, true);
        expect(await isDmPresenceEnabled(state.db)).toBe(true);
        await setDmPresenceEnabled(state.db, false);
        expect(await isDmPresenceEnabled(state.db)).toBe(false);
    });

    it('sends without sender actions when OFF', async () => {
        const client = fakeClient();
        await sendWithPresence(state.db, client as never, 'igsid-1', () => client.sendText('igsid-1', 'hi'));
        expect(client.sendSenderAction).not.toHaveBeenCalled();
        expect(client.sendText).toHaveBeenCalledTimes(1);
    });

    it('marks seen, shows typing, sends, then stops typing when ON', async () => {
        await setDmPresenceEnabled(state.db, true);
        const client = fakeClient();
        const result = await sendWithPresence(state.db, client as never, 'igsid-1', () => client.sendText('igsid-1', 'hi'), 'hi');
        expect(result).toEqual({ message_id: 'm1' });
        const actions = client.sendSenderAction.mock.calls.map((call) => call[1]);
        expect(actions).toEqual(['mark_seen', 'typing_on', 'typing_off']);
        expect(client.sendText).toHaveBeenCalledTimes(1);
        // typing_off runs after the send
        expect(client.sendSenderAction.mock.invocationCallOrder[2]).toBeGreaterThan(client.sendText.mock.invocationCallOrder[0]!);
    });

    it('stops typing even when the send fails', async () => {
        await setDmPresenceEnabled(state.db, true);
        const client = fakeClient();
        client.sendText.mockRejectedValueOnce(new Error('api down'));
        await expect(sendWithPresence(state.db, client as never, 'igsid-1', () => client.sendText('igsid-1', 'hi'))).rejects.toThrow('api down');
        expect(client.sendSenderAction.mock.calls.map((call) => call[1])).toEqual(['mark_seen', 'typing_on', 'typing_off']);
    });

    it('typing delay grows with text length and stays bounded', () => {
        expect(typingDelayMs('')).toBe(600);
        expect(typingDelayMs('あ')).toBe(600);
        expect(typingDelayMs('x'.repeat(40))).toBe(400 + 60 * 40);
        expect(typingDelayMs('x'.repeat(60))).toBe(3000);
        expect(typingDelayMs('x'.repeat(500))).toBe(3000);
        expect(typingDelayMs(null)).toBe(600);
    });

    it('decorates every send path with presence when enabled', async () => {
        await setDmPresenceEnabled(state.db, true);
        // Keep the raw mocks separate: decorateWithPresence replaces the
        // properties on the object it decorates.
        const mocks = {
            sendText: vi.fn(async () => ({})),
            sendImage: vi.fn(async () => ({})),
            sendGenericTemplate: vi.fn(async () => ({})),
            sendQuickReply: vi.fn(async () => ({})),
            sendRichMessage: vi.fn(async () => ({ sentBlocks: 1 })),
            sendPrivateReply: vi.fn(async () => ({})),
            sendSenderAction: vi.fn(async () => undefined),
        };
        const decorated = decorateWithPresence(state.db, { ...mocks } as never);
        await decorated.sendText('igsid-1', 'hi');
        await decorated.sendImage('igsid-1', 'https://example.com/a.png');
        await decorated.sendGenericTemplate('igsid-1', []);
        await decorated.sendQuickReply('igsid-1', 'choose', []);
        await decorated.sendRichMessage('igsid-1', []);
        // private replies go to a comment_id — no sender actions possible
        await decorated.sendPrivateReply('comment-1', 'hi');
        expect(mocks.sendSenderAction).toHaveBeenCalledTimes(5 * 3); // mark_seen/typing_on/typing_off per send
        expect(mocks.sendText).toHaveBeenCalledWith('igsid-1', 'hi');
        expect(mocks.sendPrivateReply).toHaveBeenCalledWith('comment-1', 'hi');
    });

    it('does not decorate when disabled', async () => {
        const mocks = {
            sendText: vi.fn(async () => ({})),
            sendSenderAction: vi.fn(async () => undefined),
        };
        const decorated = decorateWithPresence(state.db, { ...mocks } as never);
        await decorated.sendText('igsid-1', 'hi');
        expect(mocks.sendSenderAction).not.toHaveBeenCalled();
        expect(mocks.sendText).toHaveBeenCalledTimes(1);
    });
});

describe('outbound stop switch (U22)', () => {
    it('defaults to running', async () => {
        expect(await isOutboundPaused(state.db)).toBe(false);
        await expect(assertOutboundAllowed(state.db)).resolves.toBeUndefined();
    });

    it('persists the pause toggle and asserts', async () => {
        await setOutboundPaused(state.db, true);
        expect((state.sqlite.prepare(`SELECT value FROM integration_settings WHERE key='${OUTBOUND_PAUSED_KEY}'`).get() as { value: string }).value).toBe('1');
        await expect(assertOutboundAllowed(state.db)).rejects.toBeInstanceOf(OutboundPausedError);
        await setOutboundPaused(state.db, false);
        await expect(assertOutboundAllowed(state.db)).resolves.toBeUndefined();
    });
});

describe('delivery window', () => {
    it('is inside 9-23 JST and outside otherwise', () => {
        // 12:00 JST
        expect(isWithinDeliveryWindow(Date.UTC(2026, 10, 15, 3, 0, 0))).toBe(true);
        // 08:00 JST
        expect(isWithinDeliveryWindow(Date.UTC(2026, 10, 14, 23, 0, 0))).toBe(false);
        // 23:30 JST
        expect(isWithinDeliveryWindow(Date.UTC(2026, 10, 15, 14, 30, 0))).toBe(false);
    });
});

describe('guardrail snapshot (U22 visibility)', () => {
    it('reports window, counts and switch states without credentials', async () => {
        state.sqlite.exec("INSERT INTO followers(id,igsid,account_id) VALUES(1,'u1','a')");
        state.sqlite.exec(`INSERT INTO messages_log(follower_id,direction,message_type,body) VALUES(1,'out','text','{}')`);
        const snap = await guardrailSnapshot(state.db, 'a');
        expect(snap.paused).toBe(false);
        expect(snap.presenceEnabled).toBe(false);
        expect(snap.window.startHourJst).toBe(9);
        expect(snap.window.endHourJst).toBe(23);
        expect(typeof snap.window.within).toBe('boolean');
        expect(snap.followers.eligible).toBeGreaterThanOrEqual(0);
        expect(snap.volume).toMatchObject({ dmOut24h: expect.any(Number), pendingBroadcastRecipients: expect.any(Number), pendingCommentJobs: expect.any(Number), activeScenarios: expect.any(Number) });
        expect(JSON.stringify(snap)).not.toMatch(/access_token|api_key/i);
    });

    it('reflects the toggles', async () => {
        await setOutboundPaused(state.db, true);
        await setDmPresenceEnabled(state.db, true);
        const snap = await guardrailSnapshot(state.db, null);
        expect(snap.paused).toBe(true);
        expect(snap.presenceEnabled).toBe(true);
        expect((state.sqlite.prepare(`SELECT value FROM integration_settings WHERE key='${DM_PRESENCE_ENABLED_KEY}'`).get() as { value: string }).value).toBe('1');
    });
});
