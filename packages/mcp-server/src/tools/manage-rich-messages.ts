import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

const blockSchema = z.any();

export function registerManageRichMessages(server: McpServer): void {
  server.tool(
    "manage_rich_messages",
    "Manage reusable rich-message templates used by engagement gates. Actions: list, create, get, update, delete, test_send. Each rich message is a chain of blocks (text/image/card/carousel/quick_replies) dispatched sequentially to IG DM at send time. Use test_send to preview a message on your own IGSID before attaching it to gates.",
    {
      action: z
        .enum(["list", "create", "get", "update", "delete", "test_send"])
        .describe("Action to perform"),
      id: z
        .string()
        .optional()
        .describe("Rich message ID (required for get, update, delete, test_send)"),
      name: z
        .string()
        .optional()
        .describe("Human-readable name (required for create, optional for update)"),
      kind: z
        .enum(["cta", "reward", "reminder", "generic"])
        .optional()
        .describe("Tag indicating typical use (not enforced at send time)"),
      blocks: z
        .array(blockSchema)
        .optional()
        .describe(
          "Array of 1..5 blocks. Each block is one of: {type:'text',text}, {type:'image',url,alt?}, {type:'card',title,subtitle?,image_url?,default_url?,buttons:[{type:'postback'|'url',label,payload|url}]}, {type:'carousel',cards:[...up to 10]}, {type:'quick_replies',text,replies:[{label,payload}]}. Placeholders {IGSID},{GATE_ID},{DELIVERY_ID},{REWARD_URL},{FOLLOWER_USERNAME} are interpolated at send.",
        ),
      kind_filter: z
        .enum(["cta", "reward", "reminder", "generic"])
        .optional()
        .describe("Kind filter for list action"),
      limit: z.number().int().min(1).max(200).optional().describe("List limit (default 50)"),
      to_igsid: z
        .string()
        .optional()
        .describe("Target IGSID for test_send (typically your own IGSID)"),
      reward_url: z
        .string()
        .optional()
        .describe("Optional test-send value interpolated into {REWARD_URL} placeholders"),
      follower_username: z
        .string()
        .optional()
        .describe("Optional test-send value interpolated into {FOLLOWER_USERNAME} placeholders"),
      force: z
        .boolean()
        .optional()
        .describe("Force delete even if the message is referenced by gates"),
    },
    async ({ action, id, name, kind, blocks, kind_filter, limit, to_igsid, reward_url, follower_username, force }) => {
      try {
        const client = getClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rm = (client as any).richMessages;
        if (!rm) {
          throw new Error("SDK client does not expose richMessages resource. Rebuild @ig-harness/sdk.");
        }

        if (action === "list") {
          const result = await rm.list({ kind: kind_filter, limit });
          return {
            content: [
              { type: "text" as const, text: JSON.stringify({ success: true, rich_messages: result }, null, 2) },
            ],
          };
        }

        if (action === "create") {
          if (!name) throw new Error("name required for create");
          if (!kind) throw new Error("kind required for create");
          if (!blocks || blocks.length === 0) throw new Error("blocks required for create");
          const created = await rm.create({ name, kind, blocks });
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: true, rich_message: created }, null, 2) }],
          };
        }

        if (!id) throw new Error("id required for this action");

        if (action === "get") {
          const got = await rm.get(id);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: true, rich_message: got }, null, 2) }],
          };
        }

        if (action === "update") {
          const patch: Record<string, unknown> = {};
          if (name !== undefined) patch.name = name;
          if (kind !== undefined) patch.kind = kind;
          if (blocks !== undefined) patch.blocks = blocks;
          const updated = await rm.update(id, patch);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: true, rich_message: updated }, null, 2) }],
          };
        }

        if (action === "delete") {
          await rm.delete(id, { force: force ?? false });
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: true, deleted: id }, null, 2) }],
          };
        }

        if (action === "test_send") {
          if (!to_igsid) throw new Error("to_igsid required for test_send");
          const result = await rm.testSend(id, to_igsid, {
            rewardUrl: reward_url,
            followerUsername: follower_username,
          });
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: true, ...result }, null, 2) }],
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
