'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Tag } from '@ig-harness/shared'
import Header from '@/components/layout/header'
import { api, broadcastsApi, type BroadcastApi, type BroadcastStatus } from '@/lib/api'
import { formatDateTime, metaErrorHint } from '@/lib/meta-errors'

const ACCENT = '#E1306C'

const STATUS: Record<BroadcastStatus, { label: string; cls: string }> = {
  draft: { label: '下書き', cls: 'bg-kumo-tint text-kumo-subtle' },
  scheduled: { label: '予約済み', cls: 'bg-blue-100 text-blue-700' },
  sending: { label: '送信中', cls: 'bg-amber-100 text-amber-700' },
  sent: { label: '送信完了', cls: 'bg-green-100 text-green-700' },
}

const RECIPIENT_STATUS: Record<string, string> = {
  sent: '送信済み',
  pending: '未送信',
  processing: '処理中',
  skipped: '対象外',
  failed: '失敗',
  uncertain: '要確認',
}

const RECIPIENT_REASON: Record<string, string> = {
  window_closed: '24時間の送信枠外',
  interrupted: '処理中断',
  rate_limited: 'Metaの制限',
}

function messageText(b: BroadcastApi): string {
  try {
    const parsed = JSON.parse(b.body) as { text?: string; url?: string }
    return parsed.text ?? parsed.url ?? ''
  } catch {
    return ''
  }
}

function tagIdOf(b: BroadcastApi): string | null {
  if (!b.tagFilter) return null
  try {
    const v = (JSON.parse(b.tagFilter) as { tagId?: string | number }).tagId
    return v === undefined ? null : String(v)
  } catch {
    return null
  }
}

function Summary({ b }: { b: BroadcastApi }) {
  if (!b.deliverySummary || b.deliverySummary.length === 0) {
    return b.status === 'sent' ? <p className="text-xs text-kumo-subtle">送信数: {b.totalSent}</p> : null
  }
  return (
    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-kumo-subtle">
      {b.deliverySummary.map((r, i) => (
        <li key={i}>
          {RECIPIENT_STATUS[r.status] ?? r.status}
          {r.reason && `（${RECIPIENT_REASON[r.reason] ?? r.reason}）`}
          {r.errorCode !== null && <span title={metaErrorHint(r.errorCode) ?? undefined}>［Metaコード {r.errorCode}］</span>}
          : <strong className="text-kumo-default">{r.count}</strong>
        </li>
      ))}
    </ul>
  )
}

