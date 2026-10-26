// Verified against Meta's Graph API version table on 2026-10-26.
// Keep one default shared by the SDK, Worker and installer.
export const DEFAULT_GRAPH_API_VERSION = 'v25.0';
export function graphApiVersion(override?: string): string {
    const version = override || DEFAULT_GRAPH_API_VERSION;
    if (!/^v\d+\.\d+$/.test(version))
        throw new Error('Invalid IG_GRAPH_API_VERSION');
    return version;
}
