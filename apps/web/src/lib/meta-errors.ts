/**
 * Plain-Japanese explanations for common Meta Graph API error codes. Used
 * when the worker did not provide its own `hint` (e.g. comment-rule
 * delivery rows). Keep wording short: it is shown inline in tables.
 */
const META_ERROR_HINTS: Record<number, string> = {
  1: 'Meta側の一時的なエラーです。時間をおいて再試行してください。',
  2: 'Meta側の一時的なエラーです。時間をおいて再試行してください。',
  4: 'API呼び出しの上限に達しました。しばらく待ってください。',
  10: '権限が不足しています。アプリの権限（instagram_business_manage_*）を確認してください。',
  17: 'API呼び出しの上限に達しました。しばらく待ってください。',
  32: 'API呼び出しの上限に達しました。しばらく待ってください。',
  100: 'リクエスト内容が不正か、対象（コメント・投稿・ユーザー）が見つかりません。削除済みの可能性があります。',
  190: 'アクセストークンが無効または失効しています。設定からトークンを更新してください。',
  200: '権限が不足しています。コメント／メッセージ権限が許可されているか確認してください。',
  368: '不正利用防止のため一時的にブロックされています。送信頻度を下げてください。',
  551: 'このユーザーには現在メッセージを送れません（受信設定や制限による）。',
  613: 'API呼び出しの上限に達しました。しばらく待ってください。',
  10900: 'このコメントには既に返信DMを送信済みです。',
}

export function metaErrorHint(code: number | null | undefined): string | null {
  if (code === null || code === undefined) return null
  return META_ERROR_HINTS[code] ?? null
}

export function formatDateTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const d = typeof value === 'number' ? new Date(value * 1000) : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
