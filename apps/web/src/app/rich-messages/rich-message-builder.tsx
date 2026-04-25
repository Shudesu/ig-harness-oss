'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  richMessagesApi,
  type RichMessage,
  type RichMessageBlock,
  type RichMessageButton,
  type RichMessageKind,
} from '@/lib/api'
import Header from '@/components/layout/header'
import RichMessagePreview from '@/components/rich-message-preview'
import ImagePickerModal from '@/components/image-picker-modal'
import TestSendModal from '@/components/test-send-modal'

const ACCENT = '#E1306C'

/**
 * Empty block factory for each supported type. Provides sensible defaults so
 * the preview renders something as soon as the block is inserted.
 */
function newBlock(type: RichMessageBlock['type']): RichMessageBlock {
  switch (type) {
    case 'text':
      return { type: 'text', text: '' }
    case 'image':
      return { type: 'image', url: '' }
    case 'card':
      return {
        type: 'card',
        title: '',
        subtitle: '',
        image_url: '',
        buttons: [{ type: 'postback', label: '受け取る', payload: 'CHECK_FOLLOW:{GATE_ID}:{DELIVERY_ID}' }],
      }
    case 'carousel':
      return {
        type: 'carousel',
        cards: [
          { title: '', subtitle: '', image_url: '', buttons: [{ type: 'postback', label: '受け取る', payload: 'CHECK_FOLLOW:{GATE_ID}:{DELIVERY_ID}' }] },
        ],
      }
    case 'quick_replies':
      return { type: 'quick_replies', text: '', replies: [{ label: '', payload: '' }] }
  }
}

// Note: dedicated factory removed in favor of the preset-driven editor.
// Initial card buttons (in newBlock) and "+ カード追加" still prefill a
// CHECK_FOLLOW postback so the default matches the engagement-gate flow.

interface Props {
  existing?: RichMessage
}

