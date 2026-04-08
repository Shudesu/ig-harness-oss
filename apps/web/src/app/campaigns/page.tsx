'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { engagementGatesApi, type EngagementGate } from '@/lib/api'
import Header from '@/components/layout/header'

const ACCENT = '#E1306C'

const TRIGGER_LABELS: Record<EngagementGate['trigger_type'], string> = {
  comment_on_post: '投稿コメント',
  dm_keyword: 'DMキーワード',
  story_mention: 'ストーリーメンション',
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadGates = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await engagementGatesApi.list()
      setGates(data)
    } catch {
      setError('キャンペーンの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadGates()
  }, [loadGates])

  return (
    <div>
      <Header
        title="キャンペーン"
        description="Instagram エンゲージメントゲート（コメント返信→DM→フォロー報酬）を管理"
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

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse space-y-3"
            >
              <div className="h-4 bg-gray-200 rounded w-1/2" />
              <div className="h-3 bg-gray-100 rounded w-3/4" />
            </div>
          ))}
        </div>
      ) : gates.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <svg
            className="w-12 h-12 text-gray-300 mx-auto mb-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
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
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  名前
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  トリガー
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  ステータス
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  アクション
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {gates.map((g) => (
                <tr key={g.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      href={`/campaigns/${g.id}`}
                      className="text-sm font-medium text-gray-900 hover:opacity-80"
                      style={{ color: ACCENT }}
                    >
                      {g.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {TRIGGER_LABELS[g.trigger_type] ?? g.trigger_type}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASSES[g.status] ?? 'bg-gray-100 text-gray-500'}`}
                    >
                      {STATUS_LABELS[g.status] ?? g.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/campaigns/${g.id}`}
                      className="text-sm font-medium hover:opacity-80"
                      style={{ color: ACCENT }}
                    >
                      編集
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
