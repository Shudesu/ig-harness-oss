export function isTransientD1Error(error) {
  if (error?.transient === true) return true;
  const message = `${error?.code ?? ''} ${error?.message ?? ''} ${error?.stderr ?? ''}`;
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|D1_ISOLATE_STORAGE_BUSY|temporar(?:ily|y) unavailable|database is (?:locked|busy)|service unavailable|upstream.*(?:timeout|timed out)/i.test(message);
}
export async function retryD1Read(operation, delay = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= 2 || !isTransientD1Error(error)) throw error;
      await delay(200 * 2 ** attempt);
    }
  }
}
