import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerCreateCommentRule(server: McpServer): void {
  server.tool(
    "create_comment_rule",
    "Create a comment rule that auto-sends a DM when someone comments on an Instagram post. Set postId to target a specific post, or leave null for all posts. Supports keyword matching or any comment trigger.",
    {
      name: z.string().describe("Name for this comment rule (internal label)"),
      postId: z
        .string()
        .optional()
        .describe("Target a specific Instagram post ID, or omit to apply to all posts"),
      triggerType: z
        .enum(["keyword", "any_comment"])
        .default("any_comment")
        .describe("'keyword' to match specific words, 'any_comment' to trigger on any comment"),
      keywords: z
        .array(z.string())
        .optional()
        .describe("Keywords to match (required when triggerType is 'keyword')"),
      action: z
        .enum(["send_dm", "add_tag", "enroll_scenario"])
        .describe("Action to take when rule triggers: send_dm, add_tag, or enroll_scenario"),
      actionValue: z
        .string()
        .optional()
        .describe("Value for the action: DM text (send_dm), tag ID (add_tag), or scenario ID (enroll_scenario)"),
      replyComment: z
        .string()
        .optional()
        .describe("Optional public comment reply to post under the triggering comment"),
      isActive: z
        .boolean()
        .default(true)
        .describe("Whether the rule is active immediately"),
    },
    async ({ name, postId, triggerType, keywords, action, actionValue, replyComment, isActive }) => {
      try {
        const client = getClient();
        const rule = await client.commentRules.create({
          name,
          postId: postId ?? null,
          triggerType,
          keywords: keywords ?? [],
          action,
          actionValue: actionValue ?? null,
          replyComment: replyComment ?? null,
          isActive,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, rule }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: false, error: String(error) },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
