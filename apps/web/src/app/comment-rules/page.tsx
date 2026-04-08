'use client'

import { useState, useEffect, useCallback } from 'react'
import type { CommentRule, MatchType, ResponseType } from '@ig-harness/shared'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'

const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  exact: '完全一致',
  contains: '部分一致',
  regex: '正規表現',
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
  responseType: ResponseType
  responseText: string
  delaySeconds: number
  isActive: boolean
}

const DEFAULT_FORM: FormState = {
  name: '',
  mediaId: '',
  keyword: '',
  matchType: 'contains',
  responseType: 'text',
  responseText: '',
  delaySeconds: 0,
  isActive: true,
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
      responseType: rule.responseType,
      responseText: (rule.responseBody as { text?: string }).text || '',
      delaySeconds: rule.delaySeconds,
      isActive: rule.isActive,
    })
    setFormError('')
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      setFormError('ルール名を入力してください')
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

    const payload: Omit<CommentRule, 'id' | 'createdAt' | 'updatedAt'> = {
      name: form.name,
      mediaId: form.mediaId || null,
      keyword: form.keyword || null,
      matchType: form.matchType,
      responseType: form.responseType,
      responseBody,
      delaySeconds: form.delaySeconds,
      isActive: form.isActive,
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

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      {/* Create / Edit form */}
      {showForm && (
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">
            {editingId ? 'ルールを編集' : '新規ルールを作成'}
          </h2>
          <div className="space-y-4 max-w-lg">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">ルール名 <span className="text-red-500">*</span></label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="例: 価格問い合わせ自動返信"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">メディアID (省略可)</label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="特定の投稿IDに限定する場合"
                value={form.mediaId}
                onChange={(e) => setForm({ ...form, mediaId: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">キーワード</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="例: 価格"
                  value={form.keyword}
                  onChange={(e) => setForm({ ...form, keyword: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">マッチタイプ</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
                  value={form.matchType}
                  onChange={(e) => setForm({ ...form, matchType: e.target.value as MatchType })}
                >
                  {Object.entries(MATCH_TYPE_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">レスポンスタイプ</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
                value={form.responseType}
                onChange={(e) => setForm({ ...form, responseType: e.target.value as ResponseType })}
              >
                {SUPPORTED_RESPONSE_TYPES.map((v) => (
                  <option key={v} value={v}>{RESPONSE_TYPE_LABELS[v]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {form.responseType === 'image' ? '画像URL' : '返信テキスト'}
              </label>
              {form.responseType === 'text' ? (
                <textarea
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
                  rows={3}
                  placeholder="自動返信するメッセージを入力"
                  value={form.responseText}
                  onChange={(e) => setForm({ ...form, responseText: e.target.value })}
                />
              ) : (
                <input
                  type="url"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="https://example.com/image.jpg"
                  value={form.responseText}
                  onChange={(e) => setForm({ ...form, responseText: e.target.value })}
                />
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">遅延 (秒)</label>
              <input
                type="number"
                min={0}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
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
                className="w-4 h-4 rounded border-gray-300"
              />
              <label htmlFor="ruleIsActive" className="text-sm text-gray-600">作成後すぐに有効にする</label>
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
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
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
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse space-y-3">
              <div className="h-4 bg-gray-200 rounded w-1/2" />
              <div className="h-3 bg-gray-100 rounded w-3/4" />
            </div>
          ))}
        </div>
      ) : rules.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
          </svg>
          <p className="text-gray-500 text-sm">コメントルールがありません</p>
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
              className="bg-white rounded-lg border border-gray-200 p-5 flex items-start justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <h3 className="text-sm font-semibold text-gray-900 truncate">{rule.name}</h3>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    rule.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {rule.isActive ? 'ON' : 'OFF'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                  {rule.keyword && (
                    <span>キーワード: <span className="font-medium text-gray-700">{rule.keyword}</span> ({MATCH_TYPE_LABELS[rule.matchType]})</span>
                  )}
                  <span>返信タイプ: <span className="font-medium text-gray-700">{RESPONSE_TYPE_LABELS[rule.responseType]}</span></span>
                  {rule.delaySeconds > 0 && (
                    <span>遅延: <span className="font-medium text-gray-700">{rule.delaySeconds}秒</span></span>
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
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      rule.isActive ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
                <button
                  onClick={() => openEdit(rule)}
                  className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                  title="編集"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  onClick={() => handleDelete(String(rule.id))}
                  className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
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
    </div>
  )
}
