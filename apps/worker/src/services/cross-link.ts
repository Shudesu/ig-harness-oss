import { constantTimeEqual } from '../lib/security.js';
import { setLineFriendUuid } from '@ig-harness/db';

export async function verifyLinkSecret(configured: string, provided: string | undefined): Promise<boolean> {
  return constantTimeEqual(configured, provided);
}

export async function linkLineFriend(
  db: D1Database,
  args: { igsid: string; lineFriendUuid: string },
): Promise<boolean> {
  return await setLineFriendUuid(db, args.igsid, args.lineFriendUuid);
}
