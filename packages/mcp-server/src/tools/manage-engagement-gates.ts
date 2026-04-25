import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerManageEngagementGates(server: McpServer): void {
  server.tool(
    "manage_engagement_gates",
    "Engagement gate management. Actions: list (all gates), create (new gate), get (by id), update (patch), delete, list_deliveries (deliveries for a gate).",
    {
      action: z
        .enum(["list", "create", "get", "update", "delete", "list_deliveries"])
        .describe("Action to perform"),
      gate_id: z
        .string()
        .optional()
        .describe("Engagement gate ID (required for get, update, delete, list_deliveries)"),
      name: z.string().optional().describe("Gate name (required for create, optional for update)"),
      trigger_type: z
        .enum(["comment_on_post", "dm_keyword", "story_mention"])
        .optional()
        .describe("Trigger type (required for create)"),
      target_post_id: z
        .string()
        .nullable()
        .optional()
        .describe("Target Instagram post/media ID (when trigger is comment_on_post)"),
      trigger_keyword: z
        .string()
        .nullable()
        .optional()
        .describe("Keyword that activates the gate"),
      initial_dm_text: z
        .string()
        .optional()
        .describe("Initial DM text sent when gate triggers (required for create)"),
      initial_dm_button_label: z
        .string()
        .optional()
        .describe("Button label on initial CTA DM (defaults to '特典を受け取る')"),
      follow_reminder_dm_text: z
        .string()
        .optional()
        .describe("Follow reminder DM text (required for create)"),
      follow_reminder_button_label: z
        .string()
        .optional()
        .describe("Button label on follow reminder DM (defaults to 'フォローしたよ')"),
      reward_dm_text: z
        .string()
        .optional()
        .describe("Reward DM text sent after follow verified (required for create)"),
      reward_url: z
        .string()
        .nullable()
        .optional()
        .describe("Reward URL the recipient lands on. With line_connection_id set, this is auto-rewritten through a LINE Harness tracked link at delivery time so IG↔LINE userId is captured on click. Without a connection, this URL is sent as-is."),
      line_connection_id: z
        .string()
        .nullable()
        .optional()
        .describe("LINE Harness connection id (call manage_line_connections action='list' to look up registered ids). When set, reward / CTA / reminder URLs route through this LINE Harness instance and the recipient's IGSID is preserved on click — enabling automatic IG↔LINE friend-pair attribution."),
      line_pool_slug: z
        .string()
        .nullable()
        .optional()
        .describe("LINE Harness traffic-pool slug for click-side tagging. Optional — leave null if the connection's default pool is fine. Only meaningful alongside line_connection_id."),
      require_follow: z
        .number()
        .int()
        .min(0)
        .max(1)
        .optional()
        .describe("Whether follow is required before reward (1=required, 0=skip check)"),
      max_loops: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Maximum follow-reminder loops before dropping (0 = unlimited)"),
      status: z
        .enum(["active", "paused", "archived"])
        .optional()
        .describe("Gate status (for update)"),
      initial_dm_rich_message_id: z
        .string()
        .nullable()
        .optional()
        .describe("Rich message ID used as the CTA DM. When set, overrides initial_dm_text at send."),
      reward_dm_rich_message_id: z
        .string()
        .nullable()
        .optional()
        .describe("Rich message ID used as the reward DM. When set, overrides reward_dm_text at send."),
      follow_reminder_dm_rich_message_id: z
        .string()
        .nullable()
        .optional()
        .describe("Rich message ID used as the follow-reminder DM. When set, overrides follow_reminder_dm_text at send."),
    },
    async ({
      action,
      gate_id,
      name,
      trigger_type,
      target_post_id,
      trigger_keyword,
      initial_dm_text,
      initial_dm_button_label,
      follow_reminder_dm_text,
      follow_reminder_button_label,
      reward_dm_text,
      reward_url,
      require_follow,
      max_loops,
      status,
      initial_dm_rich_message_id,
      reward_dm_rich_message_id,
      follow_reminder_dm_rich_message_id,
      line_connection_id,
      line_pool_slug,
    }) => {
      try {
        const client = getClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const gates = (client as any).engagementGates;
        if (!gates) {
          throw new Error(
            "SDK client does not expose engagementGates resource. Ensure @ig-harness/sdk is built with engagement-gates support.",
          );
        }

        if (action === "list") {
          const result = await gates.list();
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ success: true, gates: result }, null, 2),
              },
            ],
          };
        }

        if (action === "create") {
          if (!name) throw new Error("name is required for create");
          if (!trigger_type) throw new Error("trigger_type is required for create");

          // Each DM slot must be covered either by legacy text or by a rich message.
          const initialOk = !!initial_dm_text || !!initial_dm_rich_message_id;
          const reminderOk = !!follow_reminder_dm_text || !!follow_reminder_dm_rich_message_id;
          const rewardOk = !!reward_dm_text || !!reward_dm_rich_message_id;
          if (!initialOk) throw new Error("initial_dm_text or initial_dm_rich_message_id required for create");
          if (!reminderOk) throw new Error("follow_reminder_dm_text or follow_reminder_dm_rich_message_id required for create");
          if (!rewardOk) throw new Error("reward_dm_text or reward_dm_rich_message_id required for create");

          const input: Record<string, unknown> = {
            name,
            trigger_type,
          };
          if (initial_dm_text !== undefined) input.initial_dm_text = initial_dm_text;
          if (follow_reminder_dm_text !== undefined) input.follow_reminder_dm_text = follow_reminder_dm_text;
          if (reward_dm_text !== undefined) input.reward_dm_text = reward_dm_text;
          if (target_post_id !== undefined) input.target_post_id = target_post_id;
          if (trigger_keyword !== undefined) input.trigger_keyword = trigger_keyword;
          if (require_follow !== undefined) input.require_follow = require_follow;
          if (initial_dm_button_label !== undefined)
            input.initial_dm_button_label = initial_dm_button_label;
          if (follow_reminder_button_label !== undefined)
            input.follow_reminder_button_label = follow_reminder_button_label;
          if (reward_url !== undefined) input.reward_url = reward_url;
          if (max_loops !== undefined) input.max_loops = max_loops;
          if (status !== undefined) input.status = status;
          if (initial_dm_rich_message_id !== undefined)
            input.initial_dm_rich_message_id = initial_dm_rich_message_id;
          if (reward_dm_rich_message_id !== undefined)
            input.reward_dm_rich_message_id = reward_dm_rich_message_id;
          if (follow_reminder_dm_rich_message_id !== undefined)
            input.follow_reminder_dm_rich_message_id = follow_reminder_dm_rich_message_id;
          if (line_connection_id !== undefined) input.line_connection_id = line_connection_id;
          if (line_pool_slug !== undefined) input.line_pool_slug = line_pool_slug;

          const gate = await gates.create(input);
          return {
            content: [
              { type: "text" as const, text: JSON.stringify({ success: true, gate }, null, 2) },
            ],
          };
        }

        if (!gate_id) throw new Error("gate_id is required for this action");

        if (action === "get") {
          const gate = await gates.get(gate_id);
          return {
            content: [
              { type: "text" as const, text: JSON.stringify({ success: true, gate }, null, 2) },
            ],
          };
        }

        if (action === "update") {
          const patch: Record<string, unknown> = {};
          if (name !== undefined) patch.name = name;
          if (trigger_type !== undefined) patch.trigger_type = trigger_type;
          if (target_post_id !== undefined) patch.target_post_id = target_post_id;
          if (trigger_keyword !== undefined) patch.trigger_keyword = trigger_keyword;
          if (initial_dm_text !== undefined) patch.initial_dm_text = initial_dm_text;
          if (initial_dm_button_label !== undefined)
            patch.initial_dm_button_label = initial_dm_button_label;
          if (follow_reminder_dm_text !== undefined)
            patch.follow_reminder_dm_text = follow_reminder_dm_text;
          if (follow_reminder_button_label !== undefined)
            patch.follow_reminder_button_label = follow_reminder_button_label;
          if (reward_dm_text !== undefined) patch.reward_dm_text = reward_dm_text;
          if (reward_url !== undefined) patch.reward_url = reward_url;
          if (require_follow !== undefined) patch.require_follow = require_follow;
          if (max_loops !== undefined) patch.max_loops = max_loops;
          if (status !== undefined) patch.status = status;
          if (initial_dm_rich_message_id !== undefined)
            patch.initial_dm_rich_message_id = initial_dm_rich_message_id;
          if (reward_dm_rich_message_id !== undefined)
            patch.reward_dm_rich_message_id = reward_dm_rich_message_id;
          if (follow_reminder_dm_rich_message_id !== undefined)
            patch.follow_reminder_dm_rich_message_id = follow_reminder_dm_rich_message_id;
          if (line_connection_id !== undefined) patch.line_connection_id = line_connection_id;
          if (line_pool_slug !== undefined) patch.line_pool_slug = line_pool_slug;

          const gate = await gates.update(gate_id, patch);
          return {
            content: [
              { type: "text" as const, text: JSON.stringify({ success: true, gate }, null, 2) },
            ],
          };
        }

        if (action === "delete") {
          await gates.delete(gate_id);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ success: true, deleted: gate_id }, null, 2),
              },
            ],
          };
        }

        if (action === "list_deliveries") {
          const deliveries = await gates.listDeliveries(gate_id);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ success: true, deliveries }, null, 2),
              },
            ],
          };
        }

        throw new Error(`Unknown action: ${action}`);
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ success: false, error: String(err) }) },
          ],
          isError: true,
        };
      }
    },
  );
}
