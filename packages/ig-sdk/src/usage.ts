export type GraphUsage = {
    call_count?: number;
    total_cputime?: number;
    total_time?: number;
    estimated_time_to_regain_access?: number;
};
export type GraphObservation = {
    status: number;
    code?: number;
    subcode?: number;
    retryAfterMs?: number;
    usage: GraphUsage;
};
export function parseGraphUsage(headers: Pick<Headers, 'get'> | undefined): GraphUsage {
    const output: GraphUsage = {};
    const visit = (value: unknown, depth = 0) => {
        if (!value || typeof value !== 'object' || depth > 6)
            return;
        for (const [key, item] of Object.entries(value)) {
            if (['call_count', 'total_cputime', 'total_time', 'estimated_time_to_regain_access'].includes(key) && typeof item === 'number' && Number.isFinite(item) && item >= 0) {
                const field = key as keyof GraphUsage;
                output[field] = Math.max(output[field] ?? 0, item);
            }
            else if (item && typeof item === 'object')
                visit(item, depth + 1);
        }
    };
    for (const name of ['x-app-usage', 'x-business-use-case-usage']) {
        const raw = headers?.get(name);
        if (!raw || raw.length > 16384)
            continue;
        try {
            visit(JSON.parse(raw));
        }
        catch { /* invalid telemetry does not affect delivery */ }
    }
    return output;
}
