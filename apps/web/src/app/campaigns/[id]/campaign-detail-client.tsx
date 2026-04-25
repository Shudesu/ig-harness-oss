'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  engagementGatesApi,
  lineConnectionsApi,
  richMessagesApi,
  postsApi,
  type EngagementGate,
  type LineConnection,
  type RichMessage,
  type RichMessageBlock,
  type MediaItem,
} from '@/lib/api'
import Header from '@/components/layout/header'
import RichMessagePreview from '@/components/rich-message-preview'

/**
 * Next.js static export bakes the generateStaticParams value ('_') into
 * the client bundle's route context, so useParams() returns '_' even
 * when the browser URL is /campaigns/<real-uuid>/ served via CF Pages
 * _redirects rewrite. Read from window.location instead.
 */
function resolveIdFromPath(): string | null {
  if (typeof window === 'undefined') return null
  const match = window.location.pathname.match(/\/campaigns\/([^/]+)\/?$/)
  if (!match) return null
  const id = decodeURIComponent(match[1])
  if (!id || id === '_') return null
  return id
}

const ACCENT = '#E1306C'

const TRIGGER_LABELS: Record<string, { emoji: string; label: string }> = {
  comment_on_post: { emoji: '🎥', label: 'リールコメント' },
  dm_keyword: { emoji: '💬', label: 'DMキーワード' },
  story_mention: { emoji: '📖', label: 'ストーリーメンション' },
}

const STATUS_LABELS: Record<string, string> = {
  active: '稼働中',
  paused: '一時停止',
  archived: 'アーカイブ',
}

