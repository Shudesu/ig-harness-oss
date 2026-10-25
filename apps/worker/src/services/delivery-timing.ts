// =============================================================================
// Delivery timing helpers — spread scheduled work over time
// =============================================================================

/**
 * Add random jitter to a delay in milliseconds.
 * Returns base + random(0, jitterRange) ms.
 */
export function addJitter(baseMs: number, jitterRangeMs: number): number {
  return baseMs + Math.floor(Math.random() * jitterRangeMs);
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate jittered delivery time for step delivery.
 * Adds random minutes (±5 min) to scheduled delivery to avoid
 * all scenario deliveries firing at exactly the same time.
 */
export function jitterDeliveryTime(scheduledAt: Date): Date {
  const jitterMinutes = Math.floor(Math.random() * 10) - 5; // -5 to +5 minutes
  const result = new Date(scheduledAt);
  result.setMinutes(result.getMinutes() + jitterMinutes);
  return result;
}
