import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerEnrollScenario(server: McpServer): void {
  server.tool(
    "enroll_in_scenario",
    "Enroll an Instagram follower into a scenario. The follower will start receiving the scenario's step messages from step 1.",
    {
      scenarioId: z
        .string()
        .describe("The scenario ID to enroll the follower in"),
      followerId: z.string().describe("The follower's ID to enroll"),
    },
    async ({ scenarioId, followerId }) => {
      try {
        const client = getClient();
        const enrollment = await client.scenarios.enroll(scenarioId, followerId);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, enrollment },
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
