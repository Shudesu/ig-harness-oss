'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { postsApi, type MediaItem } from '@/lib/api'

interface Props {
  open: boolean
  onClose: () => void
  /** Called with the picked media (via gallery) or a bare id (via manual entry). */
  onPick: (media: Pick<MediaItem, 'id'> & Partial<MediaItem>) => void
  /**
   * Restrict the filter tabs. When set to anything other than 'all', the tab
   * row is hidden and the list is locked to the given product type. Comment-
   * based flows should pass 'REELS' or 'FEED' so STORY media — which flows
   * through the separate story_mention webhook — can't be picked by mistake.
   */
  productType?: 'REELS' | 'FEED' | 'STORY' | 'all'
  /** Filter tabs visible to the operator. */
  availableTypes?: Array<'all' | 'REELS' | 'FEED' | 'STORY'>
  /**
   * Multi-select: when true, the picker shows checkboxes and a "決定" button
   * that fires onPickMany instead of onPick per tile. selectedIds highlights
   * already-picked items.
   */
  multiSelect?: boolean
  onPickMany?: (media: MediaItem[]) => void
  selectedIds?: string[]
  /** Per-post campaign coverage so tiles can show an "既に N キャンペーン適用中" badge. */
  coverage?: Record<string, Array<{ gate_id: string; gate_name: string; status: string }>>
}

const TYPE_LABELS: Record<string, string> = {
  REELS: 'リール',
  FEED: '投稿',
  STORY: 'ストーリー',
  AD: '広告',
}

const TYPE_CLASSES: Record<string, string> = {
  REELS: 'bg-purple-100 text-purple-700',
  FEED: 'bg-blue-100 text-blue-700',
  STORY: 'bg-pink-100 text-pink-700',
  AD: 'bg-gray-100 text-gray-700',
}

