'use client'

import { useCallback, useEffect, useState } from 'react'
import { lineConnectionsApi, type LineConnection } from '@/lib/api'
import Header from '@/components/layout/header'

const ACCENT = '#E1306C'

export default function SettingsPage() {
  const [connections, setConnections] = useState<LineConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // New connection form
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  // Per-connection test results
  const [testResults, setTestResults] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const rows = await lineConnectionsApi.list()
      setConnections(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleAdd = async () => {
    if (!name.trim() || !url.trim() || !apiKey.trim()) return
    setSaving(true)
    setError('')
    try {
      await lineConnectionsApi.create({
        name: name.trim(),
        worker_url: url.trim(),
        api_key: apiKey.trim(),
      })
      setName('')
      setUrl('')
      setApiKey('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '追加失敗')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (conn: LineConnection) => {
    if (!confirm(`「${conn.name}」を削除しますか？`)) return
    try {
      await lineConnectionsApi.remove(conn.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除失敗')
    }
  }

  const handleSetDefault = async (conn: LineConnection) => {
    try {
      await lineConnectionsApi.setDefault(conn.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '変更失敗')
    }
  }

  const handleTest = async (conn: LineConnection) => {
    setTestResults((prev) => ({ ...prev, [conn.id]: '...' }))
    const res = await lineConnectionsApi.test(conn.id)
    setTestResults((prev) => ({
      ...prev,
      [conn.id]: res.success ? '✅ 接続OK' : `❌ ${res.error ?? 'failed'}`,
    }))
  }

  return (
    <div>
      <Header title="設定" description="外部サービスとの連携を管理" />

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 max-w-2xl">
          {error}
        </div>
      )}

      <div className="max-w-2xl space-y-6">
        {/* 登録済み接続先 */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">🔗 LINE Harness 接続先</h2>
              <p className="text-[11px] text-gray-500 mt-1">
                特典DMのリンクは、選ばれた接続先の tracked link を経由してクリック計測＋LINE連携
              </p>
            </div>
          </div>

          {loading ? (
            <div className="text-sm text-gray-400">読み込み中...</div>
          ) : connections.length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-6 border border-dashed border-gray-200 rounded-lg">
              接続先が未登録です。下のフォームから追加してください
            </div>
          ) : (
            <div className="space-y-2">
              {connections.map((conn) => (
                <div
                  key={conn.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800">{conn.name}</span>
                      {conn.is_default && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700">
                          デフォルト
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-500 font-mono truncate mt-0.5">
                      {conn.worker_url}
                    </div>
                    <div className="text-[10px] text-gray-400 font-mono mt-0.5">
                      Key: {conn.api_key_masked}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {testResults[conn.id] && (
                      <span className="text-[11px] mr-1">{testResults[conn.id]}</span>
                    )}
                    {!conn.is_default && (
                      <button
                        type="button"
                        onClick={() => handleSetDefault(conn)}
                        className="px-2 py-1 text-xs text-gray-600 bg-white border border-gray-200 rounded hover:bg-gray-50"
                      >
                        デフォルト
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleTest(conn)}
                      className="px-2 py-1 text-xs text-gray-600 bg-white border border-gray-200 rounded hover:bg-gray-50"
                    >
                      テスト
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(conn)}
                      className="px-2 py-1 text-xs text-red-500 bg-white border border-red-200 rounded hover:bg-red-50"
                    >
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 新規追加 */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">接続先を追加</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">名前</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="本番 / テスト / LINE メイン など"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C] placeholder:text-gray-300 placeholder:font-normal"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Worker URL</label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://line-crm-worker.line-crm-api.workers.dev"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C] font-mono placeholder:text-gray-300 placeholder:font-normal"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="lh_xxxxxxxxxxxxx"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C] font-mono placeholder:text-gray-300 placeholder:font-normal"
              />
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={handleAdd}
                disabled={saving || !name.trim() || !url.trim() || !apiKey.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: ACCENT }}
              >
                {saving ? '追加中...' : '追加'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
