'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'

interface DashboardStats {
  followerCount: number | null
  dmCountToday: number | null
  activeCommentRulesCount: number | null
  activeScenariosCount: number | null
}

interface StatCardProps {
  title: string
  value: number | null
  loading: boolean
  icon: React.ReactNode
  href: string
  accentColor?: string
}

function StatCard({ title, value, loading, icon, href, accentColor = '#E1306C' }: StatCardProps) {
  return (
    <Link href={href} className="block bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow group">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500 mb-2">{title}</p>
          {loading ? (
            <div className="h-8 w-20 bg-gray-100 rounded animate-pulse" />
          ) : (
            <p className="text-3xl font-bold text-gray-900">
              {value !== null ? value.toLocaleString('ja-JP') : '-'}
            </p>
          )}
        </div>
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0"
          style={{ backgroundColor: accentColor }}
        >
          {icon}
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-3 group-hover:text-pink-600 transition-colors">
        詳細を見る →
      </p>
    </Link>
  )
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    followerCount: null,
    dmCountToday: null,
    activeCommentRulesCount: null,
    activeScenariosCount: null,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [followerCountRes, commentRulesRes, scenariosRes] = await Promise.allSettled([
          api.followers.count(),
          api.commentRules.list(),
          api.scenarios.list(),
        ])

        setStats({
          followerCount:
            followerCountRes.status === 'fulfilled' && followerCountRes.value.success
              ? (followerCountRes.value.data as { count: number }).count
              : null,
          dmCountToday: null, // Not yet available in API
          activeCommentRulesCount:
            commentRulesRes.status === 'fulfilled' && commentRulesRes.value.success
              ? (commentRulesRes.value.data as { isActive: boolean }[]).filter((r) => r.isActive).length
              : null,
          activeScenariosCount:
            scenariosRes.status === 'fulfilled' && scenariosRes.value.success
              ? (scenariosRes.value.data as { isActive: boolean }[]).filter((s) => s.isActive).length
              : null,
        })
      } catch {
        setError('データの読み込みに失敗しました')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">ダッシュボード</h1>
        <p className="text-sm text-gray-500 mt-1">IG Harness 管理画面</p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="フォロワー数"
          value={stats.followerCount}
          loading={loading}
          href="/followers"
          accentColor="#E1306C"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
        />
        <StatCard
          title="今日のDM数"
          value={stats.dmCountToday}
          loading={loading}
          href="/followers"
          accentColor="#833AB4"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          }
        />
        <StatCard
          title="アクティブルール数"
          value={stats.activeCommentRulesCount}
          loading={loading}
          href="/comment-rules"
          accentColor="#F77737"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
          }
        />
        <StatCard
          title="アクティブシナリオ数"
          value={stats.activeScenariosCount}
          loading={loading}
          href="/scenarios"
          accentColor="#3B82F6"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          }
        />
      </div>

      {/* Quick links */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">クイックアクション</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            href="/followers"
            className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-pink-300 hover:bg-pink-50 transition-colors group"
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0" style={{ backgroundColor: '#E1306C' }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 group-hover:text-pink-700 transition-colors">フォロワー管理</p>
              <p className="text-xs text-gray-400">フォロワー一覧・タグ管理</p>
            </div>
          </Link>

          <Link
            href="/comment-rules"
            className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-orange-300 hover:bg-orange-50 transition-colors group"
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0" style={{ backgroundColor: '#F77737' }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 group-hover:text-orange-700 transition-colors">コメントルール</p>
              <p className="text-xs text-gray-400">コメント自動返信ルールの管理</p>
            </div>
          </Link>

          <Link
            href="/scenarios"
            className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors group"
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 bg-blue-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 group-hover:text-blue-700 transition-colors">シナリオ</p>
              <p className="text-xs text-gray-400">DM自動配信シナリオの管理</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  )
}
