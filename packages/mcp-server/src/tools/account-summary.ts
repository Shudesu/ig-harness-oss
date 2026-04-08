import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerAccountSummary(server: McpServer): void {
  server.tool(
    "account_summary",
    "Get a high-level summary of the Instagram account: follower count, active scenarios, recent broadcasts, tags, and forms. Use this to understand the current state before making changes.",
    {
      _unused: z
        .string()
        .optional()
        .describe("Unused parameter — reserved for future multi-account support"),
    },
    async () => {
      try {
        const client = getClient();

        const [totalFollowers, scenarios, broadcasts, tags, forms] =
          await Promise.all([
            client.followers.count(),
            client.scenarios.list(),
            client.broadcasts.list(),
            client.tags.list(),
            client.forms.list(),
          ]);

        const activeScenarios = scenarios.filter(
          (s: { isActive: boolean }) => s.isActive,
        );
        const recentBroadcasts = broadcasts.slice(0, 5);

        const summary = {
          followers: {
            total: totalFollowers,
          },
          scenarios: {
            total: scenarios.length,
            active: activeScenarios.length,
            activeList: activeScenarios.map(
              (s: { id: string; name: string; triggerType: string }) => ({
                id: s.id,
                name: s.name,
                triggerType: s.triggerType,
              }),
            ),
          },
          broadcasts: {
            total: broadcasts.length,
            recent: recentBroadcasts.map(
              (b: {
                id: string;
                title: string;
                status: string;
                sentAt: string | null;
              }) => ({
                id: b.id,
                title: b.title,
                status: b.status,
                sentAt: b.sentAt,
              }),
            ),
          },
          tags: {
            total: tags.length,
            list: tags.map((t: { id: string; name: string }) => ({
              id: t.id,
              name: t.name,
            })),
          },
          forms: {
            total: forms.length,
            list: forms.map(
              (f: { id: string; name: string; submitCount: number }) => ({
                id: f.id,
                name: f.name,
                submitCount: f.submitCount,
              }),
            ),
          },
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(summary, null, 2),
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