export default function RichMessageBuilder({ existing }: Props) {
  const router = useRouter()
  const [name, setName] = useState(existing?.name ?? '')
  const [kind, setKind] = useState<RichMessageKind>(existing?.kind ?? 'cta')
  const [blocks, setBlocks] = useState<RichMessageBlock[]>(existing?.blocks ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [imagePickerTarget, setImagePickerTarget] = useState<((url: string) => void) | null>(null)
  const [showTestSend, setShowTestSend] = useState(false)

  // Track unsaved changes to block navigation would require extra plumbing;
  // for now we rely on an explicit save button.

  const updateBlock = useCallback((idx: number, patch: Partial<RichMessageBlock>) => {
    setBlocks((prev) => prev.map((b, i) => (i === idx ? ({ ...b, ...patch } as RichMessageBlock) : b)))
  }, [])

  const removeBlock = (idx: number) => setBlocks((prev) => prev.filter((_, i) => i !== idx))

  const move = (idx: number, dir: -1 | 1) => {
    setBlocks((prev) => {
      const next = [...prev]
      const target = idx + dir
      if (target < 0 || target >= next.length) return next
      const tmp = next[idx]
      next[idx] = next[target]
      next[target] = tmp
      return next
    })
  }

  const addBlock = (type: RichMessageBlock['type']) => {
    if (blocks.length >= 5) {
      alert('ブロックは最大 5 つまでです')
      return
    }
    setBlocks((prev) => [...prev, newBlock(type)])
  }

  const save = async () => {
    if (!name.trim()) {
      setError('名前を入力してください')
      return
    }
    if (blocks.length === 0) {
      setError('ブロックを 1 つ以上追加してください')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (existing) {
        await richMessagesApi.update(existing.id, { name: name.trim(), kind, blocks })
        router.push('/rich-messages')
      } else {
        const created = await richMessagesApi.create({ name: name.trim(), kind, blocks })
        router.push(`/rich-messages/${created.id}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Header
        title={existing ? 'DMテンプレート編集' : 'DMテンプレート新規作成'}
        description="画像・テキスト・ボタンブロックを組み合わせて DM テンプレートを作成"
      />

      <div className="mb-4">
        <Link href="/rich-messages" className="text-sm text-gray-500 hover:text-gray-700">
          ← 一覧に戻る
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
        {/* Form column */}
        <div className="space-y-4">
          <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">名前 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例: 2026-04 リール共通 CTA"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">種別</label>
              <div className="flex gap-2">
                {(['cta', 'reward', 'reminder', 'generic'] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setKind(k)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                      kind === k ? 'border-[#E1306C] text-[#E1306C] bg-pink-50' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {({ cta: 'CTA', reward: 'リワード', reminder: 'リマインダー', generic: '汎用' } as Record<RichMessageKind, string>)[k]}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">ブロック</h3>
                <p className="text-xs text-gray-500 mt-0.5">最大 5 つまで。送信時は上から順に配信されます</p>
              </div>
              <span className="text-xs text-gray-400">{blocks.length} / 5</span>
            </div>

            <div className="space-y-3">
              {blocks.map((block, idx) => (
                <BlockEditor
                  key={idx}
                  block={block}
                  index={idx}
                  total={blocks.length}
                  onChange={(patch) => updateBlock(idx, patch)}
                  onMove={(dir) => move(idx, dir)}
                  onRemove={() => removeBlock(idx)}
                  onPickImage={(cb) => setImagePickerTarget(() => cb)}
                />
              ))}
            </div>

            {blocks.length < 5 && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="text-xs font-medium text-gray-500 mb-2">ブロック追加</div>
                <div className="flex flex-wrap gap-2">
                  {(['text', 'image', 'card', 'carousel', 'quick_replies'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => addBlock(t)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-700 hover:border-[#E1306C] hover:text-[#E1306C]"
                    >
                      + {BLOCK_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          <div className="flex justify-between gap-3">
            {existing && (
              <button
                onClick={() => setShowTestSend(true)}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                テスト配信
              </button>
            )}
            <div className="flex gap-2 ml-auto">
              <Link
                href="/rich-messages"
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                キャンセル
              </Link>
              <button
                onClick={save}
                disabled={saving}
                className="px-5 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: ACCENT }}
              >
                {saving ? '保存中...' : existing ? '更新' : '作成'}
              </button>
            </div>
          </div>
        </div>

        {/* Preview column (sticky on desktop) */}
        <aside className="lg:sticky lg:top-8 self-start">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">プレビュー</h3>
            <RichMessagePreview blocks={blocks} />
          </div>
        </aside>
      </div>

      <ImagePickerModal
        open={imagePickerTarget !== null}
        onClose={() => setImagePickerTarget(null)}
        onPick={(url) => {
          imagePickerTarget?.(url)
          setImagePickerTarget(null)
        }}
      />

      {existing && (
        <TestSendModal
          open={showTestSend}
          onClose={() => setShowTestSend(false)}
          richMessageId={existing.id}
          richMessageName={existing.name}
        />
      )}
    </div>
  )
}

const BLOCK_LABELS: Record<RichMessageBlock['type'], string> = {
  text: 'テキスト',
  image: '画像',
  card: 'カード',
  carousel: 'カルーセル',
  quick_replies: 'クイックリプライ',
}

function BlockEditor({
  block,
  index,
  total,
  onChange,
  onMove,
  onRemove,
  onPickImage,
}: {
  block: RichMessageBlock
  index: number
  total: number
  onChange: (patch: Partial<RichMessageBlock>) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  onPickImage: (cb: (url: string) => void) => void
}) {
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-200 px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500">#{index + 1}</span>
          <span className="text-sm font-medium text-gray-800">{BLOCK_LABELS[block.type]}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onMove(-1)}
            disabled={index === 0}
            className="p-1 rounded hover:bg-gray-200 disabled:opacity-30"
            aria-label="上へ移動"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <button
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            className="p-1 rounded hover:bg-gray-200 disabled:opacity-30"
            aria-label="下へ移動"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button onClick={onRemove} className="p-1 rounded hover:bg-red-100 text-red-500" aria-label="削除">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {block.type === 'text' && (
          <textarea
            value={block.text}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder="テキスト（最大1000文字）"
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
          />
        )}

        {block.type === 'image' && (
          <ImageUrlField
            url={block.url}
            onChange={(url) => onChange({ url })}
            onPickImage={onPickImage}
          />
        )}

        {block.type === 'card' && (
          <CardEditor
            card={{
              title: block.title,
              subtitle: block.subtitle,
              image_url: block.image_url,
              default_url: block.default_url,
              buttons: block.buttons,
            }}
            onChange={(patch) => onChange(patch as Partial<RichMessageBlock>)}
            onPickImage={onPickImage}
          />
        )}

        {block.type === 'carousel' && (
          <CarouselEditor
            cards={block.cards}
            onChange={(cards) => onChange({ cards } as Partial<RichMessageBlock>)}
            onPickImage={onPickImage}
          />
        )}

        {block.type === 'quick_replies' && (
          <QuickRepliesEditor
            text={block.text}
            replies={block.replies}
            onChange={(patch) => onChange(patch as Partial<RichMessageBlock>)}
          />
        )}
      </div>
    </div>
  )
}

function ImageUrlField({ url, onChange, onPickImage }: { url: string; onChange: (url: string) => void; onPickImage: (cb: (url: string) => void) => void }) {
  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={url}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://... または ギャラリーから選択"
        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
      />
      <button
        onClick={() => onPickImage((picked) => onChange(picked))}
        className="px-3 py-2 rounded-lg text-xs font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 whitespace-nowrap"
      >
        ギャラリー
      </button>
    </div>
  )
}

interface CardShape {
  title: string
  subtitle?: string
  image_url?: string
  default_url?: string
  buttons: RichMessageButton[]
}

function CardEditor({ card, onChange, onPickImage }: {
  card: CardShape
  onChange: (patch: Partial<CardShape>) => void
  onPickImage: (cb: (url: string) => void) => void
}) {
  return (
    <div className="space-y-2.5">
      <input
        type="text"
        value={card.title}
        onChange={(e) => onChange({ title: e.target.value })}
        placeholder="タイトル（最大80文字）"
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
      />
      <input
        type="text"
        value={card.subtitle ?? ''}
        onChange={(e) => onChange({ subtitle: e.target.value })}
        placeholder="サブタイトル（省略可）"
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
      />
      <div>
        <div className="text-xs font-medium text-gray-600 mb-1">画像 (任意)</div>
        <ImageUrlField url={card.image_url ?? ''} onChange={(url) => onChange({ image_url: url })} onPickImage={onPickImage} />
      </div>
      <div>
        <div className="text-xs font-medium text-gray-600 mb-1">ボタン（最大 3）</div>
        <ButtonsEditor
          buttons={card.buttons}
          onChange={(buttons) => onChange({ buttons })}
        />
      </div>
    </div>
  )
}

function CarouselEditor({ cards, onChange, onPickImage }: {
  cards: CardShape[]
  onChange: (cards: CardShape[]) => void
  onPickImage: (cb: (url: string) => void) => void
}) {
  const updateCard = (idx: number, patch: Partial<CardShape>) => {
    onChange(cards.map((c, i) => (i === idx ? { ...c, ...patch } : c)))
  }
  const removeCard = (idx: number) => onChange(cards.filter((_, i) => i !== idx))

  return (
    <div className="space-y-3">
      {cards.map((card, idx) => (
        <div key={idx} className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-600">カード #{idx + 1}</span>
            {cards.length > 1 && (
              <button onClick={() => removeCard(idx)} className="text-xs text-red-500 hover:text-red-700">削除</button>
            )}
          </div>
          <CardEditor card={card} onChange={(patch) => updateCard(idx, patch)} onPickImage={onPickImage} />
        </div>
      ))}
      {cards.length < 10 && (
        <button
          onClick={() => onChange([...cards, { title: '', buttons: [{ type: 'postback', label: '', payload: 'CHECK_FOLLOW:{GATE_ID}:{DELIVERY_ID}' }] }])}
          className="w-full py-2 rounded-lg text-xs font-medium border border-dashed border-gray-300 text-gray-500 hover:border-[#E1306C] hover:text-[#E1306C]"
        >
          + カード追加
        </button>
      )}
    </div>
  )
}

// Button action presets hide the underlying postback/url + payload plumbing
// from non-technical operators. Picking a preset configures the button
// correctly for the engagement-gate flow.
type ButtonPreset = 'gate_check' | 'open_url' | 'custom'

function detectPreset(btn: RichMessageButton): ButtonPreset {
  if (btn.type === 'postback' && btn.payload === 'CHECK_FOLLOW:{GATE_ID}:{DELIVERY_ID}') return 'gate_check'
  if (btn.type === 'url') return 'open_url'
  return 'custom'
}

function applyPreset(preset: ButtonPreset, existing: RichMessageButton): RichMessageButton {
  const label = existing.label || ''
  if (preset === 'gate_check') {
    return { type: 'postback', label: label || '特典を受け取る', payload: 'CHECK_FOLLOW:{GATE_ID}:{DELIVERY_ID}' }
  }
  if (preset === 'open_url') {
    const currentUrl = existing.type === 'url' ? existing.url : '{REWARD_URL}'
    return { type: 'url', label: label || 'LINEで受け取る', url: currentUrl }
  }
  // custom: keep existing shape; if coming from a preset, default to a blank postback
  if (existing.type === 'postback' || existing.type === 'url') return existing
  return { type: 'postback', label, payload: '' }
}

function ButtonsEditor({ buttons, onChange }: { buttons: RichMessageButton[]; onChange: (buttons: RichMessageButton[]) => void }) {
  const [showAdvanced, setShowAdvanced] = useState(false)

  const update = (idx: number, next: RichMessageButton) => {
    onChange(buttons.map((b, i) => (i === idx ? next : b)))
  }
  const remove = (idx: number) => onChange(buttons.filter((_, i) => i !== idx))

  return (
    <div className="space-y-2">
      {buttons.map((btn, idx) => {
        const preset = detectPreset(btn)
        return (
          <div key={idx} className="border border-gray-200 rounded-lg p-2.5 space-y-2 bg-white">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={btn.label}
                onChange={(e) => update(idx, { ...btn, label: e.target.value } as RichMessageButton)}
                placeholder="ボタンに表示する文字"
                className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs"
              />
              {buttons.length > 1 && (
                <button type="button" onClick={() => remove(idx)} className="p-1 text-red-500 hover:bg-red-50 rounded" aria-label="削除">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            <div>
              <div className="text-[10px] font-medium text-gray-500 mb-1">押された時の動作</div>
              <div className={`grid gap-1.5 ${showAdvanced ? 'grid-cols-3' : 'grid-cols-2'}`}>
                {([
                  { v: 'gate_check', emoji: '🎁', label: '特典を受け取る' },
                  { v: 'open_url', emoji: '🔗', label: 'リンクを開く' },
                  ...(showAdvanced
                    ? ([{ v: 'custom', emoji: '⚙️', label: 'カスタム' }] as const)
                    : []),
                ] as const).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => update(idx, applyPreset(opt.v, btn))}
                    className={`px-2 py-1.5 rounded border text-xs text-left transition-colors ${
                      preset === opt.v
                        ? 'border-[#E1306C] bg-pink-50 text-[#E1306C]'
                        : 'border-gray-200 text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <span className="mr-1">{opt.emoji}</span>
                    {opt.label}
                  </button>
                ))}
              </div>
              {preset === 'gate_check' && (
                <p className="mt-1 text-[10px] text-gray-400">
                  タップ → フォロー状態を確認 → フォロー済みなら特典DM配信
                </p>
              )}
              {preset === 'open_url' && (
                <div className="mt-1.5">
                  <input
                    type="text"
                    value={btn.type === 'url' ? btn.url : ''}
                    onChange={(e) => update(idx, { type: 'url', label: btn.label, url: e.target.value })}
                    placeholder="https://line.me/... や {REWARD_URL}"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs font-mono"
                  />
                  <p className="mt-1 text-[10px] text-gray-400">
                    <code>{'{REWARD_URL}'}</code> と書いておくと、キャンペーンの「特典 URL」がタップ時に埋め込まれます
                  </p>
                </div>
              )}
              {preset === 'custom' && showAdvanced && (
                <div className="mt-1.5 space-y-1.5">
                  <select
                    value={btn.type}
                    onChange={(e) => update(idx, e.target.value === 'url'
                      ? { type: 'url', label: btn.label, url: '' }
                      : { type: 'postback', label: btn.label, payload: '' })}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                  >
                    <option value="postback">postback (独自 payload)</option>
                    <option value="url">URL</option>
                  </select>
                  {btn.type === 'postback' ? (
                    <input
                      type="text"
                      value={btn.payload}
                      onChange={(e) => update(idx, { ...btn, payload: e.target.value })}
                      placeholder="payload 文字列"
                      className="w-full px-2 py-1 border border-gray-300 rounded text-xs font-mono"
                    />
                  ) : (
                    <input
                      type="text"
                      value={btn.url}
                      onChange={(e) => update(idx, { ...btn, url: e.target.value })}
                      placeholder="https://..."
                      className="w-full px-2 py-1 border border-gray-300 rounded text-xs font-mono"
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })}
      {buttons.length < 3 && (
        <button
          type="button"
          onClick={() => onChange([...buttons, { type: 'url', label: '', url: '{REWARD_URL}' }])}
          className="w-full py-1.5 rounded text-xs font-medium border border-dashed border-gray-300 text-gray-500 hover:border-[#E1306C]"
        >
          + ボタン追加（任意）
        </button>
      )}
      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="text-[10px] text-gray-400 hover:text-gray-600"
      >
        {showAdvanced ? '詳細設定を隠す' : '⚙️ 詳細設定（カスタム payload 等）'}
      </button>
    </div>
  )
}

function QuickRepliesEditor({
  text,
  replies,
  onChange,
}: {
  text: string
  replies: Array<{ label: string; payload: string }>
  onChange: (patch: { text?: string; replies?: Array<{ label: string; payload: string }> }) => void
}) {
  const update = (idx: number, patch: Partial<{ label: string; payload: string }>) => {
    onChange({ replies: replies.map((r, i) => (i === idx ? { ...r, ...patch } : r)) })
  }
  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => onChange({ text: e.target.value })}
        placeholder="メッセージテキスト"
        rows={2}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#E1306C]"
      />
      <div className="space-y-1.5">
        {replies.map((r, idx) => (
          <div key={idx} className="flex gap-1.5">
            <input
              type="text"
              value={r.label}
              onChange={(e) => update(idx, { label: e.target.value })}
              placeholder="ラベル"
              className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs"
            />
            <input
              type="text"
              value={r.payload}
              onChange={(e) => update(idx, { payload: e.target.value })}
              placeholder="payload"
              className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs font-mono"
            />
            {replies.length > 1 && (
              <button
                onClick={() => onChange({ replies: replies.filter((_, i) => i !== idx) })}
                className="p-1 text-red-500 hover:bg-red-50 rounded"
                aria-label="削除"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        ))}
        {replies.length < 13 && (
          <button
            onClick={() => onChange({ replies: [...replies, { label: '', payload: '' }] })}
            className="w-full py-1.5 rounded text-xs font-medium border border-dashed border-gray-300 text-gray-500 hover:border-[#E1306C]"
          >
            + クイックリプライ追加
          </button>
        )}
      </div>
    </div>
  )
}
