import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

/**
 * MCP CRUD for the LINE Harness multi-connection registry. Each connection
 * is a single LINE Harness deployment IG Harness can route outbound
 * friend-add traffic into. Engagement gates reference a connection by id
 * (`line_connection_id` on `manage_engagement_gates`); the cross-link
 * rewriter then sends recipients to `<worker>/r/<short>?ig=<IGSID>` so
 * LINE Harness can write `friends.ig_igsid` on first click.
 *
 * `list_tracked_links` and `list_traffic_pools` are read-only proxies into
 * the connected LINE Harness — useful when an operator wants to verify
 * which pool slug to set on a gate before saving.
 *
 * `test` returns `{ success: false, error }` instead of throwing so a
 * misconfigured key surfaces as a tool result rather than an exception.
 */
export function registerManageLineConnections(server: McpServer): void {
  server.tool(
    "manage_line_connections",
    "LINE Harness multi-connection registry CRUD + diagnostics. Actions: list, create, update, delete, set_default, test, list_tracked_links, list_traffic_pools. `update` is the right way to rotate an api_key or fix a worker_url typo — the connection id is preserved, so every engagement_gate referencing it keeps working without re-bind. Each connection points at one LINE Harness deployment that engagement gates can route IG↔LINE cross-link traffic through.",
    {
      action: z
        .enum([
          "list",
          "create",
          "update",
          "delete",
          "set_default",
          "test",
          "list_tracked_links",
          "list_traffic_pools",
        ])
        .describe("Action to perform"),
      connection_id: z
        .string()
        .optional()
        .describe(
          "Connection id (required for update, delete, set_default, test, list_tracked_links, list_traffic_pools)",
        ),
      name: z
        .string()
        .optional()
        .describe("Human-readable connection name (required for create, optional for update)"),
      worker_url: z
        .string()
        .optional()
        .describe(
          "LINE Harness worker URL, e.g. https://line-crm-worker.line-crm-api.workers.dev (required for create, optional for update)",
        ),
      api_key: z
        .string()
        .optional()
        .describe(
          "LINE Harness API key with at least read scope. Required for create. On update, send only when rotating — omit to keep the existing value. Stored encrypted; never echoed back in plaintext.",
        ),
      account_id: z
        .string()
        .nullable()
        .optional()
        .describe("Optional LINE-Harness-side account id for multi-tenant deployments"),
      is_default: z
        .boolean()
        .optional()
        .describe(
          "Promote this connection to the default. The default is preselected by the campaign wizard and used as fallback by background jobs.",
        ),
    },
    async ({ action, connection_id, name, worker_url, api_key, account_id, is_default }) => {
      try {
        const client = getClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const conns = (client as any).lineConnections;
        if (!conns) {
          throw new Error(
            "SDK client does not expose lineConnections resource. Ensure @ig-harness/sdk is built with line-connections support.",
          );
        }

        if (action === "list") {
          const result = await conns.list();
          return text({ success: true, connections: result });
        }

        if (action === "create") {
          if (!name) throw new Error("name is required for create");
          if (!worker_url) throw new Error("worker_url is required for create");
          if (!api_key) throw new Error("api_key is required for create");
          const conn = await conns.create({
            name,
            worker_url,
            api_key,
            account_id: account_id ?? null,
            is_default,
          });
          return text({ success: true, connection: conn });
        }

        if (!connection_id) throw new Error("connection_id is required for this action");

        if (action === "update") {
          // Build a sparse patch — undefined fields stay untouched on the
          // server. account_id explicitly distinguishes "not provided"
          // from "set to null", so we only forward it when the operator
          // actually passed a value (including null).
          const patch: Record<string, unknown> = {};
          if (name !== undefined) patch.name = name;
          if (worker_url !== undefined) patch.worker_url = worker_url;
          if (api_key !== undefined) patch.api_key = api_key;
          if (account_id !== undefined) patch.account_id = account_id;
          if (is_default !== undefined) patch.is_default = is_default;
          if (Object.keys(patch).length === 0) {
            throw new Error("update requires at least one of: name, worker_url, api_key, account_id, is_default");
          }
          const conn = await conns.update(connection_id, patch);
          return text({ success: true, connection: conn });
        }

        if (action === "delete") {
          await conns.delete(connection_id);
          return text({ success: true, deleted: connection_id });
        }

        if (action === "set_default") {
          await conns.setDefault(connection_id);
          return text({ success: true, default: connection_id });
        }

        if (action === "test") {
          const result = await conns.test(connection_id);
          return text(result);
        }

        if (action === "list_tracked_links") {
          const links = await conns.listTrackedLinks(connection_id);
          return text({ success: true, links });
        }

        if (action === "list_traffic_pools") {
          const pools = await conns.listTrafficPools(connection_id);
          return text({ success: true, pools });
        }

        throw new Error(`Unknown action: ${action}`);
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ success: false, error: String(err) }) },
          ],
          isError: true,
        };
      }
    },
  );
}

function text(payload: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(payload, null, 2) },
    ],
  };
}
