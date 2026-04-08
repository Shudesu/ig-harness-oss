import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerManageTrackedLinks(server: McpServer): void {
  server.tool(
    "manage_tracked_links",
    "トラッキングリンクの管理操作。list: 一覧、delete: 削除。作成は create_tracked_link ツールを使用。",
    {
      action: z.enum(["list", "delete"]).describe("Action to perform"),
      linkId: z.string().optional().describe("Tracked link ID (required for delete)"),
    },
    async ({ action, linkId }) => {
      try {
        const client = getClient();
        if (action === "list") {
          const links = await client.trackedLinks.list();
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, trackedLinks: links }, null, 2) }] };
        }
        if (action === "delete") {
          if (!linkId) throw new Error("linkId is required for delete");
          await client.trackedLinks.delete(linkId);
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, deleted: linkId }, null, 2) }] };
        }
        throw new Error(`Unknown action: ${action}`);
      } catch (err) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: String(err) }) }], isError: true };
      }
    },
  );
}
