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
      gateId: z
        .string()
        .optional()
        .describe("Engagement gate ID (required for get, update, delete, list_deliveries)"),
      name: z.string().optional().describe("Gate name (required for create, optional for update)"),
      triggerType: z
        .enum(["comment_on_post", "dm_keyword", "story_reply", "mention"])
        .optional()
        .describe("Trigger type (required for create)"),
      targetPostId: z
        .string()
        .nullable()
        .optional()
        .describe("Target Instagram post/media ID (when trigger is comment_on_post)"),
      triggerKeyword: z
        .string()
        .nullable()
        .optional()
        .describe("Keyword that activates the gate"),
      initialDmText: z
        .string()
        .optional()
        .describe("Initial DM text sent when gate triggers (required for create)"),
      followReminderDmText: z
        .string()
        .optional()
        .describe("Follow reminder DM text (required for create)"),
      rewardDmText: z
        .string()
        .optional()
        .describe("Reward DM text sent after follow verified (required for create)"),
      requireFollow: z
        .boolean()
        .optional()
        .describe("Whether follow is required before reward"),
      initialButtonLabel: z
        .string()
        .nullable()
        .optional()
        .describe("Button label on initial DM"),
      followReminderButtonLabel: z
        .string()
        .nullable()
        .optional()
        .describe("Button label on follow reminder DM"),
      rewardButtonLabel: z
        .string()
        .nullable()
        .optional()
        .describe("Button label on reward DM"),
      rewardUrl: z
        .string()
        .nullable()
        .optional()
        .describe("Reward URL (link attached to reward DM)"),
      maxLoops: z
        .number()
        .int()
        .optional()
        .describe("Maximum follow-reminder loops before giving up"),
      status: z
        .enum(["active", "paused", "archived"])
        .optional()
        .describe("Gate status (for update)"),
    },
    async ({
      action,
      gateId,
      name,
      triggerType,
      targetPostId,
      triggerKeyword,
      initialDmText,
      followReminderDmText,
      rewardDmText,
      requireFollow,
      initialButtonLabel,
      followReminderButtonLabel,
      rewardButtonLabel,
      rewardUrl,
      maxLoops,
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
          if (!triggerType) throw new Error("triggerType is required for create");
          if (!initialDmText) throw new Error("initialDmText is required for create");
          if (!followReminderDmText)
            throw new Error("followReminderDmText is required for create");
          if (!rewardDmText) throw new Error("rewardDmText is required for create");

          const input: Record<string, unknown> = {
            name,
            triggerType,
            initialDmText,
            followReminderDmText,
            rewardDmText,
          };
          if (targetPostId !== undefined) input.targetPostId = targetPostId;
          if (triggerKeyword !== undefined) input.triggerKeyword = triggerKeyword;
          if (requireFollow !== undefined) input.requireFollow = requireFollow;
          if (initialButtonLabel !== undefined) input.initialButtonLabel = initialButtonLabel;
          if (followReminderButtonLabel !== undefined)
            input.followReminderButtonLabel = followReminderButtonLabel;
          if (rewardButtonLabel !== undefined) input.rewardButtonLabel = rewardButtonLabel;
          if (rewardUrl !== undefined) input.rewardUrl = rewardUrl;
          if (maxLoops !== undefined) input.maxLoops = maxLoops;
          if (status !== undefined) input.status = status;

          const gate = await gates.create(input);
          return {
            content: [
              { type: "text" as const, text: JSON.stringify({ success: true, gate }, null, 2) },
            ],
          };
        }

        if (!gateId) throw new Error("gateId is required for this action");

        if (action === "get") {
          const gate = await gates.get(gateId);
          return {
            content: [
              { type: "text" as const, text: JSON.stringify({ success: true, gate }, null, 2) },
            ],
          };
        }

        if (action === "update") {
          const patch: Record<string, unknown> = {};
          if (name !== undefined) patch.name = name;
          if (triggerType !== undefined) patch.triggerType = triggerType;
          if (targetPostId !== undefined) patch.targetPostId = targetPostId;
          if (triggerKeyword !== undefined) patch.triggerKeyword = triggerKeyword;
          if (initialDmText !== undefined) patch.initialDmText = initialDmText;
          if (followReminderDmText !== undefined)
            patch.followReminderDmText = followReminderDmText;
          if (rewardDmText !== undefined) patch.rewardDmText = rewardDmText;
          if (requireFollow !== undefined) patch.requireFollow = requireFollow;
          if (initialButtonLabel !== undefined) patch.initialButtonLabel = initialButtonLabel;
          if (followReminderButtonLabel !== undefined)
            patch.followReminderButtonLabel = followReminderButtonLabel;
          if (rewardButtonLabel !== undefined) patch.rewardButtonLabel = rewardButtonLabel;
          if (rewardUrl !== undefined) patch.rewardUrl = rewardUrl;
          if (maxLoops !== undefined) patch.maxLoops = maxLoops;
          if (status !== undefined) patch.status = status;

          const gate = await gates.update(gateId, patch);
          return {
            content: [
              { type: "text" as const, text: JSON.stringify({ success: true, gate }, null, 2) },
            ],
          };
        }

        if (action === "delete") {
          await gates.delete(gateId);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ success: true, deleted: gateId }, null, 2),
              },
            ],
          };
        }

        if (action === "list_deliveries") {
          const deliveries = await gates.listDeliveries(gateId);
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
