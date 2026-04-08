import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerManageCommentRules(server: McpServer): void {
  server.tool(
    "manage_comment_rules",
    "Comment rule management operations. list: all rules, get: rule details, update: modify a rule, delete: remove a rule, toggle: activate/deactivate.",
    {
      action: z
        .enum(["list", "get", "update", "delete", "toggle"])
        .describe("Action to perform"),
      ruleId: z
        .string()
        .optional()
        .describe("Comment rule ID (required for get, update, delete, toggle)"),
      name: z.string().optional().describe("Rule name (for update)"),
      postId: z.string().nullable().optional().describe("Target post ID or null for all posts (for update)"),
      triggerType: z
        .enum(["keyword", "any_comment"])
        .optional()
        .describe("Trigger type (for update)"),
      keywords: z
        .array(z.string())
        .optional()
        .describe("Keywords list (for update)"),
      ruleAction: z
        .enum(["send_dm", "add_tag", "enroll_scenario"])
        .optional()
        .describe("Action to take on trigger: send_dm, add_tag, or enroll_scenario (for update)"),
      actionValue: z.string().nullable().optional().describe("Action value (for update)"),
      replyComment: z.string().nullable().optional().describe("Public reply comment (for update)"),
      isActive: z.boolean().optional().describe("Active status (for update or toggle)"),
    },
    async ({ action, ruleId, name, postId, triggerType, keywords, ruleAction, actionValue, replyComment, isActive }) => {
      try {
        const client = getClient();

        if (action === "list") {
          const rules = await client.commentRules.list();
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, rules }, null, 2) }] };
        }

        if (!ruleId) throw new Error("ruleId is required for this action");

        if (action === "get") {
          const rule = await client.commentRules.get(ruleId);
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, rule }, null, 2) }] };
        }

        if (action === "update") {
          const input: Record<string, unknown> = {};
          if (name !== undefined) input.name = name;
          if (postId !== undefined) input.postId = postId;
          if (triggerType !== undefined) input.triggerType = triggerType;
          if (keywords !== undefined) input.keywords = keywords;
          if (ruleAction !== undefined) input.action = ruleAction;
          if (actionValue !== undefined) input.actionValue = actionValue;
          if (replyComment !== undefined) input.replyComment = replyComment;
          if (isActive !== undefined) input.isActive = isActive;
          const rule = await client.commentRules.update(ruleId, input);
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, rule }, null, 2) }] };
        }

        if (action === "delete") {
          await client.commentRules.delete(ruleId);
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, deleted: ruleId }, null, 2) }] };
        }

        if (action === "toggle") {
          if (isActive === undefined) throw new Error("isActive is required for toggle action");
          const rule = await client.commentRules.update(ruleId, { isActive });
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, rule }, null, 2) }] };
        }

        throw new Error(`Unknown action: ${action}`);
      } catch (err) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: String(err) }) }], isError: true };
      }
    },
  );
}
