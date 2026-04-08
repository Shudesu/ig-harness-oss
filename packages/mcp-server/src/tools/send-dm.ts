import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerSendDm(server: McpServer): void {
  server.tool(
    "send_dm",
    "Send a DM to an Instagram follower. Supports text and image message types.",
    {
      followerId: z.string().describe("The follower's ID to send the DM to"),
      messageType: z
        .enum(["text", "image"])
        .default("text")
        .describe("Message type: 'text' for plain text, 'image' for image URL"),
      content: z
        .string()
        .describe(
          "Message content. For text: plain string. For image: URL of the image to send.",
        ),
    },
    async ({ followerId, messageType, content }) => {
      try {
        const client = getClient();
        const result = await client.followers.sendMessage(
          followerId,
          content,
          messageType,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, messageId: result.messageId },
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
