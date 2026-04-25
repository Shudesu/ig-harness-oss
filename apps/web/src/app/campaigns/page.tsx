'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import {
  engagementGatesApi,
  postsApi,
  type EngagementGate,
  type MediaItem,
} from '@/lib/api'
import Header from '@/components/layout/header'

const ACCENT = '#E1306C'

const TRIGGER_LABELS: Record<EngagementGate['trigger_type'], { emoji: string; label: string }> = {
  comment_on_post: { emoji: '🎥', label: 'リールコメント' },
  dm_keyword: { emoji: '💬', label: 'DMキーワード' },
  story_mention: { emoji: '📖', label: 'ストーリーメンション' },
}

const STATUS_LABELS: Record<EngagementGate['status'], string> = {
  active: '稼働中',
  paused: '停止中',
  archived: 'アーカイブ',
}

const STATUS_CLASSES: Record<EngagementGate['status'], string> = {
  active: 'bg-green-100 text-green-700',
  paused: 'bg-yellow-100 text-yellow-700',
  archived: 'bg-gray-100 text-gray-500',
}

export default function CampaignsPage() {
  const [gates, setGates] = useState<EngagementGate[]>([])
  const [mediaById, setMediaById] = useState<Record<string, MediaItem>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // Gates + media in parallel. Media lookup is best-effort; if it
      // fails we still render the cards with id-only target chips.
      const [gateData, mediaData] = await Promise.all([
        engagementGatesApi.list(),
        postsApi.listMyMedia({ limit: 100 }).catch(() => [] as MediaItem[]),
      ])
      setGates(gateData)
      const map: Record<string, MediaItem> = {}
      for (const m of mediaData) map[m.id] = m
      setMediaById(map)
    } catch {
      setError('キャンペーンの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Precompute a post→attached-gates index so we can show a "適用中の
  // 投稿" summary at the top (dedupe when one post is covered by
  // multiple campaigns).
  const uniqueTargetPosts = useMemo(() => {
    const ids = new Set<string>()
    for (const g of gates) {
      const t = g.target_post_ids ?? (g.target_post_id ? [g.target_post_id] : [])
      for (const id of t) ids.add(id)
    }
    return ids.size
  }, [gates])

  return (
    <div>
      <Header
        title="キャンペーン"
        description="コメント・DM・ストーリーメンションからLINE登録まで自動化"
        action={
          <Link
            href="/campaigns/new"
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90 inline-flex items-center"
            style={{ backgroundColor: ACCENT }}
          >
            + 新規キャンペーン
          </Link>
        }
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {!loading && gates.length > 0 && (
        <div className="mb-4 text-xs text-gray-500">
          {gates.length} キャンペーン · {uniqueTargetPosts} 投稿をカバー
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse space-y-3">
              <div className="h-4 bg-gray-200 rounded w-1/2" />
              <div className="h-3 bg-gray-100 rounded w-3/4" />
              <div className="flex gap-2 mt-4">
                {[...Array(3)].map((_, j) => (
                  <div key={j} className="w-16 h-16 bg-gray-100 rounded" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : gates.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <p className="text-gray-500 text-sm">キャンペーンがありません</p>
          <Link
            href="/campaigns/new"
            className="mt-3 inline-block text-sm font-medium hover:opacity-80 transition-opacity"
            style={{ color: ACCENT }}
          >
            + 最初のキャンペーンを作成
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {gates.map((g) => (
            <CampaignCard key={g.id} gate={g} mediaById={mediaById} />
          ))}
        </div>
      )}
    </div>
  )
}

function CampaignCard({
  gate,
  mediaById,
}: {
  gate: EngagementGate
  mediaById: Record<string, MediaItem>
}) {
  const trigger = TRIGGER_LABELS[gate.trigger_type] ?? { emoji: '⚡', label: gate.trigger_type }
  const targets = gate.target_post_ids ?? (gate.target_post_id ? [gate.target_post_id] : [])

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-sm transition-shadow">
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Link
              href={`/campaigns/${gate.id}`}
              className="text-sm font-semibold text-gray-900 hover:opacity-80 line-clamp-1"
            >
              {gate.name}
            </Link>
            <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px]">
              <span className="text-gray-500">
                {trigger.emoji} {trigger.label}
              </span>
              {gate.trigger_keyword && (
                <span className="px-1.5 py-0.5 rounded bg-pink-50 text-[#E1306C]">
                  「{gate.trigger_keyword}」
                </span>
              )}
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full font-medium ${STATUS_CLASSES[gate.status] ?? 'bg-gray-100 text-gray-500'}`}>
                {STATUS_LABELS[gate.status] ?? gate.status}
              </span>
            </div>
          </div>
          <div className="shrink-0 flex gap-1">
            <Link
              href={`/campaigns/${gate.id}`}
              className="px-2 py-1 rounded text-xs font-medium text-gray-600 hover:bg-gray-100"
            >
              詳細
            </Link>
            <Link
              href={`/campaigns/${gate.id}/edit`}
              className="px-2 py-1 rounded text-xs font-medium hover:opacity-80"
              style={{ color: ACCENT }}
            >
              編集
            </Link>
          </div>
        </div>
      </div>

      {gate.trigger_type === 'comment_on_post' && (
        <div className="p-4 bg-gray-50">
          <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-2">
            対象投稿 {targets.length > 0 && `(${targets.length})`}
          </div>
          {targets.length === 0 ? (
            <div className="text-xs text-gray-600">
              <span className="inline-flex items-center px-2 py-0.5 rounded bg-white border border-gray-200">
                🌐 全投稿（デフォルト）
              </span>
              <span className="ml-2 text-[10px] text-gray-400">
                個別指定キャンペーンのある投稿はそちらが優先
              </span>
            </div>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {targets.map((pid) => {
                const m = mediaById[pid]
                const thumb = m?.thumbnail_url || m?.media_url
                return (
                  <a
                    key={pid}
                    href={m?.permalink || '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 block group"
                    title={m?.caption?.slice(0, 100) ?? pid}
                  >
                    <div className="w-16 h-16 rounded overflow-hidden bg-gray-200 border border-gray-300 group-hover:border-[#E1306C]">
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[9px] text-gray-400 font-mono">
                          #{pid.slice(-6)}
                        </div>
                      )}
                    </div>
                  </a>
                )
              })}
            </div>
          )}
        </div>
      )}

      {gate.trigger_type !== 'comment_on_post' && (
        <div className="p-4 bg-gray-50 text-xs text-gray-600">
          {gate.trigger_type === 'dm_keyword'
            ? 'DMキーワードに反応（投稿制限なし）'
            : 'ストーリーメンションに反応（投稿制限なし）'}
        </div>
      )}
    </div>
  )
}
