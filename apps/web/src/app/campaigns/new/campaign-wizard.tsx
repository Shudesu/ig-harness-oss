'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  engagementGatesApi,
  lineConnectionsApi,
  postsApi,
  richMessagesApi,
  type EngagementGate,
  type LineConnection,
  type LineHarnessPool,
  type MediaItem,
  type PostCoverage,
  type RichMessage,
  type RichMessageBlock,
  type RichMessageButton,
  type RichMessageKind,
} from '@/lib/api'
import Header from '@/components/layout/header'
import ImagePickerModal from '@/components/image-picker-modal'
import MediaPickerModal from '@/components/media-picker-modal'
import RichMessagePreview from '@/components/rich-message-preview'

const ACCENT = '#E1306C'

/**
 * Single-page campaign wizard. Combines what used to be 3 separate steps
 * (create 3 rich_messages, then create an engagement_gate) into one form.
 * Operators don't see the terms CTA/reward/reminder, rich_message, gate,
 * or postback/payload — we synthesize those behind the scenes on save.
 */

/** Source mode for each DM slot: either the operator is filling out a
 * brand-new message with the wizard fields, or they want to re-use a
 * rich message that was authored beforehand (via /rich-messages or MCP). */
type SlotMode = 'new' | 'existing'

type TriggerType = 'comment_on_post' | 'dm_keyword' | 'story_mention'

interface FollowupStepInput {
  delay_minutes: number
  text: string
  image_url?: string
  button_label?: string
  button_url?: string
}

const TRIGGER_OPTIONS: Array<{ v: TriggerType; emoji: string; label: string; help: string }> = [
  {
    v: 'comment_on_post',
    emoji: '🎥',
    label: 'リールコメント',
    help: '指定のリール・投稿にコメントが付いたら発動',
  },
  {
    v: 'dm_keyword',
    emoji: '💬',
    label: 'DMキーワード',
    help: '指定キーワードを含むDMを受け取ったら発動',
  },
  {
    v: 'story_mention',
    emoji: '📖',
    label: 'ストーリーメンション',
    help: '自分のストーリーがメンション・シェアされたら発動',
  },
]

interface WizardState {
  /** Human-readable campaign name */
  name: string
  /** What fires the campaign */
  triggerType: TriggerType
  /** Target IG media ids (N posts). Empty = apply to all posts. */
  targetMediaIds: string[]
  /** Preview info per picked id (for thumbnail + caption display). */
  targetMediaPreviews: Record<string, MediaItem>
  /**
   * Keyword:
   *   - comment_on_post: optional (blank = any_comment)
   *   - dm_keyword: required
   *   - story_mention: unused
   */
  keyword: string
  /** First DM sent when a qualifying comment lands */
  ctaMode: SlotMode
  ctaExistingId: string
  ctaImageUrl: string
  ctaText: string
  ctaButtonLabel: string
  /** Whether to require follow before delivering the reward */
  requireFollow: boolean
  /** DM sent when user clicks CTA and is verified as a follower */
  rewardMode: SlotMode
  rewardExistingId: string
  rewardImageUrl: string
  rewardText: string
  rewardButtonLabel: string
  rewardUrl: string
  /** LINE Harness cross-link binding. Empty connection id = no cross-link
   *  (reward_url sent as-is). When set, the worker lazily creates one
   *  tracked link per gate and appends `?ig=<IGSID>` per recipient so
   *  the first click back to LINE captures the IG↔LINE userId pair. */
  lineConnectionId: string
  linePoolSlug: string
  /** 1-3 candidate public comment replies. On each gate firing the
   *  webhook picks one at random so replies don't look robotic.
   *  Supports {{username}} placeholder. All blank = no public reply. */
  commentReplyTexts: string[]
  /** Up to 3 follow-up DMs sent after the reward inside the 24h window. */
  followupSteps: FollowupStepInput[]
  /** DM sent when user clicks CTA but isn't following yet */
  reminderMode: SlotMode
  reminderExistingId: string
  reminderText: string
  reminderButtonLabel: string
}

const DEFAULTS: WizardState = {
  name: '',
  triggerType: 'comment_on_post',
  targetMediaIds: [],
  targetMediaPreviews: {},
  keyword: '',
  ctaMode: 'new',
  ctaExistingId: '',
  ctaImageUrl: '',
  ctaText: 'コメントありがとう！🎁\n下のボタンから特典を受け取ってね',
  ctaButtonLabel: '特典を受け取る',
  requireFollow: true,
  rewardMode: 'new',
  rewardExistingId: '',
  rewardImageUrl: '',
  rewardText: 'フォローありがとうございます！🎉\n特典はこちらのリンクから👇',
  rewardButtonLabel: 'LINEで受け取る',
  rewardUrl: '',
  lineConnectionId: '',
  linePoolSlug: '',
  commentReplyTexts: [
    '@{{username}} DM送ったよ📩 届いてなかったら「リクエスト」フォルダ見てね',
    '@{{username}} ありがとう🎁 DMチェックしてね',
    '@{{username}} 受け取れるようDM送ったよ✨',
  ],
  followupSteps: [],
  reminderMode: 'new',
  reminderExistingId: '',
  reminderText: 'まずは @ をフォローしてから、もう一度このボタンを押してね',
  reminderButtonLabel: 'フォローしたよ',
}

interface CampaignWizardProps {
  /**
   * When set, the wizard loads in edit mode: state is pre-filled from the
   * existing gate and save issues a PATCH instead of POST. On success the
   * user is routed back to /campaigns/:id.
   */
  existingGate?: EngagementGate
}

