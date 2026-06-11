export { jstNow, toJstString, isTimeBefore } from './utils';
export * from './friends';
export * from './tags';
export * from './scenarios';
export * from './broadcasts';
export * from './tracked-links';
export * from './forms';
export * from './staff';
export * from './health';
export * from './engagement-gates.js';
export * from './rich-messages.js';
export * from './accounts.js';

/**
 * Thin wrapper around D1Database.
 * Pass the result of createDb() into any query helper in this package.
 */
export function createDb(d1: D1Database): D1Database {
  return d1;
}
