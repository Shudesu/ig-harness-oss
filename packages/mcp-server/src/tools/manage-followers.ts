import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerManageFollowers(server: McpServer): void {
  server.tool(
    "manage_followers",
    "Follower management operations. count: get follower count, set_metadata: update metadata fields.",
    {
      action: z
        .enum(["count", "set_metadata"])
        .describe("Action to perform"),
      followerId: z
        .string()
        .optional()
        .describe("Follower ID (required for set_metadata)"),
      metadata: z
        .string()
        .optional()
        .describe("JSON string of metadata fields to set (for 'set_metadata')"),
    },
    async ({ action, followerId, metadata }) => {
      try {
        const client = getClient();

        if (action === "count") {
          const count = await client.followers.count();
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: true, count }, null, 2) }],
          };
        }

        if (!followerId) throw new Error("followerId is required for this action");

        if (action === "set_metadata") {
          if (!metadata) throw new Error("metadata (JSON string) is required for set_metadata");
          const fields = JSON.parse(metadata) as Record<string, unknown>;
          const follower = await client.followers.setMetadata(followerId, fields);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: true, follower }, null, 2) }],
          };
        }

        throw new Error(`Unknown action: ${action}`);
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: String(err) }) }],
          isError: true,
        };
      }
    },
  );
}
