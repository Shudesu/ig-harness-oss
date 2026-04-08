import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerListFollowers(server: McpServer): void {
  server.tool(
    "list_followers",
    "List Instagram followers with optional filtering by tag or name search. Returns paginated results with follower details.",
    {
      search: z.string().optional().describe("Search followers by username or name (partial match)"),
      tagId: z.string().optional().describe("Filter by tag ID"),
      limit: z
        .number()
        .default(20)
        .describe("Number of followers to return (max 100)"),
      offset: z.number().default(0).describe("Offset for pagination"),
    },
    async ({ search, tagId, limit, offset }) => {
      try {
        const client = getClient();
        const result = await client.followers.list({
          search,
          tagId: tagId ? Number(tagId) : undefined,
          page: Math.floor(offset / limit) + 1,
          pageSize: limit,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  total: result.total,
                  hasNextPage: result.hasNextPage,
                  followers: result.items,
                },
                null,
                2,
              ),
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
