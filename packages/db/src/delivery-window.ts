// B-06: single configurable delivery window for scenario step sends.
//
// Previously the window was hard-coded twice with different values
// (9-23 in step-delivery/human-touch, 9-21 in scenario enrollment) and
// could not be configured. Now: one setting, default = 24 hours (no
// restriction). Comment DMs (private reply) and normal replies were never
// windowed and stay unwindowed — this window only applies to scenario
// step sends.

export interface DeliveryWindow {
  /** JST start hour (0-23). */
  start: number;
  /** JST end hour (1-24; 24 = midnight). */
  end: number;
}

const SETTING_START = 'delivery_window_start_jst';
const SETTING_END = 'delivery_window_end_jst';

/** Parse stored hours; invalid/absent values fall back to the 24h default. */
export function parseDeliveryWindow(startRaw: string | undefined | null, endRaw: string | undefined | null): DeliveryWindow {
  const start = Number(startRaw);
  const end = Number(endRaw);
  const validStart = Number.isInteger(start) && start >= 0 && start <= 23 ? start : 0;
  const validEnd = Number.isInteger(end) && end >= 1 && end <= 24 ? end : 24;
  return { start: validStart, end: validEnd };
}

/** Read the window from integration_settings (default 0-24 = always deliver). */
export async function getDeliveryWindowJst(db: D1Database): Promise<DeliveryWindow> {
  const rows = await db
    .prepare(`SELECT key, value FROM integration_settings WHERE key IN (?, ?)`)
    .bind(SETTING_START, SETTING_END)
    .all<{ key: string; value: string }>();
  let start: string | undefined;
  let end: string | undefined;
  for (const row of rows.results ?? []) {
    if (row.key === SETTING_START) start = row.value;
    if (row.key === SETTING_END) end = row.value;
  }
  return parseDeliveryWindow(start, end);
}

export async function setDeliveryWindowJst(db: D1Database, window: DeliveryWindow): Promise<void> {
  const parsed = parseDeliveryWindow(String(window.start), String(window.end));
  for (const [key, value] of [[SETTING_START, String(parsed.start)], [SETTING_END, String(parsed.end)]] as const) {
    await db
      .prepare(
        `INSERT INTO integration_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value,
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))`,
      )
      .bind(key, value)
      .run();
  }
}

/** True when the given JST hour is inside the window. 24h window is always true. */
export function isWithinWindow(window: DeliveryWindow, jstHour: number): boolean {
  if (window.start === 0 && window.end === 24) return true;
  return jstHour >= window.start && jstHour < window.end;
}

/** Current JST hour, shared by the scheduler paths. */
export function currentJstHour(now = Date.now()): number {
  return new Date(now + 9 * 60 * 60_000).getUTCHours();
}

/** Push a date into the window (JST semantics), like the old enforceDeliveryWindow. */
export function enforceWindow(window: DeliveryWindow, date: Date, preferredHour?: number): Date {
  if (isWithinWindow(window, currentJstHour(date.getTime()))) return date;
  const startHour = preferredHour ?? window.start;
  const result = new Date(date);
  if (currentJstHour(date.getTime()) >= window.end) {
    result.setUTCDate(result.getUTCDate() + 1);
  }
  result.setUTCHours(startHour, 0, 0, 0);
  return result;
}

/** Convenience for guardrails display: window + whether "now" is inside. */
export function windowStatus(window: DeliveryWindow, now = Date.now()): { window: DeliveryWindow; within: boolean; nowJst: string } {
  return { window, within: isWithinWindow(window, currentJstHour(now)), nowJst: new Date(now).toISOString() };
}
