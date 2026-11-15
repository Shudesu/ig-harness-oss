'use client'

import DeliveryStatus from '@/components/delivery-status'

import { useState, useEffect, useCallback } from 'react'
import type { MatchType, ResponseType } from '@ig-harness/shared'
import {
  api,
  postsApi,
  COMMENT_REPLY_MODE_LABELS,
  type MediaItem,
  type CommentRuleApi as CommentRule,
  type CommentRuleInput,
  type CommentRuleDelivery,
  type CommentReplyMode,
} from '@/lib/api'
import { metaErrorHint, formatDateTime } from '@/lib/meta-errors'
import Header from '@/components/layout/header'
import MediaPickerModal from '@/components/media-picker-modal'

/**
 * Inline media-id picker used by the comment-rules form. Shows the picked
 * post's thumbnail + caption snippet instead of a raw ID string.
 */
function MediaIdPicker({ mediaId, onChange }: { mediaId: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<MediaItem | null>(null)

  useEffect(() => {
    if (!mediaId) {
      setPreview(null)
      return
    }
    // Match the picked id against the last fetched media list if possible,
    // otherwise lightly fetch on demand. Cheap because /my-media caps at 100.
    let cancelled = false
    postsApi
      .listMyMedia({ limit: 100 })
      .then((all) => {
        if (cancelled) return
        const hit = all.find((m) => m.id === mediaId)
        setPreview(hit ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [mediaId])

  if (!mediaId) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full flex items-center justify-center gap-2 border border-dashed border-kumo-line rounded-lg px-3 py-3 text-sm text-kumo-subtle hover:border-[#E1306C] hover:text-[#E1306C]"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          投稿を選択
        </button>
        <MediaPickerModal
          open={open}
          onClose={() => setOpen(false)}
          onPick={(m) => onChange(m.id)}
        />
      </>
    )
  }

  return (
    <>
      <div className="flex items-center gap-3 border border-kumo-line rounded-lg p-2 bg-kumo-canvas">
        <div className="w-14 h-14 bg-kumo-fill rounded overflow-hidden shrink-0">
          {preview?.thumbnail_url || preview?.media_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.thumbnail_url || preview.media_url} alt="" className="w-full h-full object-cover" />
          ) : null}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-kumo-default line-clamp-2">
            {preview?.caption?.slice(0, 80) ?? '(選択済み — キャプションを取得中)'}
          </div>
          <div className="text-[10px] text-kumo-subtle font-mono mt-0.5 truncate">{mediaId}</div>
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="px-2 py-1 text-xs border border-kumo-line rounded hover:bg-kumo-base"
          >
            変更
          </button>
          <button
            type="button"
            onClick={() => onChange('')}
            className="px-2 py-1 text-xs text-red-500 border border-kumo-line rounded hover:bg-red-50"
          >
            解除
          </button>
        </div>
      </div>
      <MediaPickerModal open={open} onClose={() => setOpen(false)} onPick={(m) => onChange(m.id)} />
    </>
  )
}

const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  exact: '完全一致',
  contains: '部分一致',
  regex: '正規表現',
  any_comment: 'すべてのコメント',
}

const RESPONSE_TYPE_LABELS: Record<ResponseType, string> = {
  text: 'テキスト',
  image: '画像 (URL)',
  template: 'テンプレート',
  quick_reply: 'クイックリプライ',
}

// Only text and image are fully supported in the current admin UI
const SUPPORTED_RESPONSE_TYPES: ResponseType[] = ['text', 'image']

const ACCENT = '#F77737'

interface FormState {
  name: string
  mediaId: string
  keyword: string
  matchType: MatchType
  /** Remembered so the toggle can restore the user's previous choice. */
  previousMatchType: Exclude<MatchType, 'any_comment'>
  responseType: ResponseType
  responseText: string
  delaySeconds: number
  isActive: boolean
  /** Public comment reply text. '' = no public reply. */
  replyText: string
  /** When true, send null so the worker uses its default public reply. */
  replyUseDefault: boolean
  replyMode: CommentReplyMode
}

const DEFAULT_REPLY_PREVIEW = '@{{username}} コメントありがとう！📩 DMを送りました！'

const DELIVERY_STATUS_LABELS: Record<string, string> = {
  sent: '送信済み',
  pending: '送信待ち',
  processing: '処理中',
  failed: '失敗',
  skipped: '対象外',
  uncertain: '要確認',
}

const DELIVERY_REASON_LABELS: Record<string, string> = {
  window_closed: '24時間の送信枠外',
  standby: '他のアプリが応答を担当',
  private_reply_standby: '他のアプリが応答を担当',
  rate_limited: 'Metaの制限により待機中',
  outcome_unknown: '送信結果の確認が必要',
  private_reply_outcome_unknown: '送信結果の確認が必要',
  interrupted: '処理停止後の結果確認が必要',
  public_reply_failed: '公開コメントの返信に失敗',
  private_reply_expired: 'コメントから7日を超過',
  private_reply_already_sent: 'このコメントには送信済み',
  live_comment_not_supported: 'Liveコメントは未対応',
}

function describeError(code: number | null | undefined, message: string | null | undefined): string | null {
  if ((code === null || code === undefined) && !message) return null
  const hint = metaErrorHint(code)
  const parts: string[] = []
  if (code !== null && code !== undefined) parts.push(`Metaコード ${code}`)
  if (hint) parts.push(hint)
  if (message) parts.push(`（${message}）`)
  return parts.join(' ')
}

function RecentDeliveries({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<CommentRuleDelivery[] | null>(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let active = true
    setError('')
    api.commentRules
      .deliveries()
      .then((res) => { if (active) setRows(res.data ?? []) })
      .catch(() => { if (active) setError('配信履歴を取得できませんでした') })
    return () => { active = false }
  }, [refreshKey, tick])

  return (
    <section className="mt-8 bg-kumo-base rounded-lg border border-kumo-line p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-kumo-default">最近の配信結果</h2>
        <button type="button" className="text-xs underline text-kumo-subtle" onClick={() => setTick((n) => n + 1)}>更新</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {rows === null && !error ? (
        <p className="text-sm text-kumo-subtle">読み込み中...</p>
      ) : rows && rows.length === 0 ? (
        <p className="text-sm text-kumo-subtle">まだ配信履歴はありません</p>
      ) : rows ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-kumo-subtle border-b border-kumo-line">
                <th className="py-2 pr-3 font-medium">日時</th>
                <th className="py-2 pr-3 font-medium">相手</th>
                <th className="py-2 pr-3 font-medium">DM</th>
                <th className="py-2 pr-3 font-medium">公開返信</th>
                <th className="py-2 font-medium">エラー内容</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const dmError = describeError(row.errorCode, row.errorMessage)
                const replyError = describeError(row.publicReplyErrorCode, row.publicReplyErrorMessage)
                return (
                  <tr key={String(row.id)} className="border-b border-kumo-line align-top">
                    <td className="py-2 pr-3 text-xs text-kumo-subtle whitespace-nowrap">{formatDateTime(row.createdAt)}</td>
                    <td className="py-2 pr-3 text-xs">{row.username ? `@${row.username}` : '—'}</td>
                    <td className="py-2 pr-3 text-xs whitespace-nowrap">
                      <span className={row.status === 'sent' ? 'text-green-700' : row.status === 'failed' ? 'text-red-600' : 'text-kumo-default'}>
                        {DELIVERY_STATUS_LABELS[row.status] ?? row.status}
                      </span>
                      {row.reason && (
                        <div className="text-[11px] text-kumo-subtle">{DELIVERY_REASON_LABELS[row.reason] ?? row.reason}</div>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs whitespace-nowrap">
                      {row.publicReplyStatus === 'sent' ? (
                        <span className="text-green-700">✅ 返信済み</span>
                      ) : row.publicReplyStatus === 'failed' ? (
                        <span className="text-red-600">❌ 失敗</span>
                      ) : (
                        <span className="text-kumo-subtle">—</span>
                      )}
                      {row.replyMode && (
                        <div className="text-[11px] text-kumo-subtle">{COMMENT_REPLY_MODE_LABELS[row.replyMode] ?? row.replyMode}</div>
                      )}
                    </td>
                    <td className="py-2 text-xs text-kumo-default">
                      {dmError && <div><span className="text-kumo-subtle">DM: </span>{dmError}</div>}
                      {replyError && <div><span className="text-kumo-subtle">公開返信: </span>{replyError}</div>}
                      {!dmError && !replyError && <span className="text-kumo-subtle">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}

const DEFAULT_FORM: FormState = {
  name: '',
  mediaId: '',
  keyword: '',
  matchType: 'contains',
  previousMatchType: 'contains',
  responseType: 'text',
  responseText: '',
  delaySeconds: 0,
  isActive: true,
  replyText: '',
  replyUseDefault: true,
  replyMode: 'thread',
}

export default function CommentRulesPage() {
  const [rules, setRules] = useState<CommentRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [deliveryRefresh, setDeliveryRefresh] = useState(0)

  const loadRules = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.commentRules.list()
      if (res.success && res.data) {
        setRules(res.data)
      } else {
        setError(res.error || 'エラーが発生しました')
      }
    } catch {
      setError('コメントルールの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadRules() }, [loadRules])

  const openCreate = () => {
    setEditingId(null)
    setForm(DEFAULT_FORM)
    setFormError('')
    setShowForm(true)
  }

  const openEdit = (rule: CommentRule) => {
    setEditingId(String(rule.id))
    setForm({
      name: rule.name,
      mediaId: rule.mediaId || '',
      keyword: rule.keyword || '',
      matchType: rule.matchType,
      previousMatchType:
        rule.matchType === 'any_comment'
          ? 'contains'
          : (rule.matchType as Exclude<MatchType, 'any_comment'>),
      responseType: rule.responseType,
      responseText: (rule.responseBody as { text?: string }).text || '',
      delaySeconds: rule.delaySeconds,
      isActive: rule.isActive,
      replyText: rule.replyText ?? '',
      replyUseDefault: rule.replyText === null || rule.replyText === undefined,
      replyMode: rule.replyMode === 'mention' ? 'mention' : 'thread',
    })
    setFormError('')
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      setFormError('ルール名を入力してください')
      return
    }
    // Keyword-based match types can't store an empty keyword — the webhook
    // matcher dereferences rule.keyword.toLowerCase() and would throw.
    if (form.matchType !== 'any_comment' && !form.keyword.trim()) {
      setFormError('キーワードを入力するか、「すべてのコメントに反応」を ON にしてください')
      return
    }
    setSaving(true)
    setFormError('')

    // Build responseBody based on responseType
    let responseBody: Record<string, unknown>
    switch (form.responseType) {
      case 'text':
        responseBody = { text: form.responseText }
        break
      case 'image':
        responseBody = { url: form.responseText }
        break
      default:
        // template / quick_reply: store raw text as placeholder
        responseBody = { text: form.responseText }
    }

    const payload: CommentRuleInput = {
      name: form.name,
      mediaId: form.mediaId || null,
      keyword: form.keyword || null,
      matchType: form.matchType,
      responseType: form.responseType,
      responseBody,
      delaySeconds: form.delaySeconds,
      isActive: form.isActive,
      replyText: form.replyUseDefault ? null : form.replyText.trim(),
      replyMode: form.replyMode,
    }

    try {
      let res
      if (editingId) {
        res = await api.commentRules.update(editingId, payload)
      } else {
        res = await api.commentRules.create(payload)
      }
      if (res.success) {
        setShowForm(false)
        setForm(DEFAULT_FORM)
        setEditingId(null)
        loadRules()
        setDeliveryRefresh((n) => n + 1)
      } else {
        setFormError(res.error || '保存に失敗しました')
      }
    } catch {
      setFormError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (rule: CommentRule) => {
    try {
      await api.commentRules.toggle(String(rule.id), !rule.isActive)
      loadRules()
    } catch {
      setError('ステータスの変更に失敗しました')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このルールを削除しますか？')) return
    try {
      await api.commentRules.delete(id)
      loadRules()
    } catch {
      setError('削除に失敗しました')
    }
  }

  return (
    <div>
      <Header
        title="コメントルール"
        description="Instagramコメントへの自動返信ルールを管理"
        action={
          <button
            onClick={openCreate}
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: ACCENT }}
          >
            + 新規ルール
          </button>
        }
      />
      <div className="px-4 py-3"><DeliveryStatus /></div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      {/* Create / Edit form */}
      {showForm && (
        <div className="mb-6 bg-kumo-base rounded-lg shadow-sm border border-kumo-line p-6">
          <h2 className="text-sm font-semibold text-kumo-default mb-4">
            {editingId ? 'ルールを編集' : '新規ルールを作成'}
          </h2>
          <div className="space-y-4 max-w-lg">
            <div>
              <label className="block text-xs font-medium text-kumo-subtle mb-1">ルール名 <span className="text-red-500">*</span></label>
              <input
                type="text"
                className="w-full border border-kumo-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="例: 価格問い合わせ自動返信"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-kumo-subtle mb-1">対象投稿 (省略可)</label>
              <MediaIdPicker
                mediaId={form.mediaId}
                onChange={(id) => setForm({ ...form, mediaId: id })}
              />
              <p className="mt-1 text-[11px] text-kumo-subtle">
                省略時: すべての投稿への該当キーワードコメントに反応
              </p>
            </div>
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-kumo-line"
                  checked={form.matchType === 'any_comment'}
                  onChange={(e) =>
                    setForm((f) => {
                      if (e.target.checked) {
                        return {
                          ...f,
                          // Remember the previous (keyword-based) mode so we
                          // can restore it if the user toggles back off.
                          // Keyword is intentionally preserved: if the user
                          // toggles back, they shouldn't lose their draft.
                          previousMatchType:
                            f.matchType === 'any_comment' ? f.previousMatchType : f.matchType as Exclude<MatchType, 'any_comment'>,
                          matchType: 'any_comment',
                        }
                      }
                      return {
                        ...f,
                        matchType: f.previousMatchType,
                      }
                    })
                  }
                />
                <span className="text-xs text-kumo-default">
                  🎯 すべてのコメントに反応（キーワード不要）
                </span>
              </label>
              <p className="ml-6 mt-1 text-[11px] text-kumo-subtle">
                対象投稿が指定されていれば、その投稿への全コメント。未指定なら全投稿の全コメント
              </p>
            </div>
            {form.matchType !== 'any_comment' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-kumo-subtle mb-1">キーワード</label>
                  <input
                    type="text"
                    className="w-full border border-kumo-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                    placeholder="例: 価格"
                    value={form.keyword}
                    onChange={(e) => setForm({ ...form, keyword: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-kumo-subtle mb-1">マッチタイプ</label>
                  <select
                    className="w-full border border-kumo-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-kumo-base"
                    value={form.matchType}
                    onChange={(e) => setForm({ ...form, matchType: e.target.value as MatchType })}
                  >
                    {(['contains', 'exact', 'regex'] as MatchType[]).map((v) => (
                      <option key={v} value={v}>{MATCH_TYPE_LABELS[v]}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-kumo-subtle mb-1">レスポンスタイプ</label>
              <select
                className="w-full border border-kumo-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-kumo-base"
                value={form.responseType}
                onChange={(e) => setForm({ ...form, responseType: e.target.value as ResponseType })}
              >
                {SUPPORTED_RESPONSE_TYPES.map((v) => (
                  <option key={v} value={v}>{RESPONSE_TYPE_LABELS[v]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-kumo-subtle mb-1">
                {form.responseType === 'image' ? 'DMで送る画像URL' : 'DM本文（相手のDMに届く）'}
              </label>
              {form.responseType === 'text' ? (
                <textarea
                  className="w-full border border-kumo-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
                  rows={3}
                  placeholder="DMで送るメッセージを入力"
                  value={form.responseText}
                  onChange={(e) => setForm({ ...form, responseText: e.target.value })}
                />
              ) : (
                <input
                  type="url"
                  className="w-full border border-kumo-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="https://example.com/image.jpg"
                  value={form.responseText}
                  onChange={(e) => setForm({ ...form, responseText: e.target.value })}
                />
              )}
            </div>
            <div className="rounded-lg border border-kumo-line p-3 space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="ruleReplyText" className="block text-xs font-medium text-kumo-subtle">公開返信文（コメント欄に表示）</label>
                <label className="flex items-center gap-1.5 text-xs text-kumo-default cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-kumo-line"
                    checked={form.replyUseDefault}
                    onChange={(e) => setForm({ ...form, replyUseDefault: e.target.checked })}
                  />
                  既定文を使う
                </label>
              </div>
              {form.replyUseDefault ? (
                <p className="text-xs text-kumo-subtle bg-kumo-canvas border border-kumo-line rounded px-3 py-2">
                  既定文: {DEFAULT_REPLY_PREVIEW}
                </p>
              ) : (
                <textarea
                  id="ruleReplyText"
                  className="w-full border border-kumo-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
                  rows={2}
                  placeholder="空欄なら公開返信しません（例: @{{username}} DM送ったよ📩）"
                  value={form.replyText}
                  onChange={(e) => setForm({ ...form, replyText: e.target.value })}
                />
              )}
              {!form.replyUseDefault && !form.replyText.trim() && (
                <p className="text-[11px] text-amber-700">空欄のため公開返信はしません（DMのみ）</p>
              )}
              <div>
                <label htmlFor="ruleReplyMode" className="block text-xs font-medium text-kumo-subtle mb-1">返信方法</label>
                <select
                  id="ruleReplyMode"
                  className="w-full border border-kumo-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-kumo-base"
                  value={form.replyMode}
                  onChange={(e) => setForm({ ...form, replyMode: e.target.value === 'mention' ? 'mention' : 'thread' })}
                >
                  <option value="thread">{COMMENT_REPLY_MODE_LABELS.thread}</option>
                  <option value="mention">{COMMENT_REPLY_MODE_LABELS.mention}</option>
                </select>
                <p className="mt-1 text-[11px] text-kumo-subtle">
                  <code className="font-mono">{'{{username}}'}</code> でコメントした人のユーザー名を差し込めます。自分が所有・管理するアカウントなら Standard Access で動作。他人のアカウントを扱う場合のみ App Review（Advanced Access）が必要。
                </p>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-kumo-subtle mb-1">遅延 (秒)</label>
              <input
                type="number"
                min={0}
                className="w-full border border-kumo-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                value={form.delaySeconds}
                onChange={(e) => setForm({ ...form, delaySeconds: Number(e.target.value) })}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="ruleIsActive"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                className="w-4 h-4 rounded border-kumo-line"
              />
              <label htmlFor="ruleIsActive" className="text-sm text-kumo-subtle">作成後すぐに有効にする</label>
            </div>

            {formError && <p className="text-xs text-red-600">{formError}</p>}

            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
                style={{ backgroundColor: ACCENT }}
              >
                {saving ? '保存中...' : (editingId ? '更新' : '作成')}
              </button>
              <button
                onClick={() => { setShowForm(false); setEditingId(null); setFormError('') }}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-kumo-subtle bg-kumo-tint hover:bg-kumo-fill rounded-lg transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rules list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-kumo-base rounded-lg border border-kumo-line p-5 animate-pulse space-y-3">
              <div className="h-4 bg-kumo-fill rounded w-1/2" />
              <div className="h-3 bg-kumo-tint rounded w-3/4" />
            </div>
          ))}
        </div>
      ) : rules.length === 0 ? (
        <div className="bg-kumo-base rounded-lg shadow-sm border border-kumo-line p-12 text-center">
          <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
          </svg>
          <p className="text-kumo-subtle text-sm">コメントルールがありません</p>
          <button
            onClick={openCreate}
            className="mt-3 text-sm font-medium hover:opacity-80 transition-opacity"
            style={{ color: ACCENT }}
          >
            + 最初のルールを作成
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="bg-kumo-base rounded-lg border border-kumo-line p-5 flex items-start justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <h3 className="text-sm font-semibold text-kumo-default truncate">{rule.name}</h3>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    rule.isActive ? 'bg-green-100 text-green-700' : 'bg-kumo-tint text-kumo-subtle'
                  }`}>
                    {rule.isActive ? 'ON' : 'OFF'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-kumo-subtle">
                  {rule.matchType === 'any_comment' ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-pink-100 text-pink-700 text-[11px] font-medium">
                      🎯 すべてのコメント
                    </span>
                  ) : rule.keyword ? (
                    <span>キーワード: <span className="font-medium text-kumo-default">{rule.keyword}</span> ({MATCH_TYPE_LABELS[rule.matchType]})</span>
                  ) : null}
                  <span>DM: <span className="font-medium text-kumo-default">{RESPONSE_TYPE_LABELS[rule.responseType]}</span></span>
                  <span>公開返信: <span className="font-medium text-kumo-default">
                    {rule.replyText === '' ? 'しない' : rule.replyText == null ? '既定文' : 'カスタム'}
                    {rule.replyText !== '' && `（${COMMENT_REPLY_MODE_LABELS[rule.replyMode === 'mention' ? 'mention' : 'thread']}）`}
                  </span></span>
                  {rule.delaySeconds > 0 && (
                    <span>遅延: <span className="font-medium text-kumo-default">{rule.delaySeconds}秒</span></span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Toggle */}
                <button
                  onClick={() => handleToggle(rule)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    rule.isActive ? 'bg-orange-500' : 'bg-gray-300'
                  }`}
                  title={rule.isActive ? '無効にする' : '有効にする'}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-kumo-base shadow transition-transform ${
                      rule.isActive ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
                <button
                  onClick={() => openEdit(rule)}
                  className="p-2 rounded-lg text-kumo-subtle hover:text-kumo-subtle hover:bg-kumo-tint transition-colors"
                  title="編集"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  onClick={() => handleDelete(String(rule.id))}
                  className="p-2 rounded-lg text-kumo-subtle hover:text-red-500 hover:bg-red-50 transition-colors"
                  title="削除"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <RecentDeliveries refreshKey={deliveryRefresh} />
    </div>
  )
}