export default function CampaignDetailClient() {
  const router = useRouter()
  const [id, setId] = useState<string | null>(null)

  const [gate, setGate] = useState<EngagementGate | null>(null)
  const [richMessageMap, setRichMessageMap] = useState<Record<string, RichMessage>>({})
  const [targetMediaMap, setTargetMediaMap] = useState<Record<string, MediaItem>>({})
  /** LINE Harness connection registry used to resolve `line_connection_id`
   *  into a human-readable name in the cross-link badge. Fails silently —
   *  the id is displayed as-is if the fetch errors. */
  const [lineConnections, setLineConnections] = useState<LineConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setId(resolveIdFromPath())
  }, [])

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError('')
    try {
      const data = await engagementGatesApi.get(id)
      setGate(data)

      const ids = [
        data.initial_dm_rich_message_id,
        data.reward_dm_rich_message_id,
        data.follow_reminder_dm_rich_message_id,
      ].filter((x): x is string => !!x)
      if (ids.length > 0) {
        const results = await Promise.all(ids.map((x) => richMessagesApi.get(x)))
        const map: Record<string, RichMessage> = {}
        for (const r of results) if (r) map[r.id] = r
        setRichMessageMap(map)
      }

      // Best-effort target media lookup so we can show thumbnails + captions
      // instead of raw IG media ids. Safe to skip on failure.
      const targetIds = data.target_post_ids ?? (data.target_post_id ? [data.target_post_id] : [])
      if (targetIds.length > 0) {
        try {
          const all = await postsApi.listMyMedia({ limit: 100 })
          const map: Record<string, MediaItem> = {}
          for (const pid of targetIds) {
            const found = all.find((m) => m.id === pid)
            if (found) map[pid] = found
          }
          setTargetMediaMap(map)
        } catch {
          // ignore
        }
      } else {
        setTargetMediaMap({})
      }
    } catch {
      setError('キャンペーンの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  // Load the LINE connection registry once per visit so the cross-link
  // badge can show the connection's friendly name. Non-critical — the
  // badge falls back to the raw id when this fetch fails.
  useEffect(() => {
    let cancelled = false
    lineConnectionsApi
      .list()
      .then((rows) => {
        if (!cancelled) setLineConnections(rows)
      })
      .catch(() => {
        /* non-fatal */
      })
    return () => {
      cancelled = true
    }
  }, [])

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
        <Header title="読み込み中..." />
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
        <Header title="見つかりません" />
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
    clicks_total: 0,
    clicks_unique: 0,
  }

  const trigger = TRIGGER_LABELS[gate.trigger_type] ?? { emoji: '⚡', label: gate.trigger_type }
  const statusBadgeClass =
    gate.status === 'active'
      ? 'bg-green-100 text-green-700'
      : gate.status === 'paused'
        ? 'bg-yellow-100 text-yellow-700'
        : 'bg-gray-100 text-gray-500'

  // Helper to get a slot's DM preview. Falls back to empty if the rich
  // message hasn't loaded or the slot isn't configured.
  const slotBlocks = (rmId: string | null | undefined): RichMessageBlock[] => {
    if (!rmId) return []
    return richMessageMap[rmId]?.blocks ?? []
  }

  const ctaBlocks = slotBlocks(gate.initial_dm_rich_message_id)
  const reminderBlocks = gate.require_follow ? slotBlocks(gate.follow_reminder_dm_rich_message_id) : []
  const rewardBlocks = slotBlocks(gate.reward_dm_rich_message_id)

  return (
    <div>
      <Header
        title={gate.name}
        action={
          <div className="flex items-center gap-2">
            <Link
              href="/campaigns"
              className="px-3 py-2 min-h-[40px] text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              ← 一覧
            </Link>
            <Link
              href={`/campaigns/${gate.id}/edit`}
              className="px-4 py-2 min-h-[40px] text-sm font-medium text-gray-700 border border-gray-300 hover:bg-gray-50 rounded-lg"
            >
              編集
            </Link>
            <button
              onClick={handleToggleStatus}
              disabled={busy}
              className="px-4 py-2 min-h-[40px] text-sm font-medium text-white rounded-lg disabled:opacity-50"
              style={{ backgroundColor: ACCENT }}
            >
              {gate.status === 'active' ? '一時停止' : '再開'}
            </button>
            <button
              onClick={handleDelete}
              disabled={busy}
              className="px-3 py-2 min-h-[40px] text-sm font-medium text-red-600 border border-red-300 hover:bg-red-50 rounded-lg disabled:opacity-50"
            >
              削除
            </button>
          </div>
        }
      />

      {/* Status badge */}
      <div className="mb-6 flex items-center gap-2">
        <span
          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${statusBadgeClass}`}
        >
          {gate.status === 'active' && <span className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1.5 animate-pulse" />}
          {STATUS_LABELS[gate.status] ?? gate.status}
        </span>
        <span className="text-xs text-gray-400">
          {trigger.emoji} {trigger.label}
        </span>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Funnel stats */}
      <section className="mb-8 bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">📊 配信フロー</h2>
        <Funnel
          steps={[
            { label: '反応', sub: 'コメント / DM / メンション', value: a.triggered, emoji: '👋' },
            { label: 'DM配信', sub: '自動送信成功', value: a.cta_sent, emoji: '📨' },
            { label: 'ボタン押下', sub: 'フォロー確認待ち', value: a.pending_follow + a.delivered + a.dropped, emoji: '👆' },
            { label: '特典配信', sub: 'フォロー済で受取', value: a.delivered, emoji: '🎁' },
            { label: 'URLタップ', sub: `ユニーク ${a.clicks_unique ?? 0} 人`, value: a.clicks_total ?? 0, emoji: '🔗' },
            { label: 'LINE追加', sub: '連携まで完了', value: a.line_linked, emoji: '🟢' },
          ]}
        />
        {a.dropped > 0 && (
          <div className="mt-4 text-xs text-gray-500">
            ※ フォロー確認で諦めた人: <span className="font-medium text-gray-700">{a.dropped}</span> 名
          </div>
        )}
      </section>

      {/* Configuration (simplified) */}
      <section className="mb-8 bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">⚙️ 設定</h2>

        <div>
          <div className="text-xs font-medium text-gray-500 mb-1.5">何に反応</div>
          <div className="text-sm text-gray-800">
            {trigger.emoji} {trigger.label}
            {gate.trigger_keyword && (
              <span className="ml-2 inline-flex px-2 py-0.5 rounded bg-pink-50 text-[#E1306C] text-xs">
                キーワード: {gate.trigger_keyword}
              </span>
            )}
          </div>
        </div>

        {gate.trigger_type === 'comment_on_post' && (
          <div>
            {(() => {
              const targetIds = gate.target_post_ids ?? (gate.target_post_id ? [gate.target_post_id] : [])
              return (
                <>
                  <div className="text-xs font-medium text-gray-500 mb-1.5">
                    対象投稿 {targetIds.length > 0 && `(${targetIds.length} 件)`}
                  </div>
                  {targetIds.length === 0 ? (
                    <div>
                      <div className="text-sm text-gray-600">🌐 全投稿（デフォルトキャンペーン）</div>
                      <div className="text-[11px] text-gray-400 mt-1">
                        個別リール指定の別キャンペーンがある投稿はそちらが優先されます
                      </div>
                    </div>
                  ) : (
                    <TargetPostsList ids={targetIds} mediaMap={targetMediaMap} />
                  )}
                </>
              )
            })()}
          </div>
        )}

        <div>
          <div className="text-xs font-medium text-gray-500 mb-1.5">フォロー確認</div>
          <div className="text-sm text-gray-800">
            {gate.require_follow ? '✅ ON — フォロー済みの人だけに特典' : '— OFF — ボタン押下で即特典'}
          </div>
        </div>

        {gate.reward_url && (
          <div>
            <div className="text-xs font-medium text-gray-500 mb-1.5">特典URL</div>
            <a
              href={gate.reward_url}
              target="_blank"
              rel="noreferrer"
              className="text-sm break-all hover:underline"
              style={{ color: ACCENT }}
            >
              {gate.reward_url}
            </a>
            <LineCrossLinkBadge gate={gate} connections={lineConnections} />
          </div>
        )}

        {gate.trigger_type === 'comment_on_post' && gate.comment_reply_text && (
          <div>
            <div className="text-xs font-medium text-gray-500 mb-1.5">
              コメント公開返信
              {parseReplyPatterns(gate.comment_reply_text).length > 1 &&
                `（${parseReplyPatterns(gate.comment_reply_text).length}パターンからランダム）`}
            </div>
            <ul className="space-y-1">
              {parseReplyPatterns(gate.comment_reply_text).map((p, i) => (
                <li key={i} className="text-sm text-gray-800 bg-gray-50 border border-gray-100 rounded px-3 py-2 whitespace-pre-wrap">
                  {p}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* DM flow */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">💬 配信されるDMの流れ</h2>
        <div className="space-y-0">
          <FlowStep
            kind="trigger"
            label={
              gate.trigger_type === 'comment_on_post'
                ? 'ユーザーがリールにコメント'
                : gate.trigger_type === 'dm_keyword'
                  ? `ユーザーが DM を送信（${gate.trigger_keyword ? `キーワード「${gate.trigger_keyword}」を含む` : '任意の内容'}）`
                  : 'ユーザーが自分のストーリーをメンション'
            }
          />
          <FlowArrow text="自動で DM 配信" />
          <DmFlowCard
            step="1"
            label="最初のDM"
            blocks={ctaBlocks}
            extraNote={
              gate.require_follow
                ? 'ユーザーが「受け取る」を押すと → フォロー確認へ'
                : 'ユーザーが「受け取る」を押すと → 特典DMへ直行'
            }
          />
          {!!gate.require_follow && (
            <>
              <FlowArrow text="フォロー済みか IG に問い合わせ" />
              <FlowStep
                kind="decision"
                label="フォロー判定"
                sub="フォロー済み → 特典DM / 未達 → 下のリマインダー"
              />
              <FlowArrow text="未達の場合" />
              <DmFlowCard
                step="2a"
                label="フォローしてない人に送るDM"
                blocks={reminderBlocks}
                extraNote={'ユーザーがフォロー後「フォローしたよ」→ もう一度フォロー判定へ'}
              />
              <FlowArrow text="フォロー済みの場合" />
            </>
          )}
          <DmFlowCard
            step={gate.require_follow ? '2b' : '2'}
            label="特典DM"
            blocks={rewardBlocks}
            extraNote={
              gate.reward_url
                ? `ユーザーが「詳細を見る」を押すと → ${gate.reward_url}`
                : 'URL 未設定'
            }
          />
          {parseFollowupsForDetail(gate.followup_dm_sequence).map((step, idx) => (
            <div key={`fup-${idx}`}>
              <FlowArrow text={`${step.delay_minutes} 分後`} />
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{ backgroundColor: ACCENT }}
                  >
                    ⏰
                  </div>
                  <div className="text-sm font-semibold text-gray-800">
                    フォローアップ #{idx + 1}
                  </div>
                </div>
                <div className="p-4 text-sm text-gray-800 whitespace-pre-wrap">{step.text}</div>
                {step.button_label && step.button_url && (
                  <div className="border-t border-gray-100 px-4 py-2 text-center text-sm font-medium" style={{ color: '#0095F6' }}>
                    {step.button_label}
                  </div>
                )}
              </div>
            </div>
          ))}
          <FlowArrow text="外部リンクへ遷移" />
          <FlowStep kind="end" label="完了" sub="ユーザーは LP へ到達" />
        </div>
      </section>
    </div>
  )
}

/**
 * 46 thumbnails dump into the detail page made the whole setup section
 * unreadable. Collapsed by default: show a compact thumbnail strip (max
 * ~8 tiles) and let the operator click to expand the full list.
 */
function TargetPostsList({
  ids,
  mediaMap,
}: {
  ids: string[]
  mediaMap: Record<string, MediaItem>
}) {
  const [expanded, setExpanded] = useState(false)
  const preview = ids.slice(0, 8)

  if (expanded) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-[11px] text-gray-500 hover:text-gray-700"
        >
          ▲ 閉じる
        </button>
        {ids.map((pid) => {
          const m = mediaMap[pid]
          return m ? (
            <a
              key={pid}
              href={m.permalink}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 border border-gray-200 rounded-lg p-2 bg-gray-50 hover:bg-gray-100"
            >
              <div className="w-12 h-12 bg-gray-200 rounded overflow-hidden shrink-0">
                {(m.thumbnail_url || m.media_url) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.thumbnail_url || m.media_url} alt="" className="w-full h-full object-cover" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-gray-700 line-clamp-1">
                  {m.caption?.slice(0, 60) ?? '(キャプションなし)'}
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">{m.timestamp.slice(0, 10)}</div>
              </div>
              <span className="text-xs text-gray-400 shrink-0">↗</span>
            </a>
          ) : (
            <div key={pid} className="text-xs text-gray-500 font-mono">投稿 #{pid.slice(-8)}</div>
          )
        })}
      </div>
    )
  }

  return (
    <div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {preview.map((pid) => {
          const m = mediaMap[pid]
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
              <div className="w-12 h-12 rounded overflow-hidden bg-gray-200 border border-gray-300 group-hover:border-[#E1306C]">
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
        {ids.length > preview.length && (
          <div className="shrink-0 w-12 h-12 rounded border border-dashed border-gray-300 flex items-center justify-center text-[10px] font-medium text-gray-500 bg-white">
            +{ids.length - preview.length}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mt-2 text-[11px] text-gray-500 hover:text-gray-700"
      >
        ▼ 全 {ids.length} 件をリスト表示
      </button>
    </div>
  )
}

interface FollowupStepLite {
  delay_minutes: number
  text: string
  button_label?: string
  button_url?: string
}

/** Decode followup_dm_sequence JSON for the detail view. Returns [] on any error. */
function parseFollowupsForDetail(raw: string | null | undefined): FollowupStepLite[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (x): x is FollowupStepLite =>
          !!x && typeof x === 'object' && typeof x.text === 'string' && typeof x.delay_minutes === 'number',
      )
      .map((x) => ({
        delay_minutes: x.delay_minutes,
        text: x.text,
        button_label: x.button_label,
        button_url: x.button_url,
      }))
  } catch {
    return []
  }
}

/** Decode comment_reply_text: plain string → single entry; JSON array → all entries. */
function parseReplyPatterns(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      }
    } catch {
      /* fall through */
    }
  }
  return [trimmed]
}

function Funnel({ steps }: { steps: Array<{ label: string; sub: string; value: number; emoji: string }> }) {
  const max = Math.max(...steps.map((s) => s.value), 1)
  const first = steps[0]?.value || 0
  return (
    <div className="space-y-2">
      {steps.map((s, idx) => {
        const widthPct = Math.max((s.value / max) * 100, 5)
        const rate = idx === 0 || first === 0 ? null : ((s.value / first) * 100).toFixed(0)
        return (
          <div key={s.label} className="flex items-center gap-3">
            <div className="w-28 shrink-0">
              <div className="text-xs font-medium text-gray-800">
                <span className="mr-1">{s.emoji}</span>{s.label}
              </div>
              <div className="text-[10px] text-gray-400 leading-tight">{s.sub}</div>
            </div>
            <div className="flex-1 relative h-8 bg-gray-50 rounded-lg overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-lg transition-all"
                style={{
                  width: `${widthPct}%`,
                  background: `linear-gradient(90deg, rgba(225,48,108,${0.9 - idx * 0.12}) 0%, rgba(225,48,108,${0.7 - idx * 0.12}) 100%)`,
                }}
              />
              <div className="absolute inset-0 flex items-center justify-between px-3">
                <span className="text-sm font-semibold text-white drop-shadow">{s.value}</span>
                {rate !== null && (
                  <span className="text-[10px] font-medium text-white/90">{rate}%</span>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DmFlowCard({
  step,
  label,
  blocks,
  extraNote,
}: {
  step: string
  label: string
  blocks: RichMessageBlock[]
  extraNote?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
          style={{ backgroundColor: ACCENT }}
        >
          {step}
        </div>
        <div className="text-sm font-semibold text-gray-800">{label}</div>
      </div>
      <div className="p-4">
        {blocks.length > 0 ? (
          <RichMessagePreview blocks={blocks} />
        ) : (
          <div className="text-xs text-gray-400 text-center py-6">
            （DM未設定 — フォーム保存に失敗した可能性があります）
          </div>
        )}
      </div>
      {extraNote && (
        <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 text-[11px] text-gray-500">
          {extraNote}
        </div>
      )}
    </div>
  )
}

function FlowStep({
  kind,
  label,
  sub,
}: {
  kind: 'trigger' | 'decision' | 'end'
  label: string
  sub?: string
}) {
  const emoji = kind === 'trigger' ? '👋' : kind === 'decision' ? '🔍' : '🎯'
  const bg = kind === 'end' ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
  return (
    <div className={`border rounded-xl px-4 py-3 flex items-start gap-3 ${bg}`}>
      <div className="text-xl shrink-0 leading-none mt-0.5">{emoji}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-800">{label}</div>
        {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

function FlowArrow({ text }: { text?: string }) {
  return (
    <div className="flex items-center justify-center py-2 gap-2">
      <div className="w-px h-4 bg-gray-300" />
      {text && <span className="text-[10px] text-gray-400">{text}</span>}
      <div className="w-px h-4 bg-gray-300" />
    </div>
  )
}

/**
 * Cross-link status chip. Shows whether the gate is wired up to rewrite
 * outbound reward URLs through a LINE Harness tracked link, and — once
 * the first delivery has happened — the cached short id so operators can
 * cross-reference with LINE Harness's own link list.
 *
 * Three states, each with a single glanceable line:
 *   - no line_connection_id            → not configured (hidden)
 *   - connection set, short not yet    → 初回配信時に自動生成されます
 *   - connection + short cached        → tracked link: <short>（<pool>）
 *
 * Kept deliberately compact — the full cross-link analytics live in the
 * GateAnalytics `line_linked` counter at the top of the page.
 */
function LineCrossLinkBadge({
  gate,
  connections,
}: {
  gate: EngagementGate
  connections: LineConnection[]
}) {
  if (!gate.line_connection_id) return null
  const conn = connections.find((c) => c.id === gate.line_connection_id)
  const connLabel = conn ? conn.name : `${gate.line_connection_id.slice(0, 8)}…`
  const poolLabel = gate.line_pool_slug ? ` / pool=${gate.line_pool_slug}` : ''

  return (
    <div className="mt-2 inline-flex flex-wrap items-center gap-1.5 rounded-md border border-[#E1306C]/20 bg-pink-50/40 px-2.5 py-1.5 text-[11px] text-gray-700">
      <span className="font-semibold text-[#E1306C]">🔗 LINE連携</span>
      <span className="text-gray-500">→</span>
      <span className="font-medium">{connLabel}</span>
      {poolLabel && <span className="text-gray-500">{poolLabel}</span>}
      {gate.line_tracked_link_short ? (
        <>
          <span className="text-gray-300">•</span>
          <span className="text-gray-500">tracked link:</span>
          <code className="font-mono text-[10px] bg-white/80 border border-gray-200 rounded px-1.5 py-0.5">
            {gate.line_tracked_link_short}
          </code>
        </>
      ) : (
        <>
          <span className="text-gray-300">•</span>
          <span className="text-gray-400">初回配信時に自動生成</span>
        </>
      )}
    </div>
  )
}
