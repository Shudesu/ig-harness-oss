'use client'

import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import ConnectionReportView, { stateIcon } from '@/components/connection-report'
import {
  accountsApi,
  healthApi,
  deliveryFailuresApi,
  DELIVERY_FAILURE_SOURCE_LABELS,
  type AccountHealthApi,
  type ConnectionReport,
  type DeliveryFailure,
  type DeliveryFailureSource,
  type IgAccountSummary,
} from '@/lib/api'
import { formatDateTime, metaErrorHint } from '@/lib/meta-errors'
import { useAccount } from '@/contexts/account-context'

const ACCENT = '#E1306C'

function tokenExpiryLine(h: AccountHealthApi | undefined, acc: IgAccountSummary) {
  const days = h?.token_days_left ?? (acc.tokenExpiresAt != null ? Math.floor((acc.tokenExpiresAt * 1000 - Date.now()) / 86_400_000) : null)
  if (days === null) return { icon: '⚠️', text: '有効期限は未取得です', hint: '再チェックで取得できる場合があります。' }
  if (days < 0) return { icon: '❌', text: `有効期限切れ（${-days}日前）`, hint: '設定 → Instagram アカウントから新しいトークンに更新してください。' }
  if (days <= 7) return { icon: '⚠️', text: `あと${days}日で期限切れ`, hint: '自動更新されない場合は設定から更新してください。' }
  return { icon: '✅', text: `あと${days}日`, hint: null }
}

function tokenApiLine(h: AccountHealthApi | undefined) {
  if (!h || h.token_api_ok === null) return { icon: '➖', text: '未確認', hint: '「再チェック」を押すと確認します。' }
  if (h.token_api_ok) return { icon: '✅', text: `正常（${formatDateTime(h.token_api_checked_at)} 確認）`, hint: null }
  const hint =
    h.token_api_reason === 'account_id_mismatch'
      ? '登録IDとトークンのアカウントが一致しません。'
      : h.token_api_reason === 'api_unavailable'
        ? 'Metaへの接続に失敗しました。時間をおいて再チェックしてください。'
        : 'トークンが無効です。設定から更新してください。'
  return { icon: '❌', text: `エラー（${formatDateTime(h.token_api_checked_at)}）`, hint }
}

function webhookLine(h: AccountHealthApi | undefined) {
  const at = h?.last_webhook_event_at
  if (!at) return { icon: '⚠️', text: 'まだ受信していません', hint: 'Webhook購読と Meta アプリの Callback URL を確認し、テストでコメントしてみてください。' }
  const hours = (Date.now() - new Date(at).getTime()) / 3_600_000
  if (hours > 72) return { icon: '⚠️', text: `${formatDateTime(at)}（3日以上受信なし）`, hint: '購読が外れていないか「Webhook購読をやり直す」で確認してください。' }
  return { icon: '✅', text: formatDateTime(at), hint: null }
}

function Line({ label, v }: { label: string; v: { icon: string; text: string; hint: string | null } }) {
  return (
    <li className="flex items-start gap-2 py-1.5">
      <span aria-hidden className="w-5 shrink-0 text-center">{v.icon}</span>
      <div className="min-w-0">
        <div className="text-sm text-kumo-default">{label}<span className="ml-2 text-xs text-kumo-subtle">{v.text}</span></div>
        {v.hint && <div className="text-xs text-amber-700">💡 {v.hint}</div>}
      </div>
    </li>
  )
}

