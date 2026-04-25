import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerListRecentReels(server: McpServer): void {
  server.tool(
    "list_recent_reels",
    "List the authenticated Instagram account's own reels (media_product_type=REELS). Returns id, caption, permalink, thumbnail_url, timestamp. Typically used to pick reel IDs for bulk_apply_gates_to_reels.",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max reels to return (default 50, capped at 100)"),
    },
    async ({ limit }) => {
      try {
        const client = getClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const posts = (client as any).posts;
        if (!posts) throw new Error("SDK client does not expose posts resource. Rebuild @ig-harness/sdk.");
        const reels = await posts.listMyReels(limit ?? 50);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, count: reels.length, reels }, null, 2),
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
