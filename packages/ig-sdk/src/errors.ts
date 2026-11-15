/** Structured Graph failure. Mutation requests are never automatically retried. */
export class InstagramApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: number,
    public readonly subcode?: number,
    public readonly retryAfterMs?: number,
    /** Meta's own error.message / error.type (credential-like strings masked, 300 chars max). */
    public readonly metaMessage?: string,
    public readonly metaType?: string,
  ) { super(message); this.name = 'InstagramApiError'; }
  get tokenExpired(): boolean { return this.code === 190; }
  get rateLimited(): boolean { return this.status === 429 || [4, 17, 32, 613, 80002].includes(this.code ?? -1); }
  get retryable(): boolean { return this.rateLimited || this.status >= 500; }
}

export class InstagramTransportError extends Error {
  constructor(public readonly timedOut: boolean) {
    super(timedOut ? 'Instagram request timed out; delivery outcome may be unknown' : 'Instagram request failed; delivery outcome may be unknown');
    this.name = 'InstagramTransportError';
  }
}

/** Keep Meta's diagnostic text but never anything that looks like a credential. */
export function safeMetaText(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const masked = value
    .replace(/(access_token|appsecret_proof|client_secret|token|secret)=([^&\s"']+)/gi, '$1=****')
    .replace(/\b(?:EAA|IGAA|IGQ|IGQV)[A-Za-z0-9_-]{8,}/g, '****')
    .replace(/[A-Za-z0-9_-]{40,}/g, '****')
    .replace(/\s+/g, ' ')
    .trim();
  return masked.length > 300 ? `${masked.slice(0, 299)}…` : masked;
}
