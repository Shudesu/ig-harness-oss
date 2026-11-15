'use client'

import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { formsApi, type FormApi, type FormField, type FormSubmissionApi } from '@/lib/api'
import { formatDateTime } from '@/lib/meta-errors'

const ACCENT = '#E1306C'

const FIELD_TYPES: Array<{ value: FormField['type']; label: string }> = [
  { value: 'text', label: '1行テキスト' },
  { value: 'textarea', label: '複数行テキスト' },
  { value: 'email', label: 'メールアドレス' },
  { value: 'tel', label: '電話番号' },
]

type DraftField = { label: string; type: FormField['type']; required: boolean }

const EMPTY_FIELD: DraftField = { label: '', type: 'text', required: false }

function Submissions({ form }: { form: FormApi }) {
  const [rows, setRows] = useState<FormSubmissionApi[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    formsApi.submissions(form.id)
      .then((r) => { if (active) setRows(r) })
      .catch(() => { if (active) setError('回答を取得できませんでした') })
    return () => { active = false }
  }, [form.id])
  const labelOf = (key: string) => form.fields.find((f) => f.name === key)?.label ?? key
  if (error) return <p className="text-xs text-red-600">{error}</p>
  if (!rows) return <p className="text-xs text-kumo-subtle">読み込み中...</p>
  if (rows.length === 0) return <p className="text-xs text-kumo-subtle">まだ回答はありません</p>
  return (
    <ul className="space-y-2">
      {rows.map((s) => (
        <li key={s.id} className="rounded-lg border border-kumo-line bg-kumo-canvas px-3 py-2">
          <div className="text-[11px] text-kumo-subtle mb-1">
            {formatDateTime(s.createdAt)}{s.friendName ? ` ／ ${s.friendName}` : ''}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            {Object.entries(s.data).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-kumo-subtle">{labelOf(k)}</dt>
                <dd className="text-kumo-default break-words">{Array.isArray(v) ? v.join(', ') : String(v ?? '')}</dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  )
}

export default function FormsPage() {
  const [forms, setForms] = useState<FormApi[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [fields, setFields] = useState<DraftField[]>([{ label: 'お名前', type: 'text', required: true }])
  const [saving, setSaving] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setForms(await formsApi.list())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'フォームの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const updateField = (i: number, patch: Partial<DraftField>) =>
    setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))

  const handleCreate = async () => {
    const filled = fields.filter((f) => f.label.trim())
    if (!name.trim()) { setError('フォーム名を入力してください'); return }
    if (filled.length === 0) { setError('項目を1つ以上入力してください'); return }
    setSaving(true)
    setError('')
    try {
      await formsApi.create({
        name: name.trim(),
        description: description.trim() || null,
        fields: filled.map((f, i) => ({ name: `field_${i + 1}`, label: f.label.trim(), type: f.type, required: f.required })),
      })
      setName('')
      setDescription('')
      setFields([{ label: 'お名前', type: 'text', required: true }])
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'フォームの作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (f: FormApi) => {
    setError('')
    try {
      await formsApi.update(f.id, { isActive: !f.isActive })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新に失敗しました')
    }
  }

  const handleDelete = async (f: FormApi) => {
    if (!confirm(`フォーム「${f.name}」を削除しますか？\n回答データも参照できなくなります。`)) return
    setError('')
    try {
      await formsApi.remove(f.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除に失敗しました')
    }
  }

  return (
    <div>
      <Header title="フォーム" description="アンケート・申込フォームを作成し、回答を確認します" />
      {error && <div role="alert" className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

      <section className="mb-6 bg-kumo-base rounded-xl border border-kumo-line p-5">
        <h2 className="text-sm font-semibold text-kumo-default mb-3">フォームを作成</h2>
        <div className="space-y-3 max-w-xl">
          <div>
            <label htmlFor="form-name" className="block text-xs font-medium text-kumo-subtle mb-1">フォーム名</label>
            <input id="form-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 無料相談の申込"
              className="w-full px-3 py-2 border border-kumo-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C]" />
          </div>
          <div>
            <label htmlFor="form-desc" className="block text-xs font-medium text-kumo-subtle mb-1">説明（任意）</label>
            <input id="form-desc" value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-kumo-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C]" />
          </div>
          <div>
            <span className="block text-xs font-medium text-kumo-subtle mb-1">項目</span>
            <div className="space-y-2">
              {fields.map((f, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input aria-label={`項目${i + 1}の名前`} value={f.label} onChange={(e) => updateField(i, { label: e.target.value })} placeholder="項目名"
                    className="flex-1 min-w-[140px] px-3 py-1.5 border border-kumo-line rounded-lg text-sm" />
                  <select aria-label={`項目${i + 1}の種類`} value={f.type} onChange={(e) => updateField(i, { type: e.target.value as FormField['type'] })}
                    className="px-2 py-1.5 border border-kumo-line rounded-lg text-sm bg-kumo-base">
                    {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <label className="flex items-center gap-1 text-xs text-kumo-default">
                    <input type="checkbox" checked={f.required} onChange={(e) => updateField(i, { required: e.target.checked })} />必須
                  </label>
                  {fields.length > 1 && (
                    <button type="button" onClick={() => setFields((prev) => prev.filter((_, idx) => idx !== i))}
                      className="px-2 py-1 text-xs text-red-500" aria-label={`項目${i + 1}を削除`}>×</button>
                  )}
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setFields((prev) => [...prev, { ...EMPTY_FIELD }])}
              className="mt-2 text-xs underline text-kumo-subtle">+ 項目を追加</button>
          </div>
          <button type="button" onClick={handleCreate} disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={{ backgroundColor: ACCENT }}>
            {saving ? '作成中...' : 'フォームを作成'}
          </button>
        </div>
      </section>

      <section className="bg-kumo-base rounded-xl border border-kumo-line p-5">
        <h2 className="text-sm font-semibold text-kumo-default mb-3">フォーム一覧</h2>
        {loading ? (
          <p className="text-sm text-kumo-subtle">読み込み中...</p>
        ) : forms.length === 0 ? (
          <p className="text-sm text-kumo-subtle">フォームがありません</p>
        ) : (
          <ul className="divide-y divide-kumo-line">
            {forms.map((f) => (
              <li key={f.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-kumo-default">{f.name}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${f.isActive ? 'bg-green-100 text-green-700' : 'bg-kumo-tint text-kumo-subtle'}`}>
                        {f.isActive ? '受付中' : '停止中'}
                      </span>
                    </div>
                    {f.description && <p className="text-xs text-kumo-subtle mt-0.5">{f.description}</p>}
                    <p className="text-[11px] text-kumo-subtle mt-1">
                      項目: {f.fields.map((x) => x.label).join('、') || '—'} ／ 回答 {f.submitCount}件 ／ 作成 {formatDateTime(f.createdAt)}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button type="button" onClick={() => setOpenId(openId === f.id ? null : f.id)}
                      className="px-2 py-1 text-xs border border-kumo-line rounded hover:bg-kumo-tint">
                      {openId === f.id ? '回答を閉じる' : `回答を見る（${f.submitCount}）`}
                    </button>
                    <button type="button" onClick={() => handleToggle(f)} className="px-2 py-1 text-xs border border-kumo-line rounded hover:bg-kumo-tint">
                      {f.isActive ? '受付停止' : '受付再開'}
                    </button>
                    <button type="button" onClick={() => handleDelete(f)} className="px-2 py-1 text-xs text-red-500 border border-red-200 rounded hover:bg-red-50">
                      削除
                    </button>
                  </div>
                </div>
                {openId === f.id && <div className="mt-3"><Submissions form={f} /></div>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
