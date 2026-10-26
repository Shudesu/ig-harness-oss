import * as p from '@clack/prompts';
import { WEBHOOK_FIELDS } from './instagram-api.js';
interface WebhookGuideOptions { workerUrl: string; metaVerifyToken: string }
export function showWebhookGuide(options: WebhookGuideOptions): void {
  p.note([
    'MetaアプリのInstagram Login用Webhook設定を確認してください。',
    `Callback URL: ${options.workerUrl}/webhook`,
    `Verify Token: ${options.metaVerifyToken}`,
    `購読フィールド: ${WEBHOOK_FIELDS.join(', ')}`,
    'App側の購読と、アカウント単位のsubscribed_appsの両方が必要です。',
    'ストーリーDMのメンションはmessagesの添付イベントで処理します。live_commentsは現在未対応です。',
    '利用対象・アプリロール・Access Levelに応じてApp Review要件を確認してください。',
  ].join('\n'),'Meta Webhookの設定');
}
