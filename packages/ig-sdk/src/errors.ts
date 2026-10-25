/** Structured Graph failure. Mutation requests are never automatically retried. */
export class InstagramApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: number,
    public readonly subcode?: number,
    public readonly retryAfterMs?: number,
  ) { super(message); this.name = 'InstagramApiError'; }
  get tokenExpired(): boolean { return this.code === 190; }
  get rateLimited(): boolean { return this.status === 429 || [4, 17, 32, 613].includes(this.code ?? -1); }
  get retryable(): boolean { return this.rateLimited || this.status >= 500; }
}

export class InstagramTransportError extends Error {
  constructor(public readonly timedOut: boolean) {
    super(timedOut ? 'Instagram request timed out; delivery outcome may be unknown' : 'Instagram request failed; delivery outcome may be unknown');
    this.name = 'InstagramTransportError';
  }
}
