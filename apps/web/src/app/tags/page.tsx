'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Tag } from '@ig-harness/shared'
import Header from '@/components/layout/header'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/meta-errors'

const ACCENT = '#E1306C'
const COLORS = ['#E1306C', '#F77737', '#FCAF45', '#22C55E', '#3B82F6', '#8B5CF6', '#6B7280']

export default function TagsPage() {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[0]!)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.tags.list()
      setTags(res.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'タグの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (!name.trim()) return
    setSaving(true)
    setError('')
    try {
      await api.tags.create({ name: name.trim(), color })
      setName('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'タグの作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (tag: Tag) => {
    if (!confirm(`タグ「${tag.name}」を削除しますか？\nフォロワーに付いているこのタグも外れます。`)) return
    setError('')
    try {
      await api.tags.delete(String(tag.id))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除に失敗しました')
    }
  }

  return (
    <div>
      <Header title="タグ" description="フォロワーの分類に使うタグを管理します（一斉配信の絞り込みにも使えます）" />
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

      <section className="mb-6 bg-kumo-base rounded-xl border border-kumo-line p-5">
        <h2 className="text-sm font-semibold text-kumo-default mb-3">タグを追加</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="tag-name" className="block text-xs font-medium text-kumo-subtle mb-1">タグ名</label>
            <input
              id="tag-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
              placeholder="例: 購入済み"
              className="w-full px-3 py-2 border border-kumo-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
            />
          </div>
          <div>
            <span className="block text-xs font-medium text-kumo-subtle mb-1">色</span>
            <div className="flex gap-1.5 py-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`色 ${c}`}
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full border-2 ${color === c ? 'border-kumo-default' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving || !name.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: ACCENT }}
          >
            {saving ? '追加中...' : '追加'}
          </button>
        </div>
      </section>

      <section className="bg-kumo-base rounded-xl border border-kumo-line p-5">
        <h2 className="text-sm font-semibold text-kumo-default mb-3">タグ一覧（{tags.length}）</h2>
        {loading ? (
          <p className="text-sm text-kumo-subtle">読み込み中...</p>
        ) : tags.length === 0 ? (
          <p className="text-sm text-kumo-subtle">タグがありません</p>
        ) : (
          <ul className="divide-y divide-kumo-line">
            {tags.map((tag) => (
              <li key={tag.id} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: tag.color || '#6B7280' }} />
                  <span className="text-sm text-kumo-default">{tag.name}</span>
                  <span className="text-[11px] text-kumo-subtle">{formatDateTime(tag.createdAt)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(tag)}
                  className="px-2 py-1 text-xs text-red-500 border border-red-200 rounded hover:bg-red-50"
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
