import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerGetFollowerDetail(server: McpServer): void {
  server.tool(
    "get_follower_detail",
    "Get detailed information about a specific Instagram follower including tags, metadata, and profile.",
    {
      followerId: z.string().describe("The follower's ID"),
    },
    async ({ followerId }) => {
      try {
        const client = getClient();
        const follower = await client.followers.get(followerId);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, follower }, null, 2),
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
