import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerBulkApplyGatesToReels(server: McpServer): void {
  server.tool(
    "bulk_apply_gates_to_reels",
    "Create one engagement gate per reel ID in a single call, all referencing the same rich-message templates. Skips reels that already have a non-archived gate. Pass trigger_keyword=null for any-comment mode (most common for reels). Use list_recent_reels first to get reel IDs.",
    {
      reel_ids: z
        .array(z.string())
        .min(1)
        .max(100)
        .describe("Array of Instagram media IDs (reels). Max 100 per call."),
      name_prefix: z
        .string()
        .describe("Prefix for generated gate names. E.g. 'auto-2026-04' → 'auto-2026-04-<reelId-suffix>'."),
      initial_dm_rich_message_id: z
        .string()
        .describe("Rich message ID for the CTA DM sent when a comment fires the gate."),
      reward_dm_rich_message_id: z
        .string()
        .describe("Rich message ID for the reward DM sent after follow verification."),
      follow_reminder_dm_rich_message_id: z
        .string()
        .optional()
        .describe("Rich message ID for the follow-reminder DM (recommended when require_follow=true)."),
      trigger_keyword: z
        .string()
        .nullable()
        .optional()
        .describe("null = any-comment mode (fires on every comment). Set a string to require keyword match."),
      require_follow: z
        .boolean()
        .optional()
        .describe("true (default) = verify follow before reward. false = reward everyone."),
      reward_url: z
        .string()
        .optional()
        .describe("Optional URL to expose to reward/CTA blocks via the {REWARD_URL} placeholder."),
      max_loops: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Max follow-reminder loops before dropping (0 = unlimited, default 3)."),
    },
    async ({
      reel_ids,
      name_prefix,
      initial_dm_rich_message_id,
      reward_dm_rich_message_id,
      follow_reminder_dm_rich_message_id,
      trigger_keyword,
      require_follow,
      reward_url,
      max_loops,
    }) => {
      try {
        const client = getClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const posts = (client as any).posts;
        if (!posts) throw new Error("SDK client does not expose posts resource. Rebuild @ig-harness/sdk.");

        const result = await posts.bulkApplyGates({
          reel_ids,
          name_prefix,
          initial_dm_rich_message_id,
          reward_dm_rich_message_id,
          follow_reminder_dm_rich_message_id,
          trigger_keyword: trigger_keyword ?? null,
          require_follow: require_follow ?? true,
          reward_url,
          max_loops: max_loops ?? 3,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, ...result }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: String(err) }) }],
          isError: true,
        };
      }
    },
  );
}
