import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerListCrmObjects(server: McpServer): void {
  server.tool(
    "list_crm_objects",
    "List all CRM objects of a specific type: scenarios, forms, tags, tracked links, broadcasts, or comment rules.",
    {
      objectType: z
        .enum([
          "scenarios",
          "forms",
          "tags",
          "tracked_links",
          "broadcasts",
          "comment_rules",
        ])
        .describe("Type of CRM object to list"),
    },
    async ({ objectType }) => {
      try {
        const client = getClient();
        let items: unknown;

        switch (objectType) {
          case "scenarios":
            items = await client.scenarios.list();
            break;
          case "forms":
            items = await client.forms.list();
            break;
          case "tags":
            items = await client.tags.list();
            break;
          case "tracked_links":
            items = await client.trackedLinks.list();
            break;
          case "broadcasts":
            items = await client.broadcasts.list();
            break;
          case "comment_rules":
            items = await client.commentRules.list();
            break;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, objectType, items },
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
