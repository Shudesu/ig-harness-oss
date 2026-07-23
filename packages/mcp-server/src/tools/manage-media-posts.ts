import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerManageMediaPosts(server: McpServer): void {
  server.tool(
    "manage_media_posts",
    "List, inspect, cancel, or force-publish media posts (feed/carousel/reel/story), " +
      "and check the 24h publishing quota. " +
      "action=publish_now publishes publicly right away — confirm with the user first.",
    {
      action: z.enum(["list", "get", "cancel", "publish_now", "publishing_limit"]),
      id: z.string().optional().describe("Post id (required for get / cancel / publish_now)"),
      status: z
        .enum(["scheduled", "processing", "published", "failed", "canceled"])
        .optional()
        .describe("Filter for action=list"),
      limit: z.number().int().min(1).max(200).optional().describe("Max rows for action=list"),
    },
    async ({ action, id, status, limit }) => {
      try {
        const client = getClient();
        let result: unknown;
        switch (action) {
          case "list":
            result = await client.mediaPosts.list({ status, limit });
            break;
          case "get":
            if (!id) throw new Error("id is required for action=get");
            result = await client.mediaPosts.get(id);
            break;
          case "cancel":
            if (!id) throw new Error("id is required for action=cancel");
            await client.mediaPosts.cancel(id);
            result = { canceled: id };
            break;
          case "publish_now":
            if (!id) throw new Error("id is required for action=publish_now");
            result = await client.mediaPosts.publishNow(id);
            break;
          case "publishing_limit":
            result = await client.mediaPosts.publishingLimit();
            break;
        }
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ success: true, data: result }, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ success: false, error: String(err) }) },
          ],
        };
      }
    },
  );
}
