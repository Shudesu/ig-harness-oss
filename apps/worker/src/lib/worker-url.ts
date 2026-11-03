/** Validate before storing AND immediately before attaching any credentials. */
export function validateWorkerUrl(value: string): string {
  const fail = () => { throw new Error('worker_url must be a public HTTPS URL without credentials, query or fragment'); };
  let url: URL;
  try { url = new URL(value); } catch { return fail(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return fail();
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || host === 'localhost' || /\.(localhost|local|internal|home|lan)$/.test(host) || host === 'metadata.google.internal' || host === 'metadata.goog') return fail();
  // IPv6 literals are deliberately refused (including mapped IPv4 and zone IDs).
  if (host.includes(':') || host.startsWith('[')) return fail();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || (a === 100 && b! >= 64 && b! <= 127) || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 198 && (b === 18 || b === 19)) || a! >= 224) return fail();
  }
  return url.href.replace(/\/$/, '');
}
