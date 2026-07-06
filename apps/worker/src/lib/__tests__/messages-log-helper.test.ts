import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logMessage } from '@ig-harness/db';

describe('logMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts a row with correct params', async () => {
    const run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
    const bind = vi.fn().mockReturnValue({ run });
    const prepare = vi.fn().mockReturnValue({ bind });
    const db = { prepare } as unknown as D1Database;

    await logMessage(db, {
      followerId: 42,
      direction: 'out',
      messageType: 'template',
      body: 'hello',
      triggerSource: 'gate',
    });

    expect(prepare).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO messages_log'),
    );
    expect(bind).toHaveBeenCalledWith(42, 'out', 'template', 'hello', 'gate');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('swallows errors and calls console.error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const prepare = vi.fn().mockImplementation(() => {
      throw new Error('D1 is down');
    });
    const db = { prepare } as unknown as D1Database;

    // Must not throw
    await expect(
      logMessage(db, {
        followerId: 1,
        direction: 'in',
        messageType: 'text',
        body: 'test',
        triggerSource: 'gate',
      }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[logMessage]'),
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });
});
