'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, richMessagesApi, type FollowerApi } from '@/lib/api'

interface Props {
  open: boolean
  onClose: () => void
  richMessageId: string
  richMessageName: string
}

export default function TestSendModal({ open, onClose, richMessageId, richMessageName }: Props) {
  const [toIgsid, setToIgsid] = useState('')
  const [pickedFollower, setPickedFollower] = useState<FollowerApi | null>(null)
  const [rewardUrl, setRewardUrl] = useState('')
  const [followerUsername, setFollowerUsername] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

  const handleSend = async () => {
    if (!toIgsid.trim()) {
      setError('宛先を選択してください')
      return
    }
    setSending(true)
    setError('')
    setResult(null)
    try {
      const res = await richMessagesApi.testSend(richMessageId, {
        to_igsid: toIgsid.trim(),
        reward_url: rewardUrl.trim() || undefined,
        follower_username: followerUsername.trim() || (pickedFollower?.username ?? undefined),
      })
      setResult(`✅ ${res.sent_blocks} 件のブロックを送信しました (${res.sent_at})`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'test-send failed')
    } finally {
      setSending(false)
    }
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">テスト配信</h2>
              <p className="text-xs text-gray-500 mt-0.5">{richMessageName}</p>
            </div>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="閉じる">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                宛先 <span className="text-red-500">*</span>
              </label>

              {pickedFollower ? (
                <div className="flex items-center gap-3 border border-gray-200 rounded-lg p-2 bg-gray-50">
                  <div className="w-10 h-10 rounded-full bg-gray-200 overflow-hidden shrink-0">
                    {pickedFollower.pictureUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={pickedFollower.pictureUrl} alt="" className="w-full h-full object-cover" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {pickedFollower.displayName || pickedFollower.username || '(名称なし)'}
                    </div>
                    <div className="text-[10px] text-gray-400 font-mono truncate">{pickedFollower.igsid}</div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPickerOpen(true)}
                      className="px-2 py-1 text-xs border border-gray-200 rounded hover:bg-white"
                    >
                      変更
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPickedFollower(null)
                        setToIgsid('')
                      }}
                      className="px-2 py-1 text-xs text-red-500 border border-gray-200 rounded hover:bg-red-50"
                    >
                      解除
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="w-full flex items-center justify-center gap-2 border border-dashed border-gray-300 rounded-lg px-3 py-3 text-sm text-gray-500 hover:border-[#E1306C] hover:text-[#E1306C]"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    フォロワーから選ぶ
                  </button>
                  <details className="mt-2">
                    <summary className="text-[11px] text-gray-500 cursor-pointer">IGSID を直接入力（上級者向け）</summary>
                    <input
                      type="text"
                      value={toIgsid}
                      onChange={(e) => setToIgsid(e.target.value)}
                      placeholder="例: 17841401234567890"
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
                    />
                    <p className="mt-1 text-[11px] text-gray-500">
                      動作確認なら自分の IGSID（周さんのアカウント ID）を入力
                    </p>
                  </details>
                </>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                {'{REWARD_URL} プレースホルダ値（任意）'}
              </label>
              <input
                type="text"
                value={rewardUrl}
                onChange={(e) => setRewardUrl(e.target.value)}
                placeholder="https://line.me/..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                {'{FOLLOWER_USERNAME}（任意）'}
              </label>
              <input
                type="text"
                value={followerUsername}
                onChange={(e) => setFollowerUsername(e.target.value)}
                placeholder={pickedFollower?.username ?? 'username'}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
              />
              {pickedFollower && !followerUsername && (
                <p className="mt-1 text-[11px] text-gray-400">
                  空欄なら選択したフォロワー（@{pickedFollower.username ?? '-'}）を自動で使用
                </p>
              )}
            </div>

            {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
            {result && <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{result}</div>}

            <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                閉じる
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || !toIgsid.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: '#E1306C' }}
              >
                {sending ? '送信中...' : '送信'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <FollowerPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(f) => {
          setPickedFollower(f)
          setToIgsid(f.igsid ?? '')
          setPickerOpen(false)
        }}
      />
    </>
  )
}

function FollowerPickerModal({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (f: FollowerApi) => void
}) {
  const [items, setItems] = useState<FollowerApi[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.followers.list({ limit: '100', search: search || undefined })
      setItems(res.data?.items ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load')
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => load(), 200) // debounce search
    return () => clearTimeout(t)
  }, [open, load])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900">フォロワーを選択</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="閉じる">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-3 border-b border-gray-200">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="名前・username で検索"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="text-center text-sm text-gray-400 py-12">読み込み中...</div>
          ) : error ? (
            <div className="text-center text-sm text-red-600 py-12">{error}</div>
          ) : items.length === 0 ? (
            <div className="text-center text-sm text-gray-400 py-12">
              {search ? '該当するフォロワーがいません' : 'フォロワーがまだいません。まず自分に向けて送る場合は「IGSID を直接入力」を開いてください'}
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {items
                .filter((f) => f.igsid)
                .map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => onPick(f)}
                    className="w-full flex items-center gap-3 px-6 py-3 text-left hover:bg-gray-50"
                  >
                    <div className="w-10 h-10 rounded-full bg-gray-200 overflow-hidden shrink-0">
                      {f.pictureUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={f.pictureUrl} alt="" className="w-full h-full object-cover" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {f.displayName || f.username || '(名称なし)'}
                      </div>
                      <div className="text-xs text-gray-500 truncate">@{f.username ?? '-'}</div>
                    </div>
                    {f.isFollowing && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">
                        フォロー中
                      </span>
                    )}
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
