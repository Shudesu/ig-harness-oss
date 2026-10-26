import { vi } from 'vitest';
import { testDatabase } from './d1.js';
export async function gateFixture() {
    const state = await testDatabase();
    state.sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,is_default,created_at,updated_at) VALUES('a','111','test',1,'2026-01-01','2026-01-01'); INSERT INTO followers(id,igsid,username,account_id) VALUES(1,'user-1','person','a')");
    const addGate = (id = 'g', extra: Record<string, unknown> = {}) => {
        state.sqlite.prepare("INSERT INTO engagement_gates(id,name,trigger_type,initial_dm_text,follow_reminder_dm_text,reward_dm_text,reward_url,account_id,require_follow) VALUES(?,?,'comment_on_post','Welcome','Please follow','Reward','https://example.com/reward','a',0)").run(id, id);
        for (const [key, value] of Object.entries(extra))
            state.sqlite.prepare(`UPDATE engagement_gates SET ${key}=? WHERE id=?`).run(value as any, id);
    };
    const client = {
        sendPrivateReply: vi.fn(async (..._args: unknown[]) => ({ message_id: 'private-1' })),
        getCommentTimestamp: vi.fn(async () => new Date(Date.now() - 1000).toISOString()),
        sendText: vi.fn(async (..._args: unknown[]) => ({ message_id: 'text-1' })),
        sendImage: vi.fn(async (..._args: unknown[]) => ({ message_id: 'image-1' })),
        sendGenericTemplate: vi.fn(async (..._args: unknown[]) => ({ message_id: 'template-1' })),
        sendQuickReply: vi.fn(async (..._args: unknown[]) => ({ message_id: 'quick-1' })),
        sendRichMessage: vi.fn(async (..._args: unknown[]) => ({ sentBlocks: 1 })),
        getUserProfile: vi.fn(async (..._args: unknown[]) => ({ username: 'person', name: 'Person', is_user_follow_business: true })),
        replyToComment: vi.fn(async () => ({ id: 'nested' })),
        postCommentToMedia: vi.fn(async (..._args: unknown[]) => ({ id: 'public' })),
    };
    const args = { postId: 'post-1', commentText: 'guide', follower: { id: 1, igsid: 'user-1' }, accountId: 'a', commentId: 'comment-1', commentCreatedAt: new Date(Date.now() - 1000).toISOString(), commenterUsername: 'person' };
    return { ...state, addGate, client, args };
}
