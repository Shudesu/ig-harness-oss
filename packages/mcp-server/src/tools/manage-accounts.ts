import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient, getActiveAccountId, setActiveAccountId } from "../client.js";

const text = (value: unknown, isError = false) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) });
const fail = (err: unknown) => text({ success: false, error: err instanceof Error ? err.message : String(err) }, true);
/** Never echo a credential back to the model/transcript. */
const mask = (value: string) => (value.length <= 4 ? "****" : `****${value.slice(-4)}`);

/** Read-only: listed even when IG_HARNESS_READ_ONLY=true. */
export function registerListAccounts(server: McpServer): void {
  server.tool(
    "list_accounts",
    "List connected Instagram accounts (tokens masked) with webhook-subscription / permission check results, and which account this MCP session is operating on. Requires owner or admin.",
    {},
    async () => {
      try {
        const accounts = await getClient(undefined).accounts.list();
        const active = getActiveAccountId() ?? accounts.find((a) => a.isDefault)?.id ?? null;
        return text({ success: true, activeAccountId: active, accounts: accounts.map((a) => ({ ...a, isSelected: a.id === active })) });
      } catch (err) { return fail(err); }
    },
  );
}

export function registerAccountTools(server: McpServer): void {
  server.tool(
    "add_account",
    "Add an Instagram professional account (owner only). Requires explicit human approval: call first with confirm=false to get a preview, show it to the user, and only after the user approves call again with confirm=true. Subscribes the account to webhooks (subscribed_apps) and checks comments/messages permissions by default. The token is never returned.",
    {
      accessToken: z.string().min(1).max(8192).describe("Instagram Login long-lived access token for the account"),
      igUserId: z.string().regex(/^\d{1,64}$/).optional().describe("Expected Instagram user id (optional; verified against the token)"),
      appSecret: z.string().max(512).optional().describe("Instagram app secret, only when the account belongs to a different Meta app"),
      verifyToken: z.string().max(512).optional().describe("Webhook verify token, only for a different Meta app"),
      subscribeWebhooks: z.boolean().default(true).describe("Subscribe the account to webhook fields right after adding (default true)"),
      confirm: z.boolean().default(false).describe("Must be true, and only after the user explicitly approved this addition"),
    },
    async ({ accessToken, igUserId, appSecret, verifyToken, subscribeWebhooks, confirm }) => {
      if (!confirm) {
        return text({ success: false, requiresApproval: true, preview: { action: "add_account", accessToken: mask(accessToken), igUserId: igUserId ?? "(token owner)", differentMetaApp: Boolean(appSecret), subscribeWebhooks }, message: "ユーザーの承認を得てから confirm=true で再実行してください。" });
      }
      try {
        const account = await getClient(undefined).accounts.add({ accessToken, igUserId, appSecret: appSecret ?? null, verifyToken: verifyToken ?? null, subscribeWebhooks });
        return text({ success: true, account });
      } catch (err) { return fail(err); }
    },
  );

  server.tool(
    "switch_account",
    "Switch which Instagram account the following tool calls in this MCP session operate on. Pass accountId=null to return to the default (IG_HARNESS_ACCOUNT_ID or the default account).",
    { accountId: z.string().min(1).nullable().describe("Target account id from list_accounts, or null for the default") },
    async ({ accountId }) => {
      try {
        if (accountId === null) { setActiveAccountId(undefined); return text({ success: true, activeAccountId: getActiveAccountId() ?? null }); }
        const target = (await getClient(undefined).accounts.list()).find((a) => a.id === accountId);
        if (!target) throw new Error(`account not found: ${accountId}`);
        if (!target.isActive) throw new Error(`account is deactivated: ${accountId}`);
        setActiveAccountId(target.id);
        return text({ success: true, activeAccountId: target.id, username: target.username });
      } catch (err) { return fail(err); }
    },
  );

  server.tool(
    "remove_account",
    "Disconnect (deactivate) an Instagram account (owner only). Stops webhook processing and deliveries for it; data is kept and it can be reactivated from the admin panel. The default account cannot be removed. Requires explicit human approval: call with confirm=false for a preview first.",
    {
      accountId: z.string().min(1).describe("Account id from list_accounts"),
      confirm: z.boolean().default(false).describe("Must be true, and only after the user explicitly approved"),
    },
    async ({ accountId, confirm }) => {
      try {
        const target = (await getClient(undefined).accounts.list()).find((a) => a.id === accountId);
        if (!target) throw new Error(`account not found: ${accountId}`);
        if (target.isDefault) throw new Error("the default account cannot be removed");
        if (!confirm) return text({ success: false, requiresApproval: true, preview: { action: "remove_account", accountId, username: target.username }, message: "ユーザーの承認を得てから confirm=true で再実行してください。" });
        const account = await getClient(undefined).accounts.deactivate(accountId);
        if (getActiveAccountId() === accountId) setActiveAccountId(undefined);
        return text({ success: true, account });
      } catch (err) { return fail(err); }
    },
  );

  server.tool(
    "check_account_connection",
    "Re-run the webhook subscription / permission (comments, messages) check for an account (owner only). resubscribe=true also calls subscribed_apps again and requires confirm=true after user approval.",
    {
      accountId: z.string().min(1).describe("Account id from list_accounts"),
      resubscribe: z.boolean().default(false),
      confirm: z.boolean().default(false),
    },
    async ({ accountId, resubscribe, confirm }) => {
      if (resubscribe && !confirm) return text({ success: false, requiresApproval: true, preview: { action: "resubscribe_webhooks", accountId }, message: "ユーザーの承認を得てから confirm=true で再実行してください。" });
      try {
        return text({ success: true, connection: await getClient(undefined).accounts.checkConnection(accountId, { subscribe: resubscribe }) });
      } catch (err) { return fail(err); }
    },
  );
}
