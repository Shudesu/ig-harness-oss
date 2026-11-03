import { afterEach, expect, it, vi } from 'vitest';
import { testDatabase } from '../../test-utils/d1.js';
import { sealToken } from '../token-crypto.js';
import { deriveKey } from '../tracking-token.js';
import { encryptLegacyCredentials, encryptLegacyLineConfig, openCredential, sealCredential } from '../credential-crypto.js';

const key = btoa('01234567890123456789012345678901');
afterEach(() => { vi.restoreAllMocks(); });

it('stores plaintext without a dedicated key and warns once per module isolate without values', async () => {
  vi.resetModules();
  const { sealCredential: seal } = await import('../credential-crypto.js');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  for (const env of [{}, { API_KEY: 'fake-api-key' }, { IG_APP_SECRET: 'fake-app-secret' }]) {
    expect(await seal('fake-credential', 'fake-subject', env)).toBe('fake-credential');
  }
  expect(warn.mock.calls).toEqual([['[credentials] TOKEN_ENCRYPTION_KEY missing; storing credentials in plaintext']]);
});

it('does not access the database for either credential migration without a dedicated key', async () => {
  const prepare = vi.fn(() => { throw new Error('must not access DB'); });
  const db = { prepare } as unknown as D1Database;
  await encryptLegacyCredentials(db, { API_KEY: 'fake-api-key' });
  await encryptLegacyLineConfig(db, { IG_APP_SECRET: 'fake-app-secret' });
  expect(prepare).not.toHaveBeenCalled();
});

it('encrypts only with the dedicated key and reads plaintext independently of key rotation', async () => {
  const env = { TOKEN_ENCRYPTION_KEY: key, API_KEY: 'fake-api-key' };
  const sealed = await sealCredential('fake-value', 'fake-subject', env);
  expect(sealed).toMatch(/^enc:v1:/);
  expect(await openCredential(sealed, 'fake-subject', { ...env, API_KEY: 'fake-rotated-key' })).toBe('fake-value');
  expect(await openCredential('fake-plaintext', 'fake-subject', {})).toBe('fake-plaintext');
  await expect(sealCredential('fake-value', 'fake-subject', { TOKEN_ENCRYPTION_KEY: 'invalid' })).rejects.toThrow();
});

it.each([{ API_KEY: 'fake-old-api-key', IG_APP_SECRET: 'fake-ignored-secret' }, { IG_APP_SECRET: 'fake-old-app-secret' }])('reads legacy fallback ciphertext with and without a dedicated key', async env => {
  const legacyKey = btoa(String.fromCharCode(...await deriveKey(env.API_KEY || env.IG_APP_SECRET, 'ig-credential-storage-v1')));
  const sealed = await sealToken('fake-value', 'fake-subject', legacyKey);
  expect(await openCredential(sealed, 'fake-subject', env)).toBe('fake-value');
  expect(await openCredential(sealed, 'fake-subject', { ...env, TOKEN_ENCRYPTION_KEY: key })).toBe('fake-value');
  await expect(openCredential(sealed, 'fake-subject', { API_KEY: 'fake-rotated-key' })).rejects.toThrow();
});

it('migrates legacy LINE config only with a key, preserving idempotency', async () => {
  const { db, sqlite } = await testDatabase();
  try {
    sqlite.exec("INSERT INTO integration_settings(key,value) VALUES('line_harness_api_key','fake-line-key')");
    const read = () => String(sqlite.prepare("SELECT value FROM integration_settings WHERE key='line_harness_api_key'").get()!.value);
    await encryptLegacyLineConfig(db, {});
    expect(read()).toBe('fake-line-key');
    await encryptLegacyLineConfig(db, { TOKEN_ENCRYPTION_KEY: key });
    const encrypted = read();
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(await openCredential(encrypted, 'legacy-line-api-key', { TOKEN_ENCRYPTION_KEY: key })).toBe('fake-line-key');
    await encryptLegacyLineConfig(db, { TOKEN_ENCRYPTION_KEY: key });
    expect(read()).toBe(encrypted);
  } finally { sqlite.close(); }
});
