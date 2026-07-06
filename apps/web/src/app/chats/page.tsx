'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchApi, type FollowerApi, type FollowerListResponse } from '@/lib/api'
import type { ApiResponse } from '@ig-harness/shared'
import { FollowerAvatar } from '@/components/follower-avatar'

interface MessageLog {
  id: string
  direction: 'in' | 'out'
  messageType: string
  content: string
  createdAt: string
}

function parseContent(msg: MessageLog): string {
  if (msg.messageType === 'text') {
    try {
      const parsed = JSON.parse(msg.content)
      if (typeof parsed === 'object' && parsed !== null) return parsed.text ?? msg.content
    } catch { /* raw */ }
    return msg.content
  }
  if (msg.messageType === 'template') {
    try {
      const parsed = JSON.parse(msg.content)
      if (parsed.elements?.[0]?.title) return `[テンプレート] ${parsed.elements[0].title}`
    } catch { /* */ }
    return '[テンプレート]'
  }
  if (msg.messageType === 'image') return '[画像]'
  return `[${msg.messageType}]`
}

function DetailPanel({ friend }: { friend: FollowerApi }) {
  const meta = friend.metadata ?? {}
  const metaEntries = Object.entries(meta).filter(([k]) => k !== '{}')
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <FollowerAvatar igsid={friend.igsid} username={friend.username} displayName={friend.displayName} size="lg" />
          <div>
            <p className="text-sm font-bold text-gray-900">{friend.displayName || friend.username}</p>
            {friend.username && <p className="text-xs text-gray-400">@{friend.username}</p>}
          </div>
        </div>
        <a href={`https://instagram.com/${friend.username}`} target="_blank" rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs text-pink-600 hover:text-pink-800">
          Instagram プロフィール ↗
        </a>
      </div>

      <div className="p-4 space-y-4 text-sm">
        <div>
          <p className="text-[11px] font-medium text-gray-400 uppercase mb-1">ステータス</p>
          <div className="flex flex-wrap gap-1.5">
            {friend.isFollowing ? (
              <span className="bg-green-50 text-green-700 text-xs px-2 py-0.5 rounded">フォロー中</span>
            ) : (
              <span className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded">未フォロー</span>
            )}
            <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded">
              スコア: {friend.score}
            </span>
          </div>
        </div>

        {friend.tags && friend.tags.length > 0 && (
          <div>
            <p className="text-[11px] font-medium text-gray-400 uppercase mb-1">タグ</p>
            <div className="flex flex-wrap gap-1">
              {friend.tags.map((tag) => (
                <span key={tag.id} className="text-xs px-2 py-0.5 rounded-full border border-gray-200"
                  style={{ color: tag.color, borderColor: tag.color + '40' }}>
                  {tag.name}
                </span>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="text-[11px] font-medium text-gray-400 uppercase mb-1">IGSID</p>
          <p className="text-xs text-gray-600 font-mono">{friend.igsid}</p>
        </div>

        <div>
          <p className="text-[11px] font-medium text-gray-400 uppercase mb-1">登録日</p>
          <p className="text-xs text-gray-600">
            {new Date(friend.createdAt).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>

        {metaEntries.length > 0 && (
          <div>
            <p className="text-[11px] font-medium text-gray-400 uppercase mb-1">メタデータ</p>
            <div className="space-y-1">
              {metaEntries.map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs">
                  <span className="text-gray-500">{k}</span>
                  <span className="text-gray-700 font-medium truncate ml-2 max-w-[120px]">{String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function MessagePanel({ friendId, onBack }: {
  friendId: string
  onBack: () => void
}) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [messages, setMessages] = useState<MessageLog[]>([])
  const [loading, setLoading] = useState(true)
  const isComposingRef = useRef(false)
  const sendLockRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const loadMessages = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: MessageLog[] }>(
        `/api/friends/${friendId}/messages`,
      )
      if (res.success) setMessages(res.data)
    } catch { /* silent */ }
    setLoading(false)
  }, [friendId])

  useEffect(() => { loadMessages() }, [loadMessages])
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  const handleSend = async () => {
    if (!message.trim() || sending || sendLockRef.current) return
    sendLockRef.current = true
    setSending(true)
    try {
      await fetchApi(`/api/friends/${friendId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: JSON.stringify({ text: message.trim() }) }),
      })
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        direction: 'out',
        messageType: 'text',
        content: JSON.stringify({ text: message.trim() }),
        createdAt: new Date().toISOString(),
      }])
      setMessage('')
    } catch (err) {
      alert('送信失敗: ' + (err instanceof Error ? err.message : String(err)))
    }
    setSending(false)
    sendLockRef.current = false
  }

  return (
    <div className="flex flex-col h-full">
      {/* Mobile back */}
      <div className="px-3 py-2 border-b border-gray-200 bg-white shrink-0 lg:hidden">
        <button onClick={onBack} className="text-gray-400 hover:text-gray-600 flex items-center gap-1 text-sm">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          戻る
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-1.5 bg-gray-50 min-h-0">
        {loading ? (
          <p className="text-center text-gray-400 text-sm py-6">読み込み中...</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-6">メッセージなし</p>
        ) : (
          messages.map((msg) => {
            const isOut = msg.direction === 'out'
            return (
              <div key={msg.id} className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-md rounded-2xl px-3 py-1.5 ${
                  isOut ? 'bg-pink-500 text-white' : 'bg-white border border-gray-200 text-gray-900'
                }`}>
                  <p className="text-[13px] whitespace-pre-wrap break-words leading-relaxed">{parseContent(msg)}</p>
                  <p className={`text-[10px] mt-0.5 ${isOut ? 'text-pink-200' : 'text-gray-400'}`}>
                    {new Date(msg.createdAt).toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="px-3 py-2 border-t border-gray-200 bg-white shrink-0">
        <div className="flex gap-2">
          <input type="text" value={message}
            onChange={(e) => setMessage(e.target.value)}
            onCompositionStart={() => { isComposingRef.current = true }}
            onCompositionEnd={() => { isComposingRef.current = false }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || isComposingRef.current || e.keyCode === 229) return
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
            }}
            placeholder="メッセージを入力..."
            className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500/30 focus:border-pink-500" />
          <button onClick={handleSend} disabled={!message.trim() || sending}
            className="px-3 py-1.5 rounded-lg text-white text-sm font-medium disabled:opacity-40"
            style={{ backgroundColor: '#E1306C' }}>
            {sending ? '...' : '送信'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ChatsPage() {
  const [followers, setFollowers] = useState<FollowerApi[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetchApi<ApiResponse<FollowerListResponse>>('/api/friends?limit=100')
      .then((res) => setFollowers(res.data?.items ?? []))
      .finally(() => setLoading(false))
  }, [])

  const selected = followers.find((f) => String(f.id) === selectedId) ?? null
  const filtered = search
    ? followers.filter((f) =>
        (f.username ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (f.displayName ?? '').toLowerCase().includes(search.toLowerCase()))
    : followers

  return (
    <div className="-mx-4 -mt-[72px] lg:-mx-8 lg:-mt-8 -mb-6 lg:-mb-8 flex flex-col h-screen">
      <div className="px-4 py-2 border-b border-gray-200 bg-white flex items-center gap-2 shrink-0 lg:px-5 pt-[72px] lg:pt-2">
        <div className="w-6 h-6 rounded flex items-center justify-center text-white text-[10px] font-bold"
          style={{ background: 'linear-gradient(135deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)' }}>IG</div>
        <h1 className="text-sm font-bold text-gray-900">チャット</h1>
        <span className="text-[11px] text-gray-400">{followers.length} 件</span>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Col 1: follower list */}
        <div className={`w-64 border-r border-gray-200 bg-white flex flex-col shrink-0 ${
          selectedId ? 'hidden lg:flex' : 'flex'
        }`}>
          <div className="p-2 border-b border-gray-100 shrink-0">
            <input type="text" placeholder="検索..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-pink-500/30" />
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            {loading ? (
              <div className="p-2 space-y-1.5">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <p className="p-3 text-xs text-gray-400 text-center">該当なし</p>
            ) : (
              filtered.map((f) => {
                const active = String(f.id) === selectedId
                return (
                  <button key={f.id} onClick={() => setSelectedId(String(f.id))}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors border-b border-gray-50 ${
                      active ? 'bg-pink-50' : 'hover:bg-gray-50'
                    }`}>
                    <FollowerAvatar igsid={f.igsid} username={f.username} displayName={f.displayName} size="sm" className="shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className={`text-[13px] font-medium truncate ${active ? 'text-pink-700' : 'text-gray-900'}`}>
                        {f.displayName || f.username || f.igsid}
                      </p>
                      {f.username && <p className="text-[10px] text-gray-400 truncate">@{f.username}</p>}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Col 2: messages */}
        <div className={`flex-1 flex flex-col min-w-0 min-h-0 border-r border-gray-200 ${
          selectedId ? 'flex' : 'hidden lg:flex'
        }`}>
          {!selectedId ? (
            <div className="flex-1 flex items-center justify-center bg-gray-50">
              <p className="text-sm text-gray-400">フォロワーを選択</p>
            </div>
          ) : (
            <MessagePanel friendId={selectedId} onBack={() => setSelectedId(null)} />
          )}
        </div>

        {/* Col 3: detail */}
        <div className="hidden lg:flex w-72 bg-white flex-col shrink-0">
          {selected ? (
            <DetailPanel friend={selected} />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-xs text-gray-400">詳細</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
