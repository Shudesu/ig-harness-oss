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
        .describe("Reward URL appended to reward DM (use a LINE Harness tracked link with ?ig=<IGSID> for cross-platform linking)"),
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
          if (!initial_dm_text) throw new Error("initial_dm_text is required for create");
          if (!follow_reminder_dm_text)
            throw new Error("follow_reminder_dm_text is required for create");
          if (!reward_dm_text) throw new Error("reward_dm_text is required for create");

          const input: Record<string, unknown> = {
            name,
            trigger_type,
            initial_dm_text,
            follow_reminder_dm_text,
            reward_dm_text,
          };
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
