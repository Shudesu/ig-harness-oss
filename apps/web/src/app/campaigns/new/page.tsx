'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { engagementGatesApi } from '@/lib/api'

type TriggerType = 'comment_on_post' | 'dm_keyword' | 'story_mention'

interface FormState {
  name: string
  trigger_type: TriggerType
  target_post_id: string
  trigger_keyword: string
  require_follow: 1 | 0
  initial_dm_text: string
  initial_dm_button_label: string
  follow_reminder_dm_text: string
  follow_reminder_button_label: string
  reward_dm_text: string
  reward_url: string
  max_loops: number
}

const DEFAULT_FORM: FormState = {
  name: '',
  trigger_type: 'comment_on_post',
  target_post_id: '',
  trigger_keyword: '',
  require_follow: 1,
  initial_dm_text: '特典の準備ができました！下のボタンを押してね',
  initial_dm_button_label: '特典を受け取る',
  follow_reminder_dm_text: 'まずは @ をフォローしてから、もう一度このボタンを押してね',
  follow_reminder_button_label: 'フォローしたよ',
  reward_dm_text: '🎁 ありがとう！特典はこちらだよ',
  reward_url: '',
  max_loops: 0,
}

export default function NewCampaignPage() {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('キャンペーン名を入力してください')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const gate = await engagementGatesApi.create({
        ...form,
        target_post_id: form.target_post_id || null,
        trigger_keyword: form.trigger_keyword || null,
        reward_url: form.reward_url || null,
      })
      router.push(`/campaigns/${gate.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '作成に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">新規キャンペーン</h1>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="名前" required>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            required
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
          />
        </Field>

        <Field label="トリガータイプ">
          <select
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400"
            value={form.trigger_type}
            onChange={(e) => update('trigger_type', e.target.value as TriggerType)}
          >
            <option value="comment_on_post">コメント (指定ポスト)</option>
            <option value="dm_keyword">DM キーワード</option>
            <option value="story_mention">ストーリーメンション</option>
          </select>
        </Field>

        {form.trigger_type === 'comment_on_post' && (
          <Field label="対象ポスト ID (空欄=全ポスト)">
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              value={form.target_post_id}
              onChange={(e) => update('target_post_id', e.target.value)}
            />
          </Field>
        )}

        <Field label="キーワード (空欄=全マッチ)">
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            value={form.trigger_keyword}
            onChange={(e) => update('trigger_keyword', e.target.value)}
          />
        </Field>

        <Field label="フォロー必須">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="w-4 h-4 rounded border-gray-300"
              checked={form.require_follow === 1}
              onChange={(e) => update('require_follow', e.target.checked ? 1 : 0)}
            />
            <span>フォローしていないユーザーにはリマインドを送る</span>
          </label>
        </Field>

        <Field label="初回 CTA DM 本文">
          <textarea
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
            rows={3}
            value={form.initial_dm_text}
            onChange={(e) => update('initial_dm_text', e.target.value)}
          />
        </Field>

        <Field label="初回 CTA ボタンラベル">
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            value={form.initial_dm_button_label}
            onChange={(e) => update('initial_dm_button_label', e.target.value)}
          />
        </Field>

        <Field label="フォロー未達リマインド DM">
          <textarea
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
            rows={3}
            value={form.follow_reminder_dm_text}
            onChange={(e) => update('follow_reminder_dm_text', e.target.value)}
          />
        </Field>

        <Field label="リマインドボタンラベル">
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            value={form.follow_reminder_button_label}
            onChange={(e) => update('follow_reminder_button_label', e.target.value)}
          />
        </Field>

        <Field label="特典 DM 本文">
          <textarea
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
            rows={3}
            value={form.reward_dm_text}
            onChange={(e) => update('reward_dm_text', e.target.value)}
          />
        </Field>

        <Field label="特典 URL (LINE Harness tracked link 推奨)">
          <input
            type="url"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            placeholder="https://line-harness.example.com/r/xxx?form=yyy&ig={IGSID}"
            value={form.reward_url}
            onChange={(e) => update('reward_url', e.target.value)}
          />
          <p className="text-xs text-gray-500 mt-1">
            ※ クロス連携には URL に <code>?ig={'{'}IGSID{'}'}</code> を含めてください。LINE Harness 側で IGSID が自動展開されます。
          </p>
        </Field>

        <Field label="最大ループ回数 (0=無制限)">
          <input
            type="number"
            min={0}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            value={form.max_loops}
            onChange={(e) => update('max_loops', Number(e.target.value))}
          />
        </Field>

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2 min-h-[44px] text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? '作成中...' : '作成'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/campaigns')}
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            キャンセル
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
    </div>
  )
}