export default function CampaignWizard({ existingGate }: CampaignWizardProps = {}) {
  const router = useRouter()
  const isEdit = !!existingGate
  const [s, setS] = useState<WizardState>(DEFAULTS)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false)
  const [imagePickerTarget, setImagePickerTarget] = useState<((url: string) => void) | null>(null)
  const [existingMessages, setExistingMessages] = useState<RichMessage[]>([])
  const [coverage, setCoverage] = useState<PostCoverage>({})
  /** LINE Harness connection registry — loaded once on mount. Empty means
   *  the operator hasn't configured LINE Harness in /settings yet. */
  const [lineConnections, setLineConnections] = useState<LineConnection[]>([])
  /** Pools for the currently selected connection. Empty = no LINE-side
   *  traffic pools (or legacy LINE Harness without the pools feature). */
  const [linePools, setLinePools] = useState<LineHarnessPool[]>([])

  // Load the existing rich-message library once so each slot's dropdown
  // can filter by kind. Cheap (≤200 rows) and only when the wizard mounts.
  useEffect(() => {
    let cancelled = false
    richMessagesApi
      .list()
      .then((r) => {
        if (!cancelled) setExistingMessages(r)
      })
      .catch(() => {
        // Silently skip — operator can still author new messages.
      })
    // LINE Harness connections — shown as "接続先" dropdown in the reward
    // URL block. We preselect the default connection in create mode so the
    // operator doesn't have to touch it for single-account setups.
    lineConnectionsApi
      .list()
      .then((rows) => {
        if (cancelled) return
        setLineConnections(rows)
        if (!existingGate && rows.length > 0) {
          const preferred = rows.find((x) => x.is_default) ?? rows[0]!
          setS((x) => (x.lineConnectionId ? x : { ...x, lineConnectionId: preferred.id }))
        }
      })
      .catch(() => {
        /* non-fatal: operator can still save a gate without LINE cross-link */
      })
    engagementGatesApi
      .postCoverage()
      .then((c) => {
        if (cancelled) return
        // In edit mode, strip the current gate from every post's coverage
        // list so its own attached reels don't show "他に N件適用中" when
        // they're really just this campaign referencing itself.
        if (existingGate) {
          const scrubbed: PostCoverage = {}
          for (const [postId, entries] of Object.entries(c)) {
            const filtered = entries.filter((e) => e.gate_id !== existingGate.id)
            if (filtered.length > 0) scrubbed[postId] = filtered
          }
          setCoverage(scrubbed)
        } else {
          setCoverage(c)
        }
      })
      .catch(() => {
        // Silently skip — badges are a UX helper, not a hard requirement.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const messagesByKind = useCallback(
    (kind: RichMessageKind) => existingMessages.filter((m) => m.kind === kind),
    [existingMessages],
  )

  // Reload pools whenever the selected connection changes. The pool slug
  // itself is cleared synchronously in `handleConnectionChange` below so
  // an operator who saves between a connection switch and this effect's
  // async resolve can't persist a stale slug scoped to the old connection.
  useEffect(() => {
    if (!s.lineConnectionId) {
      setLinePools([])
      return
    }
    let cancelled = false
    lineConnectionsApi
      .listTrafficPools(s.lineConnectionId)
      .then((pools) => {
        if (!cancelled) setLinePools(pools)
      })
      .catch(() => {
        if (!cancelled) setLinePools([])
      })
    return () => {
      cancelled = true
    }
  }, [s.lineConnectionId])

  /**
   * Atomically swap the selected LINE connection AND clear the pool slug.
   * Pools are scoped per connection — a value carried over from the old
   * connection would silently attribute future clicks to the wrong LINE
   * account. Using a single setS callback avoids the one-render window
   * where lineConnectionId is new but linePoolSlug still holds the
   * previous connection's slug.
   */
  const handleConnectionChange = useCallback((id: string) => {
    setS((x) =>
      x.lineConnectionId === id
        ? x
        : { ...x, lineConnectionId: id, linePoolSlug: '' },
    )
  }, [])

  const findMessage = (id: string) => existingMessages.find((m) => m.id === id)

  // First-mount setup: hydrate from existingGate in edit mode, else drop a
  // default campaign name so operators don't stare at a blank 名前 field.
  useEffect(() => {
    if (existingGate) {
      hydrateStateFromGate(existingGate, setS)
      return
    }
    const now = new Date()
    const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    setS((x) => ({ ...x, name: `リール自動返信 ${ymd} ${hm}` }))
  }, [existingGate])

  // Best-effort: pull IG media previews for the target posts so the edit
  // screen doesn't show bare ids. Read ids from existingGate directly —
  // state may not have flushed yet when this effect runs, and the gate
  // prop is stable for the lifetime of the edit session.
  useEffect(() => {
    if (!existingGate) return
    const ids =
      existingGate.target_post_ids ??
      (existingGate.target_post_id ? [existingGate.target_post_id] : [])
    if (ids.length === 0) return

    let cancelled = false
    postsApi
      .listMyMedia({ limit: 100 })
      .then((all) => {
        if (cancelled) return
        const previews: Record<string, MediaItem> = {}
        for (const pid of ids) {
          const found = all.find((m) => m.id === pid)
          if (found) previews[pid] = found
        }
        if (Object.keys(previews).length > 0) {
          setS((x) => ({ ...x, targetMediaPreviews: { ...x.targetMediaPreviews, ...previews } }))
        }
      })
      .catch(() => {
        /* non-fatal: chips fall back to id-only display */
      })
    return () => {
      cancelled = true
    }
  }, [existingGate])

  const update = <K extends keyof WizardState>(key: K, value: WizardState[K]) => {
    setS((x) => ({ ...x, [key]: value }))
  }

  const validate = (): string | null => {
    if (!s.name.trim()) return 'キャンペーン名を入力してください'

    if (s.triggerType === 'dm_keyword' && !s.keyword.trim()) {
      return 'DMキーワードを入力してください'
    }

    if (s.ctaMode === 'existing') {
      if (!s.ctaExistingId) return '最初のDMに使うメッセージを選択してください'
    } else {
      if (!s.ctaText.trim() && !s.ctaImageUrl) return '最初のDMには画像またはテキストが必要です'
      if (!s.ctaButtonLabel.trim()) return '「受け取る」ボタンのラベルを入力してください'
    }

    if (s.rewardMode === 'existing') {
      if (!s.rewardExistingId) return '特典DMに使うメッセージを選択してください'
    } else {
      if (!s.rewardText.trim() && !s.rewardImageUrl) return '特典DMには画像またはテキストが必要です'
      if (!s.rewardButtonLabel.trim()) return '特典DMのボタンラベルを入力してください'
    }

    // When a LINE Harness 接続先 is selected, the reward URL is auto-built
    // from the connection's worker_url at save time, so the operator
    // doesn't have to know any LINE add URL. Only require a manually-typed
    // URL when the operator opts out of cross-link.
    if (!s.lineConnectionId) {
      if (!s.rewardUrl.trim()) return '特典URLを入力してください（LINE追加リンク等）'
      if (!/^https:\/\//.test(s.rewardUrl.trim())) return '特典URLは https:// で始める必要があります'
    }

    if (s.requireFollow) {
      if (s.reminderMode === 'existing') {
        if (!s.reminderExistingId) return 'フォロー未達DMに使うメッセージを選択してください'
      } else {
        if (!s.reminderText.trim()) return 'フォロー未達DMのメッセージを入力してください'
        if (!s.reminderButtonLabel.trim()) return 'フォロー未達DMのボタンラベルを入力してください'
      }
    }
    return null
  }

  /**
   * Build the blocks array for a rich message slot.
   *
   * IG card blocks cap title at 80 chars and subtitle at 80 chars. For
   * copy longer than 160 chars we prepend a standalone text block so the
   * full message is delivered instead of silently truncating the tail.
   * The card still carries image + primary button.
   */
  function buildSlot(
    text: string,
    imageUrl: string | undefined,
    buttons: RichMessageButton[],
    fallbackTitle: string,
  ): RichMessageBlock[] {
    const blocks: RichMessageBlock[] = []
    const trimmed = text.trim()

    // Anything past the 160-char card capacity goes into a leading text
    // bubble so the reader sees the full message. 1000 is IG's text cap.
    if (trimmed.length > 160) {
      blocks.push({ type: 'text', text: trimmed.slice(0, 1000) })
      blocks.push({
        type: 'card',
        title: fallbackTitle,
        image_url: imageUrl,
        buttons,
      })
    } else {
      blocks.push({
        type: 'card',
        title: trimmed.slice(0, 80) || fallbackTitle,
        subtitle: trimmed.length > 80 ? trimmed.slice(80, 160) : undefined,
        image_url: imageUrl,
        buttons,
      })
    }
    return blocks
  }

  const buildCtaBlocks = (): RichMessageBlock[] =>
    buildSlot(
      s.ctaText,
      s.ctaImageUrl || undefined,
      [{ type: 'postback', label: s.ctaButtonLabel, payload: 'CHECK_FOLLOW:{GATE_ID}:{DELIVERY_ID}' }],
      'お知らせ',
    )

  const buildRewardBlocks = (): RichMessageBlock[] =>
    buildSlot(
      s.rewardText,
      s.rewardImageUrl || undefined,
      [{ type: 'url', label: s.rewardButtonLabel, url: '{REWARD_URL}' }],
      '特典',
    )

  const buildReminderBlocks = (): RichMessageBlock[] =>
    buildSlot(
      s.reminderText,
      s.ctaImageUrl || undefined,
      [{ type: 'postback', label: s.reminderButtonLabel, payload: 'CHECK_FOLLOW:{GATE_ID}:{DELIVERY_ID}' }],
      'フォローのお願い',
    )

  const handleSave = async () => {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setSaving(true)
    setError('')

    // For each slot: either re-use an existing rich message (no create)
    // or POST a new one. No rollback on partial failure — orphan rich
    // messages are safer than a half-committed broken gate.
    let ctaId: string
    let rewardId: string
    let reminderId: string | null = null

    try {
      if (s.ctaMode === 'existing') {
        ctaId = s.ctaExistingId
      } else {
        setProgress('最初のDMを保存中...')
        const cta = await richMessagesApi.create({
          name: `${s.name} / CTA`,
          kind: 'cta',
          blocks: buildCtaBlocks(),
        })
        ctaId = cta.id
      }

      if (s.rewardMode === 'existing') {
        rewardId = s.rewardExistingId
      } else {
        setProgress('特典DMを保存中...')
        const reward = await richMessagesApi.create({
          name: `${s.name} / 特典`,
          kind: 'reward',
          blocks: buildRewardBlocks(),
        })
        rewardId = reward.id
      }

      if (s.requireFollow) {
        if (s.reminderMode === 'existing') {
          reminderId = s.reminderExistingId
        } else {
          setProgress('フォロー未達DMを保存中...')
          const reminder = await richMessagesApi.create({
            name: `${s.name} / フォロー未達`,
            kind: 'reminder',
            blocks: buildReminderBlocks(),
          })
          reminderId = reminder.id
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'DMの保存に失敗しました')
      setProgress('')
      setSaving(false)
      return
    }

    // Gate create gets the non-null rich_message_ids above. Legacy
    // *_dm_text slots still need SOME value to pass backend validation
    // even when the rich_message_id is the primary carrier; send the
    // user-written copy so the fallback path is also usable if the
    // rich message is ever deleted in isolation.
    try {
      setProgress(isEdit ? 'キャンペーンを更新中...' : 'キャンペーンを保存中...')
      const payload = {
        name: s.name,
        trigger_type: s.triggerType,
        // Junction array is the new source of truth. Only comment_on_post
        // campaigns can be scoped; DM/story triggers run account-wide.
        target_post_ids: s.triggerType === 'comment_on_post' ? s.targetMediaIds : [],
        // Legacy column — keep the first id for back-compat with any
        // external tool still reading it.
        target_post_id:
          s.triggerType === 'comment_on_post' && s.targetMediaIds.length > 0
            ? s.targetMediaIds[0]!
            : null,
        trigger_keyword:
          s.triggerType === 'story_mention' ? null : s.keyword.trim() || null,
        require_follow: s.requireFollow ? 1 : 0,
        initial_dm_text: s.ctaText || 'お知らせ',
        initial_dm_button_label: s.ctaButtonLabel,
        follow_reminder_dm_text: s.reminderText || '（フォロー確認を使っていないため未使用）',
        follow_reminder_button_label: s.reminderButtonLabel,
        reward_dm_text: s.rewardText || 'お知らせ',
        // Auto-default the reward URL when the operator picked a LINE
        // connection but didn't type a URL: use the connection's
        // /auth/line entrypoint, which is the universal LINE friend-add
        // flow. The actual link recipients click goes through the
        // LINE Harness `/r/<short>` redirect anyway, so this URL is
        // just the fallback for direct copy-paste clicks.
        reward_url:
          s.rewardUrl.trim() ||
          (s.lineConnectionId
            ? defaultLineRewardUrl(lineConnections, s.lineConnectionId)
            : ''),
        line_connection_id: s.lineConnectionId || null,
        line_pool_slug: s.linePoolSlug || null,
        max_loops: 0,
        initial_dm_rich_message_id: ctaId,
        reward_dm_rich_message_id: rewardId,
        follow_reminder_dm_rich_message_id: reminderId,
        comment_reply_text: buildCommentReplyPayload(s),
        followup_dm_sequence: buildFollowupPayload(s),
      } as const
      const gate = isEdit && existingGate
        ? await engagementGatesApi.update(existingGate.id, payload)
        : await engagementGatesApi.create(payload)
      setProgress('完了')
      router.push(`/campaigns/${gate.id}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'キャンペーン保存に失敗しました'
      setError(
        `${message}\n※DMテンプレートは作成済みです。/rich-messages から確認・再利用できます`,
      )
      setProgress('')
      setSaving(false)
    }
  }

  // Preview pulls from whichever source the slot is currently using —
  // either the inline form or the picked existing message's own blocks.
  const ctaPreviewBlocks =
    s.ctaMode === 'existing' ? findMessage(s.ctaExistingId)?.blocks ?? [] : buildCtaBlocks()
  const rewardPreviewBlocks =
    s.rewardMode === 'existing' ? findMessage(s.rewardExistingId)?.blocks ?? [] : buildRewardBlocks()
  const reminderPreviewBlocks = s.requireFollow
    ? s.reminderMode === 'existing'
      ? findMessage(s.reminderExistingId)?.blocks ?? []
      : buildReminderBlocks()
    : []

  return (
    <div>
      <Header
        title={isEdit ? 'キャンペーン編集' : '新規キャンペーン'}
        description={isEdit ? '保存するとすぐに新しい内容で運用されます' : 'リールにコメント → 自動DMで LINE 誘導するセットを1画面で作成'}
      />

      <div className="mb-4">
        <Link
          href={isEdit && existingGate ? `/campaigns/${existingGate.id}` : '/campaigns'}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← {isEdit ? 'キャンペーン詳細に戻る' : 'キャンペーン一覧に戻る'}
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
        {/* Form */}
        <div className="space-y-4">
          {/* ── セクション1: 基本情報 */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">① キャンペーン名</h2>
            <input
              type="text"
              value={s.name}
              onChange={(e) => update('name', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
            />
            <p className="mt-1 text-[11px] text-gray-400">管理画面に表示される名前。ユーザーには見えません</p>
          </section>

          {/* ── セクション2: 何に反応するか */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">② 何に反応して発動する？</h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
              {TRIGGER_OPTIONS.map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => update('triggerType', opt.v)}
                  className={`px-3 py-2.5 rounded-lg text-left text-xs border transition-colors ${
                    s.triggerType === opt.v
                      ? 'border-[#E1306C] bg-pink-50'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className={`text-sm font-medium ${s.triggerType === opt.v ? 'text-[#E1306C]' : 'text-gray-800'}`}>
                    <span className="mr-1">{opt.emoji}</span>
                    {opt.label}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5 leading-snug">{opt.help}</div>
                </button>
              ))}
            </div>

            {s.triggerType === 'comment_on_post' && (
              <>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium text-gray-700">
                    対象リール <span className="text-gray-400 font-normal">（空欄なら全投稿）</span>
                  </div>
                  <span className="text-[10px] text-gray-400">{s.targetMediaIds.length} 件</span>
                </div>

                {s.targetMediaIds.length > 0 ? (
                  <div className="space-y-2">
                    {s.targetMediaIds.map((pid) => {
                      const m = s.targetMediaPreviews[pid]
                      const otherCampaigns = (coverage[pid] ?? []).length
                      return (
                        <div key={pid} className="flex items-center gap-3 border border-gray-200 rounded-lg p-2 bg-gray-50">
                          <div className="w-12 h-12 bg-gray-200 rounded overflow-hidden shrink-0">
                            {m?.thumbnail_url || m?.media_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={m.thumbnail_url || m.media_url} alt="" className="w-full h-full object-cover" />
                            ) : null}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-gray-700 line-clamp-1">
                              {m?.caption?.slice(0, 60) ?? `投稿 #${pid.slice(-8)}`}
                            </div>
                            {otherCampaigns > 0 && (
                              <div className="text-[10px] text-amber-600 mt-0.5">
                                ⚡ 他に {otherCampaigns} 件のキャンペーンが適用中
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const next = s.targetMediaIds.filter((x) => x !== pid)
                              update('targetMediaIds', next)
                              const copy = { ...s.targetMediaPreviews }
                              delete copy[pid]
                              update('targetMediaPreviews', copy)
                            }}
                            className="shrink-0 px-2 py-1 text-xs text-gray-500 border border-gray-200 rounded hover:bg-white"
                          >
                            外す
                          </button>
                        </div>
                      )
                    })}
                    <button
                      type="button"
                      onClick={() => setMediaPickerOpen(true)}
                      className="w-full py-1.5 rounded-lg text-xs font-medium border border-dashed border-gray-300 text-gray-500 hover:border-[#E1306C] hover:text-[#E1306C]"
                    >
                      + リールを追加・変更
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setMediaPickerOpen(true)}
                      className="w-full flex items-center justify-center gap-2 border border-dashed border-gray-300 rounded-lg px-3 py-3 text-sm text-gray-500 hover:border-[#E1306C] hover:text-[#E1306C]"
                    >
                      リールを選択（複数可）
                    </button>
                    <div className="text-[11px] text-gray-400 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      選ばない場合は <span className="font-medium text-gray-600">全ての投稿</span> に適用されるデフォルトキャンペーンになります。
                      <br />
                      <span className="text-gray-500">個別リール指定のキャンペーンを作ると、そちらが優先されるので今後も柔軟に上書き可能。</span>
                    </div>
                  </div>
                )}

                <div className="mt-3 pt-3 border-t border-gray-100">
                  <label className="block text-xs font-medium text-gray-600 mb-1">キーワード（任意）</label>
                  <input
                    type="text"
                    value={s.keyword}
                    onChange={(e) => update('keyword', e.target.value)}
                    placeholder="例: 欲しい（空欄なら全コメントに反応）"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
                  />
                </div>
              </>
            )}

            {s.triggerType === 'dm_keyword' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  DMキーワード <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={s.keyword}
                  onChange={(e) => update('keyword', e.target.value)}
                  placeholder="例: 仕組み"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
                />
                <p className="mt-1 text-[11px] text-gray-400">
                  このキーワードを含むDMが届くと発動します（部分一致）
                </p>
              </div>
            )}

            {s.triggerType === 'story_mention' && (
              <div className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                自分のストーリーがメンション or シェアされると即発動します。追加設定なし。
              </div>
            )}

            {s.triggerType === 'comment_on_post' && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-medium text-gray-600">
                    コメントへの公開返信（任意）
                  </label>
                  <span className="text-[10px] text-gray-400">{s.commentReplyTexts.length}/3 パターン</span>
                </div>
                <div className="space-y-2">
                  {s.commentReplyTexts.map((text, idx) => (
                    <div key={idx} className="flex gap-2 items-start">
                      <span className="shrink-0 w-5 h-5 rounded-full bg-gray-100 text-[10px] font-medium text-gray-600 flex items-center justify-center mt-2">
                        {idx + 1}
                      </span>
                      <textarea
                        value={text}
                        onChange={(e) => {
                          const next = [...s.commentReplyTexts]
                          next[idx] = e.target.value
                          update('commentReplyTexts', next)
                        }}
                        placeholder={idx === 0 ? '例: @{{username}} DMでプレゼント送ったよ！🎁' : 'バリエーション（任意）'}
                        rows={2}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
                      />
                      {s.commentReplyTexts.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            update('commentReplyTexts', s.commentReplyTexts.filter((_, i) => i !== idx))
                          }}
                          className="mt-1 p-1 text-red-500 hover:bg-red-50 rounded"
                          aria-label="削除"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {s.commentReplyTexts.length < 3 && (
                  <button
                    type="button"
                    onClick={() => update('commentReplyTexts', [...s.commentReplyTexts, ''])}
                    className="mt-2 w-full py-1.5 rounded-lg text-xs font-medium border border-dashed border-gray-300 text-gray-500 hover:border-[#E1306C] hover:text-[#E1306C]"
                  >
                    + バリエーションを追加
                  </button>
                )}
                <p className="mt-2 text-[11px] text-gray-400">
                  複数入れると毎回ランダムで1つ選ばれます（ボット感を減らす）。<code className="font-mono">{'{{username}}'}</code> でコメントした人の @username を差し込めます。全部空欄ならDMのみ。
                </p>
                <p className="mt-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  ⚠️ IG仕様：未フォローのユーザーへのDMは「メッセージリクエスト」に振り分けられたり届かないことがあります。公開返信でリクエスト確認を促すと到達率UP。
                </p>
              </div>
            )}
          </section>

          {/* ── セクション3: 最初のDM */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-1">③ コメントがきたら、このDMを送る</h2>
            <p className="text-[11px] text-gray-400 mb-3">ユーザーが最初に受け取るDM</p>

            <SlotModeToggle
              mode={s.ctaMode}
              onChange={(m) => update('ctaMode', m)}
              existingCount={messagesByKind('cta').length}
            />

            {s.ctaMode === 'existing' ? (
              <ExistingMessagePicker
                options={messagesByKind('cta')}
                value={s.ctaExistingId}
                onChange={(id) => update('ctaExistingId', id)}
              />
            ) : (
              <div className="space-y-3 mt-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">画像</label>
                  <ImagePreview
                    url={s.ctaImageUrl}
                    onChange={(u) => update('ctaImageUrl', u)}
                    onPick={() => setImagePickerTarget(() => (url: string) => update('ctaImageUrl', url))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">メッセージ</label>
                  <textarea
                    value={s.ctaText}
                    onChange={(e) => update('ctaText', e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">ボタンの文字</label>
                  <input
                    type="text"
                    value={s.ctaButtonLabel}
                    onChange={(e) => update('ctaButtonLabel', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
                  />
                  <p className="mt-1 text-[11px] text-gray-400">
                    このボタンを押すと {s.requireFollow ? 'フォロー確認 → ' : ''}特典DMが送信されます
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* ── セクション4: フォロー確認 */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={s.requireFollow}
                onChange={(e) => update('requireFollow', e.target.checked)}
                className="w-4 h-4 rounded border-gray-300"
              />
              <span className="text-sm font-semibold text-gray-900">④ フォローしている人だけに特典を配る</span>
            </label>
            <p className="mt-1 ml-6 text-[11px] text-gray-400">
              OFF: ボタンを押したら即特典DMを送信<br />
              ON: ボタンを押したらフォロー確認 → フォロー済みのみ特典DM、未達は別DMで案内
            </p>
            {s.requireFollow && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <h3 className="text-xs font-semibold text-gray-700 mb-2">フォロー未達の人に送るDM</h3>
                <SlotModeToggle
                  mode={s.reminderMode}
                  onChange={(m) => update('reminderMode', m)}
                  existingCount={messagesByKind('reminder').length}
                />
                {s.reminderMode === 'existing' ? (
                  <ExistingMessagePicker
                    options={messagesByKind('reminder')}
                    value={s.reminderExistingId}
                    onChange={(id) => update('reminderExistingId', id)}
                  />
                ) : (
                  <div className="space-y-3 mt-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">メッセージ</label>
                      <textarea
                        value={s.reminderText}
                        onChange={(e) => update('reminderText', e.target.value)}
                        rows={2}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">ボタンの文字</label>
                      <input
                        type="text"
                        value={s.reminderButtonLabel}
                        onChange={(e) => update('reminderButtonLabel', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── セクション5: 特典DM */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-1">⑤ 特典DM（ボタン押下後に送る）</h2>
            <p className="text-[11px] text-gray-400 mb-3">{s.requireFollow ? 'フォロー確認OK後に' : 'ボタン押下直後に'}届くDM</p>

            <SlotModeToggle
              mode={s.rewardMode}
              onChange={(m) => update('rewardMode', m)}
              existingCount={messagesByKind('reward').length}
            />

            {s.rewardMode === 'existing' ? (
              <div className="space-y-3 mt-3">
                <ExistingMessagePicker
                  options={messagesByKind('reward')}
                  value={s.rewardExistingId}
                  onChange={(id) => update('rewardExistingId', id)}
                />
                <RewardUrlField
                  value={s.rewardUrl}
                  onChange={(v) => update('rewardUrl', v)}
                  connections={lineConnections}
                  connectionId={s.lineConnectionId}
                  onConnectionChange={handleConnectionChange}
                  pools={linePools}
                  poolSlug={s.linePoolSlug}
                  onPoolChange={(slug) => update('linePoolSlug', slug)}
                  help="選択したメッセージに {REWARD_URL} プレースホルダが含まれる場合、このURLが差し込まれます"
                />
              </div>
            ) : (
              <div className="space-y-3 mt-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">画像</label>
                  <ImagePreview
                    url={s.rewardImageUrl}
                    onChange={(u) => update('rewardImageUrl', u)}
                    onPick={() => setImagePickerTarget(() => (url: string) => update('rewardImageUrl', url))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">メッセージ</label>
                  <textarea
                    value={s.rewardText}
                    onChange={(e) => update('rewardText', e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
                  />
                </div>
                <RewardUrlField
                  value={s.rewardUrl}
                  onChange={(v) => update('rewardUrl', v)}
                  connections={lineConnections}
                  connectionId={s.lineConnectionId}
                  onConnectionChange={handleConnectionChange}
                  pools={linePools}
                  poolSlug={s.linePoolSlug}
                  onPoolChange={(slug) => update('linePoolSlug', slug)}
                  help="ボタンを押すとこのURLが開きます"
                />
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">ボタンの文字</label>
                  <input
                    type="text"
                    value={s.rewardButtonLabel}
                    onChange={(e) => update('rewardButtonLabel', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
                  />
                </div>
              </div>
            )}
          </section>

          {/* ── セクション6: 24h フォローアップDM */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-gray-900">⑥ フォローアップDM（任意・最大3本）</h2>
              <span className="text-[10px] text-gray-400">{s.followupSteps.length}/3</span>
            </div>
            <p className="text-[11px] text-gray-400 mb-3">
              特典DMが届いた後に、時間差でもう一通送ります。<br />
              Meta の 24時間ルール に収まる範囲で <span className="font-medium text-gray-600">24h × 60 = 1440分まで</span>。
            </p>

            <div className="space-y-3">
              {s.followupSteps.map((step, idx) => (
                <div key={idx} className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-700">#{idx + 1}</span>
                    <button
                      type="button"
                      onClick={() =>
                        update('followupSteps', s.followupSteps.filter((_, i) => i !== idx))
                      }
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      削除
                    </button>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-gray-600 mb-1">送信タイミング（特典配信から）</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={1440}
                        value={step.delay_minutes}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          update(
                            'followupSteps',
                            s.followupSteps.map((x, i) =>
                              i === idx ? { ...x, delay_minutes: v } : x,
                            ),
                          )
                        }}
                        className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
                      />
                      <span className="text-xs text-gray-500">分後</span>
                      <span className="text-[10px] text-gray-400 ml-2">
                        {step.delay_minutes >= 60
                          ? `≒ ${Math.round((step.delay_minutes / 60) * 10) / 10} 時間`
                          : ''}
                      </span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-gray-600 mb-1">メッセージ</label>
                    <textarea
                      value={step.text}
                      onChange={(e) =>
                        update(
                          'followupSteps',
                          s.followupSteps.map((x, i) =>
                            i === idx ? { ...x, text: e.target.value } : x,
                          ),
                        )
                      }
                      rows={2}
                      placeholder="例: LP の動画見てくれた？質問あれば返信してね"
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm resize-none"
                    />
                  </div>
                  <details className="text-[11px]">
                    <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
                      + ボタン付き（任意）
                    </summary>
                    <div className="mt-2 space-y-1.5">
                      <input
                        type="text"
                        value={step.button_label ?? ''}
                        onChange={(e) =>
                          update(
                            'followupSteps',
                            s.followupSteps.map((x, i) =>
                              i === idx ? { ...x, button_label: e.target.value } : x,
                            ),
                          )
                        }
                        placeholder="ボタンラベル（例: もう一度見る）"
                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                      />
                      <input
                        type="text"
                        value={step.button_url ?? ''}
                        onChange={(e) =>
                          update(
                            'followupSteps',
                            s.followupSteps.map((x, i) =>
                              i === idx ? { ...x, button_url: e.target.value } : x,
                            ),
                          )
                        }
                        placeholder="URL (https://... or {REWARD_URL})"
                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs font-mono"
                      />
                    </div>
                  </details>
                </div>
              ))}
            </div>

            {s.followupSteps.length < 3 && (
              <button
                type="button"
                onClick={() =>
                  update('followupSteps', [
                    ...s.followupSteps,
                    {
                      delay_minutes: s.followupSteps.length === 0 ? 30 : 180,
                      text: '',
                    },
                  ])
                }
                className="mt-3 w-full py-1.5 rounded-lg text-xs font-medium border border-dashed border-gray-300 text-gray-500 hover:border-[#E1306C] hover:text-[#E1306C]"
              >
                + フォローアップを追加
              </button>
            )}
          </section>

          {/* ── Submit */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
          )}
          {saving && progress && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700">{progress}</div>
          )}
          <div className="flex gap-2 justify-end">
            <Link
              href="/campaigns"
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              キャンセル
            </Link>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: ACCENT }}
            >
              {saving ? (isEdit ? '更新中...' : '作成中...') : isEdit ? 'キャンペーン更新' : 'キャンペーン作成'}
            </button>
          </div>
        </div>

        {/* Preview column. Pure sticky — no internal scroll — so the cards
            stay aligned with whichever section the operator is editing on
            the left. The aside's combined height (~3 × ~280px) fits
            comfortably in any reasonable desktop viewport. */}
        <aside className="lg:sticky lg:top-8 self-start space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-xs font-semibold text-gray-500 mb-3">1. 最初のDM（コメント→自動送信）</h3>
            <RichMessagePreview blocks={ctaPreviewBlocks} />
          </div>
          {s.requireFollow && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-xs font-semibold text-gray-500 mb-3">2. フォロー未達のときのDM</h3>
              <RichMessagePreview blocks={reminderPreviewBlocks} />
            </div>
          )}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-xs font-semibold text-gray-500 mb-3">
              {s.requireFollow ? '3' : '2'}. 特典DM（ボタン押下後）
            </h3>
            <RichMessagePreview blocks={rewardPreviewBlocks} />
          </div>
        </aside>
      </div>

      <MediaPickerModal
        open={mediaPickerOpen}
        onClose={() => setMediaPickerOpen(false)}
        productType="all"
        multiSelect
        selectedIds={s.targetMediaIds}
        coverage={coverage}
        // single-pick handler kept for API-compat; multiSelect routes to onPickMany.
        onPick={() => {}}
        onPickMany={(picks) => {
          const ids = picks.map((m) => m.id)
          update('targetMediaIds', ids)
          const previews: Record<string, MediaItem> = {}
          for (const m of picks) previews[m.id] = m
          update('targetMediaPreviews', previews)
          setMediaPickerOpen(false)
        }}
      />
      <ImagePickerModal
        open={imagePickerTarget !== null}
        onClose={() => setImagePickerTarget(null)}
        onPick={(url) => {
          imagePickerTarget?.(url)
          setImagePickerTarget(null)
        }}
      />
    </div>
  )
}

/**
 * Build the fallback reward URL when the operator picked a LINE connection
 * but didn't fill in a URL. We use the connection's `/auth/line` endpoint
 * because that's the universal LINE Harness friend-add flow, and it's the
 * URL recipients land on if they paste the tracked link outside an IG DM
 * (the in-DM flow goes through `/r/<short>` regardless of this value).
 */
function defaultLineRewardUrl(
  connections: LineConnection[],
  connectionId: string,
): string {
  const conn = connections.find((c) => c.id === connectionId)
  if (!conn) return ''
  return `${conn.worker_url.replace(/\/$/, '')}/auth/line`
}

/**
 * Populate the wizard state from an existing gate. For each DM slot we prefer
 * rich-message mode when an id is already attached; otherwise we fall back
 * to the legacy text fields and keep 新しく作る selected. This keeps edits
 * round-trippable: "open the edit page, change one field, save" doesn't
 * accidentally clone a rich message.
 */
function hydrateStateFromGate(
  gate: EngagementGate,
  setS: React.Dispatch<React.SetStateAction<WizardState>>,
): void {
  const targetIds = gate.target_post_ids ?? (gate.target_post_id ? [gate.target_post_id] : [])

  const ctaExisting = !!gate.initial_dm_rich_message_id
  const rewardExisting = !!gate.reward_dm_rich_message_id
  const reminderExisting = !!gate.follow_reminder_dm_rich_message_id

  // Decode the comment_reply_text column (plain string or JSON array) back
  // to the 1-3 textarea slots.
  const replyTexts = parseReplyPatternsForEdit(gate.comment_reply_text ?? '')

  // Decode the followup_dm_sequence JSON so the edit form can round-trip.
  let followupSteps: FollowupStepInput[] = []
  try {
    if (gate.followup_dm_sequence) {
      const parsed = JSON.parse(gate.followup_dm_sequence)
      if (Array.isArray(parsed)) {
        followupSteps = parsed.filter(
          (s: unknown): s is FollowupStepInput =>
            !!s && typeof s === 'object' && typeof (s as FollowupStepInput).text === 'string' &&
            typeof (s as FollowupStepInput).delay_minutes === 'number',
        )
      }
    }
  } catch {
    /* ignore; fall back to empty */
  }

  setS({
    name: gate.name,
    triggerType: gate.trigger_type,
    targetMediaIds: targetIds,
    targetMediaPreviews: {},
    keyword: gate.trigger_keyword ?? '',

    ctaMode: ctaExisting ? 'existing' : 'new',
    ctaExistingId: gate.initial_dm_rich_message_id ?? '',
    ctaImageUrl: '',
    ctaText: gate.initial_dm_text ?? '',
    ctaButtonLabel: gate.initial_dm_button_label || '特典を受け取る',

    requireFollow: gate.require_follow === 1,

    rewardMode: rewardExisting ? 'existing' : 'new',
    rewardExistingId: gate.reward_dm_rich_message_id ?? '',
    rewardImageUrl: '',
    rewardText: gate.reward_dm_text ?? '',
    rewardButtonLabel: 'LINEで受け取る',
    rewardUrl: gate.reward_url ?? '',
    lineConnectionId: gate.line_connection_id ?? '',
    linePoolSlug: gate.line_pool_slug ?? '',

    commentReplyTexts: replyTexts.length > 0 ? replyTexts : [''],
    followupSteps,

    reminderMode: reminderExisting ? 'existing' : 'new',
    reminderExistingId: gate.follow_reminder_dm_rich_message_id ?? '',
    reminderText: gate.follow_reminder_dm_text ?? '',
    reminderButtonLabel: gate.follow_reminder_button_label || 'フォローしたよ',
  })
}

function parseReplyPatternsForEdit(raw: string): string[] {
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

/**
 * Serialize the 0-3 follow-up DM steps for the backend. Returns a JSON
 * array of {delay_minutes, text, image_url?, button_label?, button_url?}
 * or null when empty.
 */
function buildFollowupPayload(s: WizardState): string | null {
  const filled = s.followupSteps.filter((step) => step.text.trim().length > 0)
  if (filled.length === 0) return null
  return JSON.stringify(
    filled.map((step) => {
      const out: FollowupStepInput = {
        delay_minutes: Math.max(1, Math.floor(step.delay_minutes)),
        text: step.text.trim(),
      }
      if (step.image_url?.trim()) out.image_url = step.image_url.trim()
      if (step.button_label?.trim() && step.button_url?.trim()) {
        out.button_label = step.button_label.trim()
        out.button_url = step.button_url.trim()
      }
      return out
    }),
  )
}

/**
 * Serialize the 1-3 comment-reply patterns for the backend.
 *   []       → null (no public reply)
 *   ['a']    → 'a' (plain string for back-compat)
 *   [a,b,..] → JSON array, webhook picks one at random per delivery
 * Only emitted when the campaign actually fires on comments.
 */
function buildCommentReplyPayload(s: WizardState): string | null {
  if (s.triggerType !== 'comment_on_post') return null
  const filled = s.commentReplyTexts.map((t) => t.trim()).filter((t) => t.length > 0)
  if (filled.length === 0) return null
  if (filled.length === 1) return filled[0]!
  return JSON.stringify(filled)
}

function SlotModeToggle({
  mode,
  onChange,
  existingCount,
}: {
  mode: SlotMode
  onChange: (m: SlotMode) => void
  existingCount: number
}) {
  return (
    <div className="flex gap-2 mb-2">
      <button
        type="button"
        onClick={() => onChange('new')}
        className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium border ${
          mode === 'new'
            ? 'border-[#E1306C] text-[#E1306C] bg-pink-50'
            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
        }`}
      >
        📝 新しく作る
      </button>
      <button
        type="button"
        onClick={() => onChange('existing')}
        disabled={existingCount === 0}
        className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium border disabled:opacity-40 disabled:cursor-not-allowed ${
          mode === 'existing'
            ? 'border-[#E1306C] text-[#E1306C] bg-pink-50'
            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
        }`}
      >
        📂 作り置きから選ぶ{existingCount > 0 ? ` (${existingCount})` : ''}
      </button>
    </div>
  )
}

function ExistingMessagePicker({
  options,
  value,
  onChange,
}: {
  options: RichMessage[]
  value: string
  onChange: (id: string) => void
}) {
  if (options.length === 0) {
    return (
      <div className="text-center text-[11px] text-gray-400 py-3 border border-dashed border-gray-200 rounded-lg">
        この種類の作り置きがありません
      </div>
    )
  }
  return (
    <div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
      >
        <option value="">-- 選択してください --</option>
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} ({m.blocks.length} ブロック)
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * Reward URL + LINE Harness cross-link binding.
 *
 * Operator workflow:
 *   1. Paste the raw destination URL (公式LINE friend-add link, LP, etc.)
 *   2. Pick a LINE Harness 接続先 + Pool — two dropdowns, no modal.
 *   3. At send time the worker rewrites the URL through a tracked link so
 *      the recipient's IGSID rides along `?ig=<IGSID>` and LINE Harness
 *      can attribute the LINE friend back to the IG follower on click.
 *
 * Leaving 接続先 blank (or no connections configured) = old behaviour:
 * the raw URL is sent as-is, no cross-link attribution.
 */
function RewardUrlField({
  value,
  onChange,
  connections,
  connectionId,
  onConnectionChange,
  pools,
  poolSlug,
  onPoolChange,
  help,
}: {
  value: string
  onChange: (v: string) => void
  connections: LineConnection[]
  connectionId: string
  onConnectionChange: (id: string) => void
  pools: LineHarnessPool[]
  poolSlug: string
  onPoolChange: (slug: string) => void
  help?: string
}) {
  // Two distinct delivery modes — surfaced as a top-level toggle so the
  // operator picks one explicitly:
  //   1. LINE Harness 連携: pick a 接続先 (+ pool), URL auto-generated,
  //      IG↔LINE userId is captured on first click.
  //   2. URL 直接指定: paste any LP / external link, no cross-link.
  // Mode is derived from `connectionId` (truthy → harness mode) so we
  // don't need a third piece of state to keep in sync. Switching modes
  // via the toggle preselects the default connection or clears it.
  const mode: 'harness' | 'manual' = connectionId ? 'harness' : 'manual'
  const hasConnections = connections.length > 0
  const defaultConn = connections.find((c) => c.is_default) ?? connections[0]

  const switchTo = (next: 'harness' | 'manual') => {
    if (next === mode) return
    if (next === 'harness') {
      if (defaultConn) onConnectionChange(defaultConn.id)
    } else {
      onConnectionChange('')
    }
  }

  return (
    <div className="space-y-3">
      {hasConnections ? (
        <div className="grid grid-cols-2 gap-2">
          <ModeButton
            active={mode === 'harness'}
            onClick={() => switchTo('harness')}
            emoji="🔗"
            label="LINE Harness 連携"
            sub="IG↔LINE 自動紐付け"
          />
          <ModeButton
            active={mode === 'manual'}
            onClick={() => switchTo('manual')}
            emoji="🌐"
            label="URL 直接指定"
            sub="LP・外部リンクなど"
          />
        </div>
      ) : null}

      {mode === 'harness' && hasConnections ? (
        <div className="rounded-lg border border-[#E1306C]/20 bg-pink-50/40 p-3 space-y-2">
          <p className="text-[11px] text-gray-500 leading-relaxed">
            URL は LINE Harness の tracked link 経由で自動生成されます。
            友だち追加時に IG ↔ LINE のユーザーが紐付きます（ig userId × line friend_uuid）。
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-medium text-gray-500 mb-1 uppercase tracking-wider">
                接続先
              </label>
              <select
                value={connectionId}
                onChange={(e) => onConnectionChange(e.target.value)}
                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
              >
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.is_default ? ' (デフォルト)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-500 mb-1 uppercase tracking-wider">
                Pool（LINE側属性タグ）
              </label>
              <select
                value={poolSlug}
                onChange={(e) => onPoolChange(e.target.value)}
                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
              >
                <option value="">（指定なし）</option>
                {pools.map((p) => (
                  <option key={p.id} value={p.slug}>
                    {p.name} ({p.slug})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            誘導先 URL <span className="text-red-500">*</span>
          </label>
          <input
            type="url"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://line.me/R/ti/p/@xxx または https://example.com/lp"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
          />
          {!hasConnections && (
            <p className="mt-1 text-[11px] text-gray-400 leading-relaxed">
              <a href="/settings" className="text-[#E1306C] hover:underline">
                /settings
              </a>{' '}
              で LINE Harness 接続先を登録すると、IG ↔ LINE の自動連携が使えます
            </p>
          )}
          {help && hasConnections && (
            <p className="mt-1 text-[11px] text-gray-400">{help}</p>
          )}
        </div>
      )}
    </div>
  )
}

function ModeButton({
  active,
  onClick,
  emoji,
  label,
  sub,
}: {
  active: boolean
  onClick: () => void
  emoji: string
  label: string
  sub: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2.5 rounded-lg text-left border transition-colors ${
        active
          ? 'border-[#E1306C] bg-pink-50 text-gray-900'
          : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
      }`}
    >
      <div className="text-sm font-semibold flex items-center gap-1.5">
        <span>{emoji}</span>
        <span>{label}</span>
      </div>
      <div className={`text-[10px] mt-0.5 ${active ? 'text-[#E1306C]' : 'text-gray-400'}`}>
        {sub}
      </div>
    </button>
  )
}

function ImagePreview({ url, onChange, onPick }: { url: string; onChange: (u: string) => void; onPick: () => void }) {
  if (url) {
    return (
      <div className="flex items-center gap-3 border border-gray-200 rounded-lg p-2 bg-gray-50">
        <div className="w-16 h-16 bg-white rounded overflow-hidden shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="w-full h-full object-cover" />
        </div>
        <div className="flex-1 min-w-0 text-[10px] text-gray-400 font-mono truncate">{url}</div>
        <div className="flex gap-1 shrink-0">
          <button type="button" onClick={onPick} className="px-2 py-1 text-xs border border-gray-200 rounded hover:bg-white">
            変更
          </button>
          <button type="button" onClick={() => onChange('')} className="px-2 py-1 text-xs text-gray-500 border border-gray-200 rounded hover:bg-gray-50">
            削除
          </button>
        </div>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onPick}
      className="w-full flex items-center justify-center gap-2 border border-dashed border-gray-300 rounded-lg px-3 py-4 text-sm text-gray-500 hover:border-[#E1306C] hover:text-[#E1306C]"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
      </svg>
      画像を選択（任意）
    </button>
  )
}
