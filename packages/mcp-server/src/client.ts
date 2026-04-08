import { InstagramHarness } from "@ig-harness/sdk";

let clientInstance: InstagramHarness | null = null;

export function getClient(): InstagramHarness {
  if (clientInstance) return clientInstance;

  // Support both INSTAGRAM_HARNESS_* and IG_HARNESS_* env var names
  const apiUrl = process.env.INSTAGRAM_HARNESS_API_URL ?? process.env.IG_HARNESS_API_URL;
  const apiKey = process.env.INSTAGRAM_HARNESS_API_KEY ?? process.env.IG_HARNESS_API_KEY;

  if (!apiUrl || !apiKey) {
    throw new Error(
      "INSTAGRAM_HARNESS_API_URL (or IG_HARNESS_API_URL) and " +
      "INSTAGRAM_HARNESS_API_KEY (or IG_HARNESS_API_KEY) must be set"
    );
  }

  clientInstance = new InstagramHarness({ apiUrl, apiKey });

  return clientInstance;
}