export default function MediaPickerModal({
  open,
  onClose,
  onPick,
  productType = 'all',
  availableTypes,
  multiSelect = false,
  onPickMany,
  selectedIds = [],
  coverage = {},
}: Props) {
  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'REELS' | 'FEED' | 'STORY' | 'all'>(productType)
  const [manualId, setManualId] = useState('')
  const [showManual, setShowManual] = useState(false)
  // Working set for multi-select mode. Reset when modal opens.
  const [working, setWorking] = useState<Set<string>>(() => new Set(selectedIds))

  useEffect(() => {
    if (open) setWorking(new Set(selectedIds))
    // Intentionally only resync on open toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Tabs default to the restricted list when productType isn't 'all', so
  // comment-based forms can't accidentally surface STORY media.
  // Memoized so the `load` useCallback below keeps a stable identity — an
  // inline array literal would make useEffect([open, load]) loop forever.
  const tabs = useMemo<Array<'all' | 'REELS' | 'FEED' | 'STORY'>>(
    () => availableTypes ?? (productType === 'all' ? ['all', 'REELS', 'FEED'] : [productType]),
    [availableTypes, productType],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await postsApi.listMyMedia({ productType: filter, limit: 100 })
      // When the filter is 'all' but the caller restricts the visible tabs
      // (e.g. comment-based forms that drop STORY), apply the same restriction
      // client-side so stories don't sneak into the grid via `all`.
      const allowedTypes = tabs.filter((t): t is 'REELS' | 'FEED' | 'STORY' => t !== 'all')
      const filtered =
        filter === 'all' && allowedTypes.length > 0
          ? data.filter((m) => !m.media_product_type || allowedTypes.includes(m.media_product_type as 'REELS' | 'FEED' | 'STORY'))
          : data
      setItems(filtered)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load media')
    } finally {
      setLoading(false)
    }
  }, [filter, tabs])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const submitManual = () => {
    const id = manualId.trim()
    if (!id) return
    onPick({ id })
    onClose()
    setManualId('')
    setShowManual(false)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">投稿を選択</h2>
            <p className="text-xs text-gray-500 mt-0.5">Instagram アカウントから直接取得</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="閉じる">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-3 border-b border-gray-200 flex gap-2 flex-wrap">
          {tabs.length > 1 &&
            tabs.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setFilter(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                  filter === t
                    ? 'border-[#E1306C] text-[#E1306C] bg-pink-50'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t === 'all' ? 'すべて' : TYPE_LABELS[t]}
              </button>
            ))}
          <button
            type="button"
            onClick={load}
            className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            🔄 再読込
          </button>
          <button
            type="button"
            onClick={() => setShowManual((v) => !v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
              showManual
                ? 'border-[#E1306C] text-[#E1306C] bg-pink-50'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            手動IDで指定
          </button>
        </div>

        {showManual && (
          <div className="px-6 py-3 border-b border-gray-200 bg-gray-50">
            <div className="text-xs text-gray-600 mb-2">
              古い投稿 (100件以上前) はギャラリーに出ません。Graph API で取得した メディア ID を直接入力できます。
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                placeholder="例: 17841401234567890_18012345678901234"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitManual()
                }}
              />
              <button
                type="button"
                onClick={submitManual}
                disabled={!manualId.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: '#E1306C' }}
              >
                使用
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center text-sm text-gray-400 py-12">読み込み中...</div>
          ) : error ? (
            <div className="text-center text-sm text-red-600 py-12">{error}</div>
          ) : items.length === 0 ? (
            <div className="text-center text-sm text-gray-400 py-12">
              該当する投稿が見つかりません
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {items.map((m) => {
                const thumb = m.thumbnail_url || m.media_url
                const captionPreview = m.caption?.slice(0, 50) ?? '(キャプションなし)'
                const productType = m.media_product_type ?? 'FEED'
                const attachedCampaigns = coverage[m.id] ?? []
                const isSelected = multiSelect && working.has(m.id)
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      if (multiSelect) {
                        setWorking((prev) => {
                          const next = new Set(prev)
                          if (next.has(m.id)) next.delete(m.id)
                          else next.add(m.id)
                          return next
                        })
                      } else {
                        onPick(m)
                        onClose()
                      }
                    }}
                    className={`group relative text-left bg-white border rounded-lg overflow-hidden transition-colors ${
                      isSelected
                        ? 'border-[#E1306C] ring-2 ring-[#E1306C]/30'
                        : 'border-gray-200 hover:border-[#E1306C]'
                    }`}
                  >
                    <div className="relative aspect-square bg-gray-100">
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">
                          サムネなし
                        </div>
                      )}
                      <span
                        className={`absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${TYPE_CLASSES[productType] ?? TYPE_CLASSES.FEED}`}
                      >
                        {TYPE_LABELS[productType] ?? productType}
                      </span>
                      {attachedCampaigns.length > 0 && (
                        <span
                          className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700"
                          title={attachedCampaigns.map((c) => c.gate_name).join(', ')}
                        >
                          ⚡ {attachedCampaigns.length}件適用中
                        </span>
                      )}
                      {multiSelect && (
                        <span
                          className={`absolute bottom-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                            isSelected ? 'bg-[#E1306C] text-white' : 'bg-white/90 text-gray-400 border border-gray-300'
                          }`}
                        >
                          {isSelected ? '✓' : ''}
                        </span>
                      )}
                      {!multiSelect && (
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                          <span className="opacity-0 group-hover:opacity-100 text-white text-xs font-medium">選択</span>
                        </div>
                      )}
                    </div>
                    <div className="p-2">
                      <div className="text-[11px] text-gray-700 line-clamp-2 leading-snug min-h-[28px]">
                        {captionPreview}
                      </div>
                      <div className="text-[10px] text-gray-400 mt-1 truncate">
                        {m.timestamp.slice(0, 10)}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {multiSelect && (
          <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50">
            <div className="text-xs text-gray-600">
              {working.size} 件選択中
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => {
                  const picked = items.filter((m) => working.has(m.id))
                  // Also preserve selectedIds that aren't in the current view
                  // (e.g. manually entered or filtered out): emit ids the caller
                  // can resolve from its own state.
                  const extraIds = [...working].filter((id) => !items.some((m) => m.id === id))
                  const extras: MediaItem[] = extraIds.map((id) => ({
                    id,
                    media_type: 'VIDEO',
                    permalink: '',
                    timestamp: '',
                  }))
                  onPickMany?.([...picked, ...extras])
                  onClose()
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: '#E1306C' }}
              >
                決定
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