export default function BroadcastsPage() {
  const [items, setItems] = useState<BroadcastApi[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [tagId, setTagId] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [list, tagRes] = await Promise.all([broadcastsApi.list(), api.tags.list().catch(() => null)])
      setItems(list)
      setTags(tagRes?.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '一斉配信の読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const tagName = (id: string | null) => (id ? tags.find((t) => String(t.id) === id)?.name ?? `タグ ${id}` : null)

  const handleCreate = async () => {
    if (!name.trim() || !text.trim()) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await broadcastsApi.createText({ name: name.trim(), text: text.trim(), tagId: tagId || null })
      setName('')
      setText('')
      setTagId('')
      setNotice('下書きを作成しました')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '下書きの作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleSend = async (b: BroadcastApi) => {
    const target = tagName(tagIdOf(b)) ? `タグ「${tagName(tagIdOf(b))}」のフォロワー` : '全フォロワー'
    if (!confirm(`「${b.name}」を${target}に今すぐ送信しますか？\n\n※Instagramの仕様上、最後のやり取りから24時間以内の相手にのみ届きます。送信後は取り消せません。`)) return
    setBusyId(b.id)
    setError('')
    setNotice('')
    try {
      const res = await broadcastsApi.send(b.id)
      setNotice(res?.status === 'sent' ? '送信が完了しました' : '送信を開始しました（残りは順次送信されます）')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '送信に失敗しました')
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (b: BroadcastApi) => {
    if (!confirm(`下書き「${b.name}」を削除しますか？`)) return
    setBusyId(b.id)
    setError('')
    try {
      await broadcastsApi.remove(b.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除に失敗しました')
    } finally {
      setBusyId(null)
    }
  }

  const loadDetail = async (b: BroadcastApi) => {
    try {
      const full = await broadcastsApi.get(b.id)
      setItems((prev) => prev.map((x) => (x.id === b.id ? full : x)))
    } catch {
      setError('配信結果の取得に失敗しました')
    }
  }

  return (
    <div>
      <Header title="一斉配信" description="フォロワーにテキストDMをまとめて送ります（24時間以内にやり取りした相手のみ）" />
      {error && <div role="alert" className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
      {notice && <div role="status" className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">{notice}</div>}

      <section className="mb-6 bg-kumo-base rounded-xl border border-kumo-line p-5">
        <h2 className="text-sm font-semibold text-kumo-default mb-3">下書きを作成</h2>
        <div className="space-y-3 max-w-xl">
          <div>
            <label htmlFor="bc-name" className="block text-xs font-medium text-kumo-subtle mb-1">配信名（管理用）</label>
            <input id="bc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 11月キャンペーン告知"
              className="w-full px-3 py-2 border border-kumo-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C]" />
          </div>
          <div>
            <label htmlFor="bc-text" className="block text-xs font-medium text-kumo-subtle mb-1">メッセージ（テキスト）</label>
            <textarea id="bc-text" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="送信するDMの本文"
              className="w-full px-3 py-2 border border-kumo-line rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#E1306C]" />
          </div>
          <div>
            <label htmlFor="bc-tag" className="block text-xs font-medium text-kumo-subtle mb-1">送信対象（任意）</label>
            <select id="bc-tag" value={tagId} onChange={(e) => setTagId(e.target.value)}
              className="w-full px-3 py-2 border border-kumo-line rounded-lg text-sm bg-kumo-base">
              <option value="">全フォロワー</option>
              {tags.map((t) => <option key={t.id} value={String(t.id)}>タグ: {t.name}</option>)}
            </select>
          </div>
          <button type="button" onClick={handleCreate} disabled={saving || !name.trim() || !text.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={{ backgroundColor: ACCENT }}>
            {saving ? '作成中...' : '下書きを保存'}
          </button>
        </div>
      </section>

      <section className="bg-kumo-base rounded-xl border border-kumo-line p-5">
        <h2 className="text-sm font-semibold text-kumo-default mb-3">配信一覧</h2>
        {loading ? (
          <p className="text-sm text-kumo-subtle">読み込み中...</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-kumo-subtle">まだ配信はありません</p>
        ) : (
          <ul className="divide-y divide-kumo-line">
            {items.map((b) => {
              const st = STATUS[b.status] ?? { label: b.status, cls: 'bg-kumo-tint text-kumo-subtle' }
              const tn = tagName(tagIdOf(b))
              const editable = b.status === 'draft' || b.status === 'scheduled'
              return (
                <li key={b.id} className="py-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-kumo-default">{b.name}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${st.cls}`}>{st.label}</span>
                    </div>
                    <p className="text-xs text-kumo-default mt-1 line-clamp-2 whitespace-pre-wrap">{messageText(b)}</p>
                    <p className="text-[11px] text-kumo-subtle mt-1">
                      対象: {tn ? `タグ「${tn}」` : '全フォロワー'} ／ 作成 {formatDateTime(b.createdAt)}
                      {b.sentAt && ` ／ 送信 ${formatDateTime(b.sentAt)}`}
                    </p>
                    <Summary b={b} />
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {!editable && (
                      <button type="button" onClick={() => loadDetail(b)} className="px-2 py-1 text-xs border border-kumo-line rounded hover:bg-kumo-tint">
                        結果を表示
                      </button>
                    )}
                    {b.status !== 'sent' && (
                      <button type="button" disabled={busyId === b.id} onClick={() => handleSend(b)}
                        className="px-3 py-1 text-xs text-white rounded disabled:opacity-50" style={{ backgroundColor: ACCENT }}>
                        {busyId === b.id ? '処理中...' : b.status === 'sending' ? '続きを送信' : '今すぐ送信'}
                      </button>
                    )}
                    {editable && (
                      <button type="button" disabled={busyId === b.id} onClick={() => handleDelete(b)}
                        className="px-2 py-1 text-xs text-red-500 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50">
                        削除
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
