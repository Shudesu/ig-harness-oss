import { InstagramApiError, InstagramTransportError } from '@ig-harness/ig-sdk';

export type FailureSource = 'public_reply' | 'private_reply' | 'dm' | 'webhook' | 'broadcast' | 'scenario' | 'account_setup';
export const FAILURE_SOURCES: readonly FailureSource[] = ['public_reply', 'private_reply', 'dm', 'webhook', 'broadcast', 'scenario', 'account_setup'];

export interface FailureDetail {
  errorCode: number | null;
  errorSubcode: number | null;
  httpStatus: number | null;
  message: string | null;
}

const MAX_MESSAGE = 300;

/**
 * Meta error messages are operator-facing, but never let anything that looks
 * like a credential reach D1 or the admin UI.
 */
export function sanitizeErrorMessage(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  let text = String(raw);
  text = text
    .replace(/(access_token|appsecret_proof|client_secret|token|secret|password)=([^&\s"']+)/gi, '$1=****')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ****')
    .replace(/\b(?:EAA|IGAA|IGQ|IGQV)[A-Za-z0-9_-]{8,}/g, '****')
    .replace(/[A-Za-z0-9_-]{40,}/g, '****')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text;
}

export function describeFailure(error: unknown): FailureDetail {
  if (error instanceof InstagramApiError) {
    const meta = error.metaMessage ? `${error.metaMessage}${error.metaType ? ` [${error.metaType}]` : ''}` : error.message;
    return { errorCode: error.code ?? null, errorSubcode: error.subcode ?? null, httpStatus: error.status, message: sanitizeErrorMessage(meta) };
  }
  if (error instanceof InstagramTransportError) {
    return { errorCode: null, errorSubcode: null, httpStatus: null, message: error.timedOut ? 'Instagram API タイムアウト（送信結果は不明）' : 'Instagram API に接続できませんでした（送信結果は不明）' };
  }
  if (error instanceof Error) return { errorCode: null, errorSubcode: null, httpStatus: null, message: sanitizeErrorMessage(error.message) };
  return { errorCode: null, errorSubcode: null, httpStatus: null, message: sanitizeErrorMessage(error) };
}

/** Plain-Japanese hint for the most common Meta Graph error codes. */
export function failureHint(code: number | null | undefined, subcode?: number | null, message?: string | null): string | null {
  if (subcode === 2534022 || subcode === 2018278) return 'メッセージ送信期間（24時間）の外です。相手からの返信を待ってください。';
  if (code === 190) return 'アクセストークンが失効・無効です。設定 → Instagram アカウントでトークンを更新してください。';
  if (code === 10 || (code !== null && code !== undefined && code >= 200 && code <= 299)) return '権限が不足しています。Meta のアプリ設定で instagram_business_manage_comments / instagram_business_manage_messages が付与されているか確認してください。';
  if (code === 3) return 'アプリにこの機能の利用権限がありません（アクセスレベル・アプリのモードを確認）。';
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80002) return 'API のレート制限です。時間をおいて自動で再試行されます。';
  if (code === 551 || subcode === 2534014) return '相手のアカウントが利用できないか、メッセージを受け取れない状態です。';
  if (code === 100 && /comment/i.test(message ?? '')) return 'コメントが見つかりません（削除済み・非表示・返信への返信の可能性）。';
  if (code === 100) return 'リクエスト内容が受け付けられませんでした（ID・パラメータを確認）。';
  if (code === 1 || code === 2) return 'Meta 側の一時的なエラーです。時間をおいて確認してください。';
  return null;
}

/** Best-effort: a failure log write must never break the delivery path. */
export async function recordDeliveryFailure(db: D1Database, input: {
  accountId: string;
  source: FailureSource;
  stage?: string | null;
  refId?: string | null;
  followerId?: number | null;
  error?: unknown;
  detail?: Partial<FailureDetail>;
}): Promise<void> {
  try {
    const detail = { ...(input.error !== undefined ? describeFailure(input.error) : { errorCode: null, errorSubcode: null, httpStatus: null, message: null }), ...input.detail };
    await db.prepare(`INSERT INTO delivery_failures(account_id,source,stage,ref_id,follower_id,error_code,error_subcode,http_status,message,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .bind(input.accountId, input.source, input.stage ?? null, input.refId ?? null, input.followerId ?? null, detail.errorCode ?? null, detail.errorSubcode ?? null, detail.httpStatus ?? null, sanitizeErrorMessage(detail.message), new Date().toISOString())
      .run();
  } catch (err) {
    console.warn('[delivery-failures] could not record failure', err instanceof Error ? err.name : 'unknown');
  }
}

export async function listDeliveryFailures(db: D1Database, accountId: string, opts: { source?: string; limit?: number } = {}) {
  const limit = Math.min(200, Math.max(1, Math.floor(opts.limit ?? 50)));
  const source = opts.source && (FAILURE_SOURCES as readonly string[]).includes(opts.source) ? opts.source : null;
  const rows = await db.prepare(`SELECT d.id,d.source,d.stage,d.ref_id AS refId,d.follower_id AS followerId,f.username,d.error_code AS errorCode,d.error_subcode AS errorSubcode,d.http_status AS httpStatus,d.message,d.created_at AS createdAt
    FROM delivery_failures d LEFT JOIN followers f ON f.id=d.follower_id AND f.account_id=d.account_id
    WHERE d.account_id=? ${source ? 'AND d.source=?' : ''} ORDER BY d.id DESC LIMIT ?`)
    .bind(...(source ? [accountId, source, limit] : [accountId, limit]))
    .all<{ id: number; source: string; stage: string | null; refId: string | null; followerId: number | null; username: string | null; errorCode: number | null; errorSubcode: number | null; httpStatus: number | null; message: string | null; createdAt: string }>();
  return rows.results.map((row) => ({ ...row, hint: failureHint(row.errorCode, row.errorSubcode, row.message) }));
}
