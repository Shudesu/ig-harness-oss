import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerCreateMediaPost(server: McpServer): void {
  server.tool(
    "create_media_post",
    "Create an Instagram feed post, carousel, reel, or story (immediate or scheduled). " +
      "PUBLISHES PUBLICLY to the connected Instagram account — always confirm content, " +
      "media URLs, and timing with the user before calling. " +
      "Media URLs must be publicly accessible (use upload_image / the images API for hosting). " +
      "Omit scheduled_at to publish immediately; videos take a few minutes to process.",
    {
      post_type: z
        .enum(["feed_image", "carousel", "reel", "story"])
        .describe("feed_image: 1 image / carousel: 2-10 images+videos / reel: 1 video / story: 1 image or video"),
      media: z
        .array(
          z.object({
            url: z.string().url().describe("Public http(s) URL of the media file"),
            type: z.enum(["image", "video"]),
          }),
        )
        .min(1)
        .max(10),
      caption: z.string().optional().describe("Caption (ignored for stories)"),
      scheduled_at: z
        .string()
        .optional()
        .describe(
          "ISO 8601 datetime to schedule (offset-less strings are treated as JST, e.g. 2026-07-24T09:00:00 or 2026-07-24T09:00:00+09:00); omit for immediate publish",
        ),
    },
    async ({ post_type, media, caption, scheduled_at }) => {
      try {
        const client = getClient();
        const post = await client.mediaPosts.create({
          postType: post_type,
          media,
          caption,
          scheduledAt: scheduled_at,
        });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ success: true, post }, null, 2) },
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
