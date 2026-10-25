import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient } from '../client.js';
export function registerBroadcast(server: McpServer): void {
  server.tool('broadcast', 'Create and send or schedule an Instagram broadcast. Only followers inside their 24-hour inbound window are eligible.', {
    title: z.string(), messageType: z.enum(['text','image','template','quick_reply']),
    messageContent: z.string().describe('Plain text for text; JSON body for other message types'),
    targetType: z.enum(['all','tag']).default('all'), targetTagId: z.string().optional(),
    scheduledAt: z.string().optional(), accountId: z.string().optional(),
  }, async (input) => {
    try {
      const client = getClient(input.accountId);
      const broadcast = await client.broadcasts.create(input);
      const result = input.scheduledAt ? broadcast : await client.broadcasts.send(broadcast.id);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, broadcast: result }) }] };
    } catch (error) { return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: String(error) }) }], isError: true }; }
  });
}
