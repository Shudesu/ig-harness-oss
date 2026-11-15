import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

const text = (value: unknown, isError = false) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) });
const fail = (err: unknown) => text({ success: false, error: err instanceof Error ? err.message : String(err) }, true);

/**
 * B-19: ice breakers / persistent menu via the messenger_profile edge.
 * GET requests need no approval; SET and DELETE write to the Meta profile and
 * are therefore approval-gated.
 */
export function registerMessengerProfileTools(server: McpServer): void {
  server.tool(
    "get_messenger_profile",
    "Read the account's ice breakers / persistent menu (messenger_profile) for the active account. fields: comma-separated list, e.g. 'ice_breakers,persistent_menu'.",
    { fields: z.string().min(1).max(200).default("ice_breakers,persistent_menu") },
    async ({ fields }) => {
      try {
        return text({ success: true, data: await getClient(undefined).messengerProfile.get(fields) });
      } catch (err) { return fail(err); }
    },
  );

  server.tool(
    "set_messenger_profile",
    "Set ice breakers or a persistent menu for the active account (writes to the Meta messenger_profile edge; owner only). Pass a payload object like { ice_breakers: [{ question, text }] } or { persistent_menu: [...] }. Requires explicit human approval: call with confirm=false for a preview first.",
    {
      payload: z.record(z.string(), z.unknown()).describe("messenger_profile payload (ice_breakers / persistent_menu / greeting)"),
      confirm: z.boolean().default(false).describe("Must be true, and only after the user explicitly approved"),
    },
    async ({ payload, confirm }) => {
      if (!confirm) {
        return text({ success: false, requiresApproval: true, preview: { action: "set_messenger_profile", payload }, message: "Meta のプロフィール設定を書き換えます。ユーザーの承認を得てから confirm=true で再実行してください。" });
      }
      try {
        return text({ success: true, data: await getClient(undefined).messengerProfile.set(payload) });
      } catch (err) { return fail(err); }
    },
  );

  server.tool(
    "delete_messenger_profile",
    "Delete ice breakers / persistent menu fields from the account's messenger_profile (owner only). Requires explicit human approval.",
    {
      fields: z.string().min(1).max(200).describe("Comma-separated field names to delete, e.g. 'ice_breakers,persistent_menu'"),
      confirm: z.boolean().default(false),
    },
    async ({ fields, confirm }) => {
      if (!confirm) {
        return text({ success: false, requiresApproval: true, preview: { action: "delete_messenger_profile", fields }, message: "ユーザーの承認を得てから confirm=true で再実行してください。" });
      }
      try {
        return text({ success: true, data: await getClient(undefined).messengerProfile.delete(fields) });
      } catch (err) { return fail(err); }
    },
  );
}

/**
 * B-18: comment auto-hide rules (NG words / spam) with an undo path.
 */
export function registerCommentModerationTools(server: McpServer): void {
  server.tool(
    "get_comment_moderation",
    "Read the comment auto-hide settings (NG words, optional media filter) and the log of hidden comments for the active account.",
    {},
    async () => {
      try {
        return text({ success: true, data: await getClient(undefined).commentModeration.get() });
      } catch (err) { return fail(err); }
    },
  );

  server.tool(
    "set_comment_moderation",
    "Configure comment auto-hide (owner only): { enabled, words: string[], mediaIds: string[] | null }. Matching comments are hidden (reversible). Requires explicit human approval: call with confirm=false for a preview first.",
    {
      enabled: z.boolean(),
      words: z.array(z.string().max(120)).max(200).describe("NG words / spam markers matched case-insensitively"),
      mediaIds: z.array(z.string()).max(100).nullable().optional().describe("Restrict to specific posts, or null for all posts"),
      confirm: z.boolean().default(false),
    },
    async ({ enabled, words, mediaIds, confirm }) => {
      if (!confirm) {
        return text({ success: false, requiresApproval: true, preview: { action: "set_comment_moderation", enabled, words, mediaIds: mediaIds ?? null }, message: "ユーザーの承認を得てから confirm=true で再実行してください。" });
      }
      try {
        return text({ success: true, data: await getClient(undefined).commentModeration.set({ enabled, words, mediaIds: mediaIds ?? null }) });
      } catch (err) { return fail(err); }
    },
  );

  server.tool(
    "unhide_comment",
    "Undo a comment auto-hide (owner only). Requires explicit human approval.",
    {
      commentId: z.string().min(1),
      confirm: z.boolean().default(false),
    },
    async ({ commentId, confirm }) => {
      if (!confirm) {
        return text({ success: false, requiresApproval: true, preview: { action: "unhide_comment", commentId }, message: "ユーザーの承認を得てから confirm=true で再実行してください。" });
      }
      try {
        return text({ success: true, data: await getClient(undefined).commentModeration.unhide(commentId) });
      } catch (err) { return fail(err); }
    },
  );
}
