export type InstagramMileageEventType =
  | 'instagram_dm_received'
  | 'instagram_comment_created'
  | 'instagram_story_mentioned';

type LineConnection = {
  id: string;
  worker_url: string;
  api_key: string;
  is_default: number;
};

export type MileageFetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Forward an Instagram action only after the follower has a confirmed LINE
 * friend UUID. Connections are tried default-first because the old link table
 * stores one UUID but predates an explicit connection_id column.
 */
export async function forwardLinkedInstagramEngagement(
  db: D1Database,
  input: {
    followerId: number;
    eventType: InstagramMileageEventType;
    sourceEventId: string;
    subjectKey?: string | null;
    metadata?: Record<string, unknown>;
  },
  fetchImpl: MileageFetch = (url, init) => fetch(url, init),
): Promise<boolean> {
  const follower = await db
    .prepare('SELECT line_friend_uuid FROM followers WHERE id = ?')
    .bind(input.followerId)
    .first<{ line_friend_uuid: string | null }>();
  if (!follower?.line_friend_uuid) return false;

  const rows = await db
    .prepare(
      `SELECT id, worker_url, api_key, is_default
         FROM line_harness_connections
        ORDER BY is_default DESC, created_at ASC`,
    )
    .all<LineConnection>();

  for (const connection of rows.results) {
    try {
      const response = await fetchImpl(
        `${connection.worker_url.replace(/\/$/, '')}/api/integrations/ig-harness/engagement`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${connection.api_key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            friendId: follower.line_friend_uuid,
            eventType: input.eventType,
            sourceEventId: input.sourceEventId,
            subjectKey: input.subjectKey ?? null,
            metadata: input.metadata ?? {},
          }),
        },
      );
      if (response.ok) return true;
      // A UUID linked to another registered Harness returns 404. Continue to
      // the next connection; all other failures are also best-effort so the
      // Instagram webhook itself is never rejected because mileage is down.
      console.warn(
        `[line-mileage] forward failed status=${response.status} connection=${connection.id}`,
      );
    } catch (error) {
      console.warn(`[line-mileage] network failure connection=${connection.id}`, error);
    }
  }
  return false;
}
