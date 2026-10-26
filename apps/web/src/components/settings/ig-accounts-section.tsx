'use client'

import { useCallback, useEffect, useState } from 'react'
import { accountsApi, type IgAccountSummary } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

const ACCENT = '#E1306C'

/** tokenExpiresAt is epoch seconds; null means the expiry has not been fetched. */
function formatExpiry(expiresAt: number | null): string {
  if (expiresAt == null) return '未取得'
  return new Date(expiresAt * 1000).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export default function IgAccountsSection() {
  const { refreshAccounts } = useAccount()
  const [rows, setRows] = useState<IgAccountSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isOwner, setIsOwner] = useState(false)

  // New account form
  const [igUserId, setIgUserId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [verifyToken, setVerifyToken] = useState('')
  const [showAppFields, setShowAppFields] = useState(false)
  const [saving, setSaving] = useState(false)

  // Per-row token update mini form
  const [tokenEditId, setTokenEditId] = useState<string | null>(null)
  const [tokenDraft, setTokenDraft] = useState('')
  const [tokenSaving, setTokenSaving] = useState(false)

  useEffect(() => {
    setIsOwner(sessionStorage.getItem('igh_staff_role') === 'owner')
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setRows(await accountsApi.list())
    } catch (err) {
      setError(err instanceof Error ? err.message : '読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const reloadAll = useCallback(async () => {
    await load()
    // Keep the sidebar account switcher in sync (names / active state)
    await refreshAccounts()
  }, [load, refreshAccounts])

  const handleAdd = async () => {
    if (!accessToken.trim()) return
    setSaving(true)
    setError('')
    try {
      await accountsApi.create({
        igUserId: igUserId.trim() || undefined,
        accessToken: accessToken.trim(),
        ...(appSecret.trim() ? { appSecret: appSecret.trim() } : {}),
        ...(verifyToken.trim() ? { verifyToken: verifyToken.trim() } : {}),
      })
      setIgUserId('')
      setAccessToken('')
      setAppSecret('')
      setVerifyToken('')
      setShowAppFields(false)
      await reloadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'アカウントの追加に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleTokenSave = async (account: IgAccountSummary) => {
    if (!tokenDraft.trim()) return
    setTokenSaving(true)
    setError('')
    try {
      await accountsApi.update(account.id, { accessToken: tokenDraft.trim() })
      setTokenEditId(null)
      setTokenDraft('')
      await reloadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'トークンの更新に失敗しました')
    } finally {
      setTokenSaving(false)
    }
  }

  const handleToggleActive = async (account: IgAccountSummary) => {
    const next = !account.isActive
    if (!next && !confirm(`「${account.username ? `@${account.username}` : account.igUserId}」を停止しますか？\n停止中は Webhook 受信・配信が行われません`)) {
      return
    }
    setError('')
    try {
      await accountsApi.update(account.id, { isActive: next })
      await reloadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : '状態の変更に失敗しました')
    }
  }

  return (
    <section className="bg-kumo-base rounded-xl border border-kumo-line p-6">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-kumo-default">📷 Instagram アカウント</h2>
        <p className="text-[11px] text-kumo-subtle mt-1">
          複数の IG アカウントを登録すると、サイドバーの切替で各アカウントのデータを管理できます
        </p>
      </div>

      {error && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* 一覧 */}
      {loading ? (
        <div className="text-sm text-kumo-subtle">読み込み中...</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-kumo-subtle text-center py-6 border border-dashed border-kumo-line rounded-lg">
          アカウントが未登録です
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-kumo-subtle border-b border-kumo-line">
                <th className="py-2 pr-3 font-medium">アカウント</th>
                <th className="py-2 pr-3 font-medium">IG User ID</th>
                <th className="py-2 pr-3 font-medium">トークン</th>
                <th className="py-2 pr-3 font-medium">トークン期限</th>
                <th className="py-2 pr-3 font-medium">状態</th>
                {isOwner && <th className="py-2 font-medium">操作</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((account) => (
                <tr key={account.id} className="border-b border-gray-50 align-top">
                  <td className="py-2.5 pr-3">
                    <span className="font-medium text-kumo-default">
                      {account.username ? `@${account.username}` : account.igUserId}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-xs text-kumo-subtle">{account.igUserId}</td>
                  <td className="py-2.5 pr-3 font-mono text-xs text-kumo-subtle">{account.accessToken}</td>
                  <td className="py-2.5 pr-3 text-xs text-kumo-subtle">{formatExpiry(account.tokenExpiresAt)}</td>
                  <td className="py-2.5 pr-3">
                    <span className="inline-flex items-center gap-1">
                      {account.isDefault && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700">
                          デフォルト
                        </span>
                      )}
                      {!account.isActive && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-kumo-tint text-kumo-subtle">
                          停止中
                        </span>
                      )}
                    </span>
                  </td>
                  {isOwner && (
                    <td className="py-2.5">
                      {tokenEditId === account.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="password"
                            value={tokenDraft}
                            onChange={(e) => setTokenDraft(e.target.value)}
                            placeholder="新しいアクセストークン"
                            autoFocus
                            className="w-44 px-2 py-1 border border-kumo-line rounded text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#E1306C] placeholder:text-gray-300 placeholder:font-normal"
                          />
                          <button
                            type="button"
                            onClick={() => handleTokenSave(account)}
                            disabled={tokenSaving || !tokenDraft.trim()}
                            className="px-2 py-1 text-xs text-white rounded disabled:opacity-50"
                            style={{ backgroundColor: ACCENT }}
                          >
                            {tokenSaving ? '...' : '保存'}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setTokenEditId(null); setTokenDraft('') }}
                            className="px-2 py-1 text-xs text-kumo-subtle bg-kumo-base border border-kumo-line rounded hover:bg-kumo-canvas"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => { setTokenEditId(account.id); setTokenDraft('') }}
                            className="px-2 py-1 text-xs text-kumo-subtle bg-kumo-base border border-kumo-line rounded hover:bg-kumo-canvas whitespace-nowrap"
                          >
                            トークン更新
                          </button>
                          {/* デフォルトアカウントは停止不可（API でも 400） */}
                          {!account.isDefault && (
                            <button
                              type="button"
                              onClick={() => handleToggleActive(account)}
                              className={`px-2 py-1 text-xs rounded border whitespace-nowrap ${
                                account.isActive
                                  ? 'text-red-500 bg-kumo-base border-red-200 hover:bg-red-50'
                                  : 'text-green-600 bg-kumo-base border-green-200 hover:bg-green-50'
                              }`}
                            >
                              {account.isActive ? '停止' : '有効化'}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 追加フォーム（owner のみ） */}
      {isOwner && (
        <div className="mt-5 pt-5 border-t border-kumo-line">
          <h3 className="text-xs font-semibold text-kumo-default mb-3">アカウントを追加</h3>
          <p className="text-xs text-kumo-subtle mb-3">保存前にInstagramへ接続し、User IDを確認します。DM・コメント・投稿の権限はMeta側でも確認してください。長期トークンを使用してください。接頭辞だけで種類や有効期限は判定しません。</p>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-xs font-medium text-kumo-subtle mb-1">
                  IG User ID（任意・空欄なら自動取得）
                </label>
                <input
                  type="text"
                  value={igUserId}
                  onChange={(e) => setIgUserId(e.target.value)}
                  placeholder="空欄で自動取得"
                  className="w-full px-3 py-2 border border-kumo-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C] font-mono placeholder:text-gray-300 placeholder:font-normal"
                />
              </div>

            </div>
            <div>
              <label className="block text-xs font-medium text-kumo-subtle mb-1">
                アクセストークン <span className="text-red-400">*</span>
              </label>
              <input
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="Instagram Login access token"
                className="w-full px-3 py-2 border border-kumo-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C] font-mono placeholder:text-gray-300 placeholder:font-normal"
              />
            </div>

            {/* 別 Meta App 設定（折りたたみ） */}
            <div>
              <button
                type="button"
                onClick={() => setShowAppFields((v) => !v)}
                className="flex items-center gap-1 text-xs text-kumo-subtle hover:text-kumo-default"
              >
                <svg
                  className={`w-3 h-3 transition-transform ${showAppFields ? 'rotate-90' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                別 Meta App を使う場合
              </button>
              {showAppFields && (
                <div className="mt-2 space-y-3 pl-4 border-l-2 border-kumo-line">
                  <p className="text-[11px] text-kumo-subtle">
                    省略時はデフォルトアカウントと同じ Meta App の設定を使います
                  </p>
                  <div>
                    <label className="block text-xs font-medium text-kumo-subtle mb-1">App Secret</label>
                    <input
                      type="password"
                      value={appSecret}
                      onChange={(e) => setAppSecret(e.target.value)}
                      placeholder="Meta App の App Secret"
                      className="w-full px-3 py-2 border border-kumo-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C] font-mono placeholder:text-gray-300 placeholder:font-normal"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-kumo-subtle mb-1">Verify Token</label>
                    <input
                      type="password"
                      value={verifyToken}
                      onChange={(e) => setVerifyToken(e.target.value)}
                      placeholder="Webhook 検証用トークン"
                      className="w-full px-3 py-2 border border-kumo-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C] font-mono placeholder:text-gray-300 placeholder:font-normal"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="pt-1">
              <button
                type="button"
                onClick={handleAdd}
                disabled={saving || !accessToken.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: ACCENT }}
              >
                {saving ? '追加中...' : 'アカウントを追加'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
