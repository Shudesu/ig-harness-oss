'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { engagementGatesApi, type EngagementGate } from '@/lib/api'
import Header from '@/components/layout/header'

const ACCENT = '#F77737'

const TRIGGER_LABELS: Record<string, string> = {
  comment_on_post: '投稿へのコメント',
  dm_keyword: 'DM キーワード',
  story_mention: 'ストーリー メンション',
}

const STATUS_LABELS: Record<string, string> = {
  active: '稼働中',
  paused: '一時停止',
  archived: 'アーカイブ',
}

export default function CampaignDetailClient() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params?.id

  const [gate, setGate] = useState<EngagementGate | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError('')
    try {
      const data = await engagementGatesApi.get(id)
      setGate(data)
    } catch {
      setError('キャンペーンの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const handleToggleStatus = async () => {
    if (!gate) return
    const next = gate.status === 'active' ? 'paused' : 'active'
    setBusy(true)
    setError('')
    try {
      await engagementGatesApi.update(gate.id, { status: next })
      await load()
    } catch {
      setError('ステータスの変更に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!gate) return
    if (!confirm('このキャンペーンを削除しますか？この操作は取り消せません。')) return
    setBusy(true)
    setError('')
    try {
      await engagementGatesApi.delete(gate.id)
      router.push('/campaigns')
    } catch {
      setError('削除に失敗しました')
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div>
        <Header title="キャンペーン詳細" description="読み込み中..." />
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse space-y-3">
              <div className="h-4 bg-gray-200 rounded w-1/3" />
              <div className="h-3 bg-gray-100 rounded w-2/3" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!gate) {
    return (
      <div>
        <Header title="キャンペーン詳細" description="見つかりません" />
        <div className="bg-white rounded-lg border border-gray-200 p-6 text-sm text-gray-600">
          {error || 'キャンペーンが見つかりません。'}
          <div className="mt-4">
            <Link href="/campaigns" className="text-sm font-medium" style={{ color: ACCENT }}>
              ← キャンペーン一覧に戻る
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const a = gate.analytics ?? {
    triggered: 0,
    cta_sent: 0,
    pending_follow: 0,
    delivered: 0,
    dropped: 0,
    follow_rate: 0,
    line_linked: 0,
  }

  const statusBadgeClass =
    gate.status === 'active'
      ? 'bg-green-100 text-green-700'
      : gate.status === 'paused'
        ? 'bg-yellow-100 text-yellow-700'
        : 'bg-gray-100 text-gray-500'

  return (
    <div>
      <Header
        title={gate.name}
        description={`${TRIGGER_LABELS[gate.trigger_type] ?? gate.trigger_type}${gate.trigger_keyword ? ` · キーワード: ${gate.trigger_keyword}` : ''}`}
        action={
          <div className="flex items-center gap-2">
            <Link
              href="/campaigns"
              className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              一覧に戻る
            </Link>
            <button
              onClick={handleToggleStatus}
              disabled={busy}
              className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
              style={{ backgroundColor: ACCENT }}
            >
              {gate.status === 'active' ? '一時停止' : '再開'}
            </button>
            <button
              onClick={handleDelete}
              disabled={busy}
              className="px-4 py-2 min-h-[44px] text-sm font-medium text-red-600 border border-red-300 hover:bg-red-50 rounded-lg disabled:opacity-50 transition-colors"
            >
              削除
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Status row */}
      <div className="mb-6 flex items-center gap-3 text-sm">
        <span
          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${statusBadgeClass}`}
        >
          {STATUS_LABELS[gate.status] ?? gate.status}
        </span>
        <span className="text-gray-500">ID: <span className="font-mono text-gray-700">{gate.id}</span></span>
      </div>

      {/* Analytics */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">分析</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="トリガー発動" value={a.triggered} />
          <Stat label="CTA 送信" value={a.cta_sent} />
          <Stat label="フォロー待ち" value={a.pending_follow} />
          <Stat label="特典配信" value={a.delivered} />
          <Stat label="ドロップ" value={a.dropped} />
          <Stat label="フォロー率" value={`${(Number(a.follow_rate ?? 0) * 100).toFixed(1)}%`} />
          <Stat label="LINE 連携成功" value={a.line_linked} />
        </div>
      </section>

      {/* Configuration */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">設定</h2>
        <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4 text-sm">
          <Field label="トリガー種別" value={TRIGGER_LABELS[gate.trigger_type] ?? gate.trigger_type} />
          {gate.trigger_keyword && <Field label="キーワード" value={gate.trigger_keyword} />}
          {gate.target_post_id && <Field label="対象投稿ID" value={gate.target_post_id} mono />}
          <Field label="フォロー必須" value={gate.require_follow ? '必須' : '任意'} />
          <Field label="最大ループ回数" value={String(gate.max_loops)} />
          <MultilineField label="CTA DM 本文" value={gate.initial_dm_text} />
          <Field label="CTA ボタン" value={gate.initial_dm_button_label} />
          <MultilineField label="フォロー未達 DM 本文" value={gate.follow_reminder_dm_text} />
          <Field label="フォロー未達ボタン" value={gate.follow_reminder_button_label} />
          <MultilineField label="特典 DM 本文" value={gate.reward_dm_text} />
          {gate.reward_url && (
            <div>
              <div className="text-xs font-medium text-gray-500 mb-1">特典 URL</div>
              <a
                href={gate.reward_url}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium break-all"
                style={{ color: ACCENT }}
              >
                {gate.reward_url}
              </a>
            </div>
          )}
        </div>
      </section>

    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-bold text-gray-900 mt-1">{value}</div>
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-500 mb-1">{label}</div>
      <div className={`text-sm text-gray-800 ${mono ? 'font-mono break-all' : ''}`}>{value}</div>
    </div>
  )
}

function MultilineField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-500 mb-1">{label}</div>
      <div className="text-sm text-gray-800 whitespace-pre-wrap bg-gray-50 rounded p-3 border border-gray-100">
        {value}
      </div>
    </div>
  )
}
