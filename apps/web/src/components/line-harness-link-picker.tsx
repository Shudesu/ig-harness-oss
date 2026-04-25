'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  lineConnectionsApi,
  type LineConnection,
  type LineHarnessPool,
  type LineHarnessTrackedLink,
} from '@/lib/api'

interface Props {
  open: boolean
  onClose: () => void
  /**
   * Fired when the operator picks / creates a tracked link. Receives the
   * final tracking URL (with optional ?pool=<slug>) plus the LINE
   * Harness connection id and pool slug so the campaign row can
   * remember the binding for later edits.
   */
  onPick: (result: {
    trackingUrl: string
    connectionId: string
    poolSlug: string | null
    name: string
  }) => void
  defaultNewLinkName?: string
  initialConnectionId?: string | null
  initialPoolSlug?: string | null
}

export default function LineHarnessLinkPicker({
  open,
  onClose,
  onPick,
  defaultNewLinkName,
  initialConnectionId,
  initialPoolSlug,
}: Props) {
  const [connections, setConnections] = useState<LineConnection[]>([])
  const [connectionId, setConnectionId] = useState<string>('')
  const [pools, setPools] = useState<LineHarnessPool[]>([])
  const [poolSlug, setPoolSlug] = useState<string>('')
  const [items, setItems] = useState<LineHarnessTrackedLink[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  // Inline create
  const [creatingOpen, setCreatingOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [creating, setCreating] = useState(false)

  // Load connections on open.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const rows = await lineConnectionsApi.list()
        if (cancelled) return
        setConnections(rows)
        const preferred = initialConnectionId ?? rows.find((x) => x.is_default)?.id ?? rows[0]?.id ?? ''
        setConnectionId(preferred)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'failed to load')
      }
    })()
    setCreatingOpen(false)
    setNewName(defaultNewLinkName ?? '')
    setNewUrl('')
    return () => {
      cancelled = true
    }
  }, [open, defaultNewLinkName, initialConnectionId])

  // Re-sync pool preset when caller updates it
  useEffect(() => {
    if (open) setPoolSlug(initialPoolSlug ?? '')
  }, [open, initialPoolSlug])

  // Load tracked links + pools when connection changes.
  const loadForConnection = useCallback(async (id: string) => {
    setLoading(true)
    setError('')
    try {
      const [links, pls] = await Promise.all([
        lineConnectionsApi.listTrackedLinks(id),
        lineConnectionsApi.listTrafficPools(id),
      ])
      setItems(links)
      setPools(pls)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (connectionId) loadForConnection(connectionId)
  }, [connectionId, loadForConnection])

  const handleCreate = async () => {
    if (!connectionId || !newName.trim() || !newUrl.trim()) return
    setCreating(true)
    try {
      const created = await lineConnectionsApi.createTrackedLink(connectionId, {
        name: newName.trim(),
        originalUrl: newUrl.trim(),
      })
      onPick({
        trackingUrl: appendPool(created.trackingUrl, poolSlug),
        connectionId,
        poolSlug: poolSlug || null,
        name: created.name,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '作成失敗')
    } finally {
      setCreating(false)
    }
  }

  const handleSelect = (link: LineHarnessTrackedLink) => {
    onPick({
      trackingUrl: appendPool(link.trackingUrl, poolSlug),
      connectionId,
      poolSlug: poolSlug || null,
      name: link.name,
    })
    onClose()
  }

  const filtered = query.trim()
    ? items.filter(
        (x) =>
          x.name.toLowerCase().includes(query.toLowerCase()) ||
          x.originalUrl.toLowerCase().includes(query.toLowerCase()),
      )
    : items

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">🔗 LINE Harness から選択</h2>
            <p className="text-xs text-gray-500 mt-0.5">tracked link + pool を選ぶと LINE 側で自動で属性付与</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="閉じる">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {connections.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500">
            接続先が未登録です。
            <a href="/settings" className="text-[#E1306C] hover:underline ml-1">/settings</a> から追加してください
          </div>
        ) : (
          <>
            <div className="px-6 py-3 border-b border-gray-200 space-y-2">
              <div>
                <label className="block text-[10px] font-medium text-gray-500 mb-1 uppercase tracking-wider">
                  接続先
                </label>
                <select
                  value={connectionId}
                  onChange={(e) => setConnectionId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
                >
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.is_default ? ' (デフォルト)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-medium text-gray-500 mb-1 uppercase tracking-wider">
                  Pool（LINE側で属性タグ付け）
                </label>
                <select
                  value={poolSlug}
                  onChange={(e) => setPoolSlug(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
                >
                  <option value="">（指定なし）</option>
                  {pools.map((p) => (
                    <option key={p.id} value={p.slug}>
                      {p.name} ({p.slug})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {!creatingOpen ? (
              <>
                <div className="px-6 py-3 border-b border-gray-200 flex gap-2">
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="名前 or URL で絞り込み"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm placeholder:text-gray-300"
                  />
                  <button
                    type="button"
                    onClick={() => setCreatingOpen(true)}
                    className="px-3 py-2 rounded-lg text-xs font-medium border border-[#E1306C] text-[#E1306C] hover:bg-pink-50 whitespace-nowrap"
                  >
                    + 新規作成
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {loading ? (
                    <div className="text-center text-sm text-gray-400 py-12">読み込み中...</div>
                  ) : error ? (
                    <div className="text-center text-sm text-red-600 py-12 px-4">{error}</div>
                  ) : filtered.length === 0 ? (
                    <div className="text-center text-sm text-gray-400 py-12">
                      {items.length === 0
                        ? 'この接続先には tracked link がまだありません。+ 新規作成 から追加してください'
                        : '該当する tracked link がありません'}
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {filtered.map((x) => (
                        <button
                          key={x.id}
                          type="button"
                          onClick={() => handleSelect(x)}
                          className="w-full flex items-center gap-3 px-6 py-3 text-left hover:bg-gray-50"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-900 truncate">{x.name}</div>
                            <div className="text-[11px] text-gray-400 truncate mt-0.5">
                              → {x.originalUrl}
                            </div>
                          </div>
                          <div className="shrink-0 text-[10px] text-gray-400 font-medium">
                            {x.clickCount} クリック
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="p-6 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">名前</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="例: 権利収入 キャンペーン特典"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm placeholder:text-gray-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">誘導先 URL</label>
                  <input
                    type="url"
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    placeholder="https://line.me/R/ti/p/@xxx"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono placeholder:text-gray-300"
                  />
                </div>
                {error && (
                  <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {error}
                  </div>
                )}
                <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setCreatingOpen(false)}
                    className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={creating || !newName.trim() || !newUrl.trim()}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                    style={{ backgroundColor: '#E1306C' }}
                  >
                    {creating ? '作成中...' : '作成して使用'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** Append a `?pool=<slug>` to the tracking URL so LINE Harness can
 *  attribute the click to the given traffic pool. Respects existing
 *  query params and a trailing fragment. */
function appendPool(trackingUrl: string, poolSlug: string): string {
  if (!poolSlug) return trackingUrl
  const hashIdx = trackingUrl.indexOf('#')
  const hash = hashIdx >= 0 ? trackingUrl.slice(hashIdx) : ''
  const base = hashIdx >= 0 ? trackingUrl.slice(0, hashIdx) : trackingUrl
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}pool=${encodeURIComponent(poolSlug)}${hash}`
}
