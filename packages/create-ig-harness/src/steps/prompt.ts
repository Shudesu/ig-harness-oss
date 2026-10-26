import * as p from '@clack/prompts';
import { randomBytes } from 'node:crypto';
import { validateInstagramToken } from './instagram-api.js';
export interface MetaCredentials { metaAppSecret: string; metaAccessToken: string; metaVerifyToken: string; igUserId: string; igUsername: string }
export async function promptMetaCredentials(): Promise<MetaCredentials> {
  p.log.info('Instagram API with Instagram Login を使用します。Instagram → InstagramログインによるAPI設定のシークレットとアクセストークンを用意してください。Facebook Page Access Token は使用しません。');
  const secret = await p.password({ message: 'Instagram App Secret', validate: (v) => v.trim().length < 10 ? 'シークレットを入力してください' : undefined });
  if (p.isCancel(secret)) throw new Error('Setup canceled');
  const token = await p.password({ message: 'Instagram Login access token（接頭辞ではなくAPI応答で検証）', validate: (v) => v.trim().length < 20 ? 'トークンを入力してください' : undefined });
  if (p.isCancel(token)) throw new Error('Setup canceled');
  const profile = await validateInstagramToken(token.trim(),secret.trim());
  p.log.success(`Instagram: @${profile.username} / user_id=${profile.userId}`);
  const verify = await p.text({ message: 'Webhook Verify Token', initialValue: randomBytes(16).toString('hex'), validate: (v) => v.trim().length < 6 ? '6文字以上で入力してください' : undefined });
  if (p.isCancel(verify)) throw new Error('Setup canceled');
  return { metaAppSecret: secret.trim(), metaAccessToken: token.trim(), metaVerifyToken: verify.trim(), igUserId: profile.userId, igUsername: profile.username };
}
