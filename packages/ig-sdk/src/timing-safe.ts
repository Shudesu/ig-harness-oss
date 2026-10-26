export async function timingSafeEqualStr(a: string | null | undefined, b: string | null | undefined): Promise<boolean> {
  if (!a || !b) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([a, b].map((value) => crypto.subtle.digest('SHA-256', encoder.encode(value))));
  const x = new Uint8Array(left), y = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i]! ^ y[i]!;
  return difference === 0;
}
