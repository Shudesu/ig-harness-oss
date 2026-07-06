'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Tag } from '@ig-harness/shared'
import { api } from '@/lib/api'
import type { FollowerApi } from '@/lib/api'
import Header from '@/components/layout/header'
import { FollowerAvatar } from '@/components/follower-avatar'

const PAGE_SIZE = 20

function TagBadge({ tag }: { tag: Tag }) {
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-xs font-medium text-white"
      style={{ backgroundColor: tag.color || '#E1306C' }}
    >
      {tag.name}
    </span>
  )
}

interface FollowerDetailModalProps {
  follower: FollowerApi
  onClose: () => void
}

function FollowerDetailModal({ follower, onClose }: FollowerDetailModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">フォロワー詳細</h2>
          <button
            onClick={onClose}
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="flex items-center gap-3">
            <FollowerAvatar igsid={follower.igsid} username={follower.username} displayName={follower.displayName} size="lg" />
            <div>
              <p className="font-semibold text-gray-900">{follower.displayName || follower.username || 'Unknown'}</p>
              {follower.username && <p className="text-sm text-gray-500">@{follower.username}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">IGSID</p>
              <p className="text-gray-700 font-mono text-xs break-all">{follower.igsid}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">スコア</p>
              <p className="text-gray-700 font-semibold">{follower.score}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">初回確認日</p>
              <p className="text-gray-700">{new Date(follower.createdAt).toLocaleDateString('ja-JP')}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">更新日</p>
              <p className="text-gray-700">{new Date(follower.updatedAt).toLocaleDateString('ja-JP')}</p>
            </div>
          </div>

          {follower.tags && follower.tags.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-1.5">タグ</p>
              <div className="flex flex-wrap gap-1.5">
                {follower.tags.map((tag) => (
                  <TagBadge key={tag.id} tag={tag} />
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}

export default function FollowersPage() {
  const [followers, setFollowers] = useState<FollowerApi[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [selectedTagId, setSelectedTagId] = useState('')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedFollower, setSelectedFollower] = useState<FollowerApi | null>(null)

  const loadTags = useCallback(async () => {
    try {
      const res = await api.tags.list()
      if (res.success && res.data) setAllTags(res.data)
    } catch {
      // Non-blocking
    }
  }, [])

  const loadFollowers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params: { offset: string; limit: string; tagId?: string; search?: string } = {
        offset: String((page - 1) * PAGE_SIZE),
        limit: String(PAGE_SIZE),
      }
      if (selectedTagId) params.tagId = selectedTagId
      if (search) params.search = search

      const res = await api.followers.list(params)
      if (res.success && res.data) {
        setFollowers(res.data.items)
        setTotal(res.data.total)
        setHasNextPage(res.data.hasNextPage)
      } else {
        setError(res.error || 'エラーが発生しました')
      }
    } catch {
      setError('フォロワーの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [page, selectedTagId, search])

  useEffect(() => { loadTags() }, [loadTags])
  useEffect(() => { setPage(1) }, [selectedTagId, search])
  useEffect(() => { loadFollowers() }, [loadFollowers])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearch(searchInput)
  }

  return (
    <div>
      <Header title="フォロワー" description="Instagramフォロワーの管理" />

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 mb-4">
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <input
            type="text"
            placeholder="ユーザー名・名前で検索"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 min-h-[44px] bg-white focus:outline-none focus:ring-2 focus:ring-pink-500 w-52"
          />
          <button
            type="submit"
            className="px-3 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#E1306C' }}
          >
            検索
          </button>
        </form>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 font-medium whitespace-nowrap">タグ:</label>
          <select
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 min-h-[44px] bg-white focus:outline-none focus:ring-2 focus:ring-pink-500"
            value={selectedTagId}
            onChange={(e) => setSelectedTagId(e.target.value)}
          >
            <option value="">すべて</option>
            {allTags.map((tag) => (
              <option key={tag.id} value={String(tag.id)}>{tag.name}</option>
            ))}
          </select>
        </div>
        <span className="text-sm text-gray-500">
          {loading ? '読み込み中...' : `${total.toLocaleString('ja-JP')} 件`}
        </span>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      {/* Table */}
      {loading ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="px-4 py-4 border-b border-gray-100 flex items-center gap-4 animate-pulse">
              <div className="w-9 h-9 rounded-full bg-gray-200" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-200 rounded w-32" />
                <div className="h-2 bg-gray-100 rounded w-20" />
              </div>
              <div className="h-5 bg-gray-100 rounded-full w-16" />
            </div>
          ))}
        </div>
      ) : followers.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <p className="text-gray-500 text-sm">フォロワーが見つかりません</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {followers.map((follower, idx) => (
            <button
              key={follower.id}
              onClick={() => setSelectedFollower(follower)}
              className={`w-full flex items-center gap-4 px-4 py-3.5 text-left hover:bg-gray-50 transition-colors ${idx !== followers.length - 1 ? 'border-b border-gray-100' : ''}`}
            >
              <FollowerAvatar igsid={follower.igsid} username={follower.username} displayName={follower.displayName} size="md" className="shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {follower.displayName || follower.username || 'Unknown'}
                </p>
                {follower.username && (
                  <p className="text-xs text-gray-400 truncate">@{follower.username}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-1 justify-end shrink-0 max-w-[150px]">
                {follower.tags?.slice(0, 3).map((tag) => (
                  <TagBadge key={tag.id} tag={tag} />
                ))}
              </div>
              <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && total > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mt-4">
          <p className="text-sm text-gray-500">
            {((page - 1) * PAGE_SIZE) + 1}〜{Math.min(page * PAGE_SIZE, total)} 件 / 全{total.toLocaleString('ja-JP')}件
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-2 min-h-[44px] text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              前へ
            </button>
            <span className="text-sm text-gray-600 px-1">{page} ページ</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasNextPage}
              className="px-3 py-2 min-h-[44px] text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              次へ
            </button>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {selectedFollower && (
        <FollowerDetailModal
          follower={selectedFollower}
          onClose={() => setSelectedFollower(null)}
        />
      )}
    </div>
  )
}
