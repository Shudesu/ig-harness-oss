export class InstagramHarnessError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string,
  ) {
    super(message)
    this.name = 'InstagramHarnessError'
  }
}

// Deprecated compatibility name: the same constructor, including instanceof.
export { InstagramHarnessError as LineHarnessError };
