import { setLineFriendUuid } from '@ig-harness/db';

export function verifyLinkSecret(
  configured: string,
  provided: string | undefined,
): boolean {
  if (!configured) return false;
  if (!provided) return false;
  if (configured.length !== provided.length) return false;
  // Timing-safe equality
  let mismatch = 0;
  for (let i = 0; i < configured.length; i++) {
    mismatch |= configured.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function linkLineFriend(
  db: D1Database,
  args: { igsid: string; lineFriendUuid: string },
): Promise<boolean> {
  return await setLineFriendUuid(db, args.igsid, args.lineFriendUuid);
}
