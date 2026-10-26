export async function createAppSecretProof(token: string, secret: string): Promise<string> {
    if (!token || !secret)
        throw new Error('Token and Instagram App Secret are required for appsecret_proof');
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(token))), b => b.toString(16).padStart(2, '0')).join('');
}