function AccountCard({ account, health, isOwner }: { account: IgAccountSummary; health: AccountHealthApi | undefined; isOwner: boolean }) {
  const [report, setReport] = useState<ConnectionReport | null>(account.connection ?? health?.connection ?? null)
  const [busy, setBusy] = useState<'' | 'check' | 'subscribe'>('')
  const [error, setError] = useState('')

  useEffect(() => {
    setReport(account.connection ?? health?.connection ?? null)
  }, [account, health])

  const run = async (subscribe: boolean) => {
    setBusy(subscribe ? 'subscribe' : 'check')
    setError('')
    try {
      setReport(await accountsApi.connectionCheck(account.id, subscribe))
    } catch (err) {
      setError(err instanceof Error ? err.message : '接続チェックに失敗しました')
    } finally {
      setBusy('')
    }
  }

  const name = account.username ? `@${account.username}` : account.igUserId
  return (
    <section className="bg-kumo-base rounded-xl border border-kumo-line p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-base">{report ? stateIcon(report.ok ? 'ok' : 'missing') : '➖'}</span>
          <h2 className="text-sm font-semibold text-kumo-default">{name}</h2>
          {account.isDefault && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700">デフォルト</span>}
          {!account.isActive && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-kumo-tint text-kumo-subtle">停止中</span>}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => run(false)}
            disabled={!isOwner || busy !== ''}
            className="px-3 py-1.5 text-xs rounded-lg border border-kumo-line bg-kumo-base hover:bg-kumo-tint disabled:opacity-50"
          >
            {busy === 'check' ? 'チェック中...' : '再チェック'}
          </button>
          <button
            type="button"
            onClick={() => run(true)}
            disabled={!isOwner || busy !== ''}
            title={isOwner ? undefined : 'オーナーのみ実行できます'}
            className="px-3 py-1.5 text-xs rounded-lg text-white disabled:opacity-50"
            style={{ backgroundColor: ACCENT }}
          >
            {busy === 'subscribe' ? '購読中...' : 'Webhook購読をやり直す'}
          </button>
        </div>
      </div>
      {!isOwner && <p className="text-[11px] text-kumo-subtle mb-2">※ 再チェック・購読のやり直しはオーナー権限が必要です。</p>}
      {error && <p role="alert" className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <ul className="divide-y divide-kumo-line">
          <Line label="トークン有効期限" v={tokenExpiryLine(health, account)} />
          <Line label="トークンAPI確認" v={tokenApiLine(health)} />
          <Line label="最後のWebhook受信" v={webhookLine(health)} />
          {health && health.dm_failures_today > 0 && (
            <Line label="本日のDM失敗" v={{ icon: '⚠️', text: `${health.dm_failures_today}件`, hint: '下の失敗ログで原因を確認してください。' }} />
          )}
        </ul>
        <div>
          {report ? (
            <ConnectionReportView report={report} />
          ) : (
            <div className="rounded-lg border border-dashed border-kumo-line p-3 text-xs text-kumo-subtle">
              Webhook購読・権限のチェック結果がまだありません。「再チェック」を押してください。
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

const SOURCES = Object.keys(DELIVERY_FAILURE_SOURCE_LABELS) as DeliveryFailureSource[]

function FailureLog() {
  const { selectedAccountId } = useAccount()
  const [source, setSource] = useState('')
  const [rows, setRows] = useState<DeliveryFailure[] | null>(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let active = true
    setRows(null)
    setError('')
    deliveryFailuresApi
      .list({ source: source || undefined, limit: 100 })
      .then((r) => { if (active) setRows(r) })
      .catch(() => { if (active) setError('失敗ログを取得できませんでした') })
    return () => { active = false }
  }, [source, tick, selectedAccountId])

  return (
    <section className="bg-kumo-base rounded-xl border border-kumo-line p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-kumo-default">失敗ログ</h2>
          <p className="text-[11px] text-kumo-subtle">選択中のアカウントの送信・Webhook・設定の失敗（新しい順）</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="failure-source" className="text-xs text-kumo-subtle">種類</label>
          <select
            id="failure-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="px-2 py-1.5 border border-kumo-line rounded-lg text-xs bg-kumo-base"
          >
            <option value="">すべて</option>
            {SOURCES.map((s) => <option key={s} value={s}>{DELIVERY_FAILURE_SOURCE_LABELS[s]}</option>)}
          </select>
          <button type="button" onClick={() => setTick((n) => n + 1)} className="text-xs underline text-kumo-subtle">更新</button>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {rows === null && !error && <p className="text-sm text-kumo-subtle">読み込み中...</p>}
      {rows && rows.length === 0 && <p className="text-sm text-green-700">✅ 失敗はありません</p>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-kumo-subtle border-b border-kumo-line">
                <th className="py-2 pr-3 font-medium">種類</th>
                <th className="py-2 pr-3 font-medium">日時</th>
                <th className="py-2 pr-3 font-medium">コード</th>
                <th className="py-2 pr-3 font-medium">メッセージ</th>
                <th className="py-2 font-medium">対処ヒント</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-kumo-line align-top">
                  <td className="py-2 pr-3 text-xs whitespace-nowrap">
                    {DELIVERY_FAILURE_SOURCE_LABELS[r.source as DeliveryFailureSource] ?? r.source}
                    {r.username && <div className="text-[11px] text-kumo-subtle">@{r.username}</div>}
                  </td>
                  <td className="py-2 pr-3 text-xs text-kumo-subtle whitespace-nowrap">{formatDateTime(r.createdAt)}</td>
                  <td className="py-2 pr-3 text-xs font-mono whitespace-nowrap">
                    {r.errorCode ?? '—'}{r.errorSubcode ? `/${r.errorSubcode}` : ''}
                    {r.httpStatus ? <div className="text-[11px] text-kumo-subtle">HTTP {r.httpStatus}</div> : null}
                  </td>
                  <td className="py-2 pr-3 text-xs text-kumo-default break-words max-w-xs">{r.message ?? '—'}</td>
                  <td className="py-2 text-xs text-amber-800">{r.hint ?? metaErrorHint(r.errorCode) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default function ConnectionPage() {
  const [accounts, setAccounts] = useState<IgAccountSummary[]>([])
  const [health, setHealth] = useState<AccountHealthApi[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isOwner, setIsOwner] = useState(false)

  useEffect(() => { setIsOwner(sessionStorage.getItem('igh_staff_role') === 'owner') }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [acc, h] = await Promise.all([accountsApi.list(), healthApi.get().catch(() => null)])
      setAccounts(acc)
      setHealth(h?.accounts ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div>
      <Header
        title="接続状態"
        description="トークン・Webhook・権限の状態と、送信失敗の記録を確認します"
        action={
          <button type="button" onClick={load} className="px-3 py-2 text-sm rounded-lg border border-kumo-line bg-kumo-base hover:bg-kumo-tint">
            表示を更新
          </button>
        }
      />
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
      <div className="space-y-4 mb-8">
        {loading ? (
          <div className="bg-kumo-base rounded-xl border border-kumo-line p-5 text-sm text-kumo-subtle">読み込み中...</div>
        ) : accounts.length === 0 ? (
          <div className="bg-kumo-base rounded-xl border border-kumo-line p-5 text-sm text-kumo-subtle">アカウントが登録されていません</div>
        ) : (
          accounts.map((a) => (
            <AccountCard key={a.id} account={a} health={health.find((h) => h.account_id === a.id)} isOwner={isOwner} />
          ))
        )}
      </div>
      <FailureLog />
    </div>
  )
}
