'use client'

import type { CheckState, ConnectionReport } from '@/lib/api'
import { formatDateTime } from '@/lib/meta-errors'

export function stateIcon(state: CheckState | 'unknown'): string {
  switch (state) {
    case 'ok': return '✅'
    case 'missing': return '⚠️'
    case 'error': return '❌'
    default: return '➖'
  }
}

const STATE_LABEL: Record<CheckState, string> = {
  ok: 'OK',
  missing: '不足',
  error: 'エラー',
  skipped: '未確認',
}

function Row({ label, state, detail, hint }: { label: string; state: CheckState; detail?: string | null; hint?: string | null }) {
  return (
    <li className="flex items-start gap-2 py-1.5">
      <span aria-hidden className="w-5 shrink-0 text-center">{stateIcon(state)}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-kumo-default">
          {label}
          <span className="ml-2 text-[11px] text-kumo-subtle">{STATE_LABEL[state]}</span>
        </div>
        {detail && <div className="text-xs text-kumo-subtle break-words">{detail}</div>}
        {state !== 'ok' && hint && <div className="text-xs text-amber-700 mt-0.5">💡 {hint}</div>}
      </div>
    </li>
  )
}

/** Renders a ConnectionReport (Webhook subscription + permission checks). */
export default function ConnectionReportView({ report, compact = false }: { report: ConnectionReport; compact?: boolean }) {
  const wh = report.webhook
  const whDetail = [
    wh.subscribedNow ? '今回の操作で購読しました' : null,
    wh.fields.length > 0 ? `購読中: ${wh.fields.join(', ')}` : null,
    wh.missingFields.length > 0 ? `不足: ${wh.missingFields.join(', ')}` : null,
    wh.message ?? null,
  ].filter(Boolean).join(' / ')
  return (
    <div className={compact ? '' : 'rounded-lg border border-kumo-line bg-kumo-canvas px-3 py-2'}>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs font-semibold ${report.ok ? 'text-green-700' : 'text-amber-700'}`}>
          {report.ok ? '✅ すべて正常です' : '⚠️ 確認が必要な項目があります'}
        </span>
        <span className="text-[11px] text-kumo-subtle">確認日時 {formatDateTime(report.checkedAt)}</span>
      </div>
      <ul className="mt-1 divide-y divide-kumo-line">
        <Row
          label="プロフィール取得（トークン）"
          state={report.profile.state}
          detail={report.profile.username ? `@${report.profile.username}` : report.profile.message}
          hint="アクセストークンが有効か、設定から更新してください。"
        />
        <Row
          label="Webhook購読"
          state={wh.state}
          detail={whDetail || null}
          hint="「Webhook購読をやり直す」を押すか、Metaアプリの Webhooks 設定で comments / messages を購読してください。"
        />
        <Row
          label="コメント権限（instagram_business_manage_comments）"
          state={report.permissions.comments.state}
          detail={report.permissions.comments.message}
          hint="Metaアプリの権限にコメント管理を追加し、トークンを再発行してください。"
        />
        <Row
          label="メッセージ権限（instagram_business_manage_messages）"
          state={report.permissions.messages.state}
          detail={report.permissions.messages.message}
          hint="Metaアプリの権限にメッセージ管理を追加し、Instagramアプリの「メッセージへのアクセスを許可」もONにしてください。"
        />
      </ul>
    </div>
  )
}
