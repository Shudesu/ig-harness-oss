'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { richMessagesApi, type RichMessage, type RichMessageBlock } from '@/lib/api'
import Header from '@/components/layout/header'
import TestSendModal from '@/components/test-send-modal'

const ACCENT = '#E1306C'

const KIND_LABELS: Record<RichMessage['kind'], string> = {
  cta: 'CTA',
  reward: 'リワード',
  reminder: 'リマインダー',
  generic: '汎用',
}

const KIND_CLASSES: Record<RichMessage['kind'], string> = {
  cta: 'bg-pink-100 text-pink-700',
  reward: 'bg-green-100 text-green-700',
  reminder: 'bg-yellow-100 text-yellow-700',
  generic: 'bg-gray-100 text-gray-600',
}

function firstImageUrl(blocks: RichMessageBlock[]): string | null {
  for (const b of blocks) {
    if (b.type === 'image') return b.url
    if (b.type === 'card' && b.image_url) return b.image_url
    if (b.type === 'carousel') {
      const found = b.cards.find((c) => c.image_url)
      if (found?.image_url) return found.image_url
    }
  }
  return null
}

export default function RichMessagesPage() {
  const [messages, setMessages] = useState<RichMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [testSendTarget, setTestSendTarget] = useState<RichMessage | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await richMessagesApi.list()
      setMessages(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load rich messages')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleDelete = async (msg: RichMessage) => {
    if (!confirm(`「${msg.name}」を削除しますか？`)) return
    try {
      await richMessagesApi.remove(msg.id)
      await load()
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'delete failed'
      if (reason.includes('409') && confirm('このメッセージは gate で使用中です。強制削除しますか？')) {
        try {
          await richMessagesApi.remove(msg.id, true)
          await load()
        } catch (err2) {
          alert(err2 instanceof Error ? err2.message : 'force delete failed')
        }
      } else {
        alert(reason)
      }
    }
  }

  return (
    <div>
      <Header title="DMテンプレート" description="キャンペーンで使い回せる DM の土台（画像+テキスト+ボタン）" />

      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm text-gray-500">
          {loading ? '読み込み中...' : `${messages.length} 件`}
        </div>
        <Link
          href="/rich-messages/new"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white"
          style={{ backgroundColor: ACCENT }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          新規作成
        </Link>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && messages.length === 0 && !error && (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
          <div className="text-gray-400 text-sm mb-4">まだテンプレートがありません</div>
          <Link
            href="/rich-messages/new"
            className="inline-block px-5 py-2.5 rounded-lg text-sm font-medium text-white"
            style={{ backgroundColor: ACCENT }}
          >
            最初のメッセージを作成
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {messages.map((msg) => {
          const thumb = firstImageUrl(msg.blocks)
          return (
            <div key={msg.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
              <div className="relative bg-gray-100 h-40">
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">
                    画像ブロックなし
                  </div>
                )}
                <span className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-[11px] font-medium ${KIND_CLASSES[msg.kind]}`}>
                  {KIND_LABELS[msg.kind]}
                </span>
              </div>
              <div className="p-4 flex-1">
                <div className="text-sm font-semibold text-gray-900 line-clamp-2">{msg.name}</div>
                <div className="mt-1 text-xs text-gray-500">
                  {msg.blocks.length} ブロック · 更新 {msg.updated_at.slice(0, 10)}
                </div>
              </div>
              <div className="border-t border-gray-100 px-3 py-2 flex gap-1">
                <Link
                  href={`/rich-messages/${msg.id}`}
                  className="flex-1 text-center px-3 py-1.5 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  編集
                </Link>
                <button
                  onClick={() => setTestSendTarget(msg)}
                  className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  テスト配信
                </button>
                <button
                  onClick={() => handleDelete(msg)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  削除
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {testSendTarget && (
        <TestSendModal
          open={true}
          onClose={() => setTestSendTarget(null)}
          richMessageId={testSendTarget.id}
          richMessageName={testSendTarget.name}
        />
      )}
    </div>
  )
}
