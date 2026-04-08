'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import type { ScenarioApi } from '@/lib/api'
import Header from '@/components/layout/header'

// Worker currently supports these trigger types
const TRIGGER_LABELS: Record<string, string> = {
  friend_add: 'フォロワー追加時',
  tag_added: 'タグ付与時',
  manual: '手動',
  dm_keyword: 'DMキーワード',
  comment: 'コメント',
  follower_add: 'フォロワー追加時',
}

const ACCENT = '#3B82F6'

interface FormState {
  name: string
  triggerType: string
  isActive: boolean
}

const DEFAULT_FORM: FormState = {
  name: '',
  triggerType: 'manual',
  isActive: true,
}

const TRIGGER_OPTIONS = [
  { value: 'manual', label: '手動' },
  { value: 'friend_add', label: 'フォロワー追加時 (friend_add)' },
  { value: 'dm_keyword', label: 'DMキーワード (dm_keyword)' },
  { value: 'comment', label: 'コメント (comment)' },
]

export default function ScenariosPage() {
  const [scenarios, setScenarios] = useState<ScenarioApi[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const loadScenarios = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.scenarios.list()
      if (res.success && res.data) {
        setScenarios(res.data)
      } else {
        setError(res.error || 'エラーが発生しました')
      }
    } catch {
      setError('シナリオの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadScenarios() }, [loadScenarios])

  const handleCreate = async () => {
    if (!form.name.trim()) {
      setFormError('シナリオ名を入力してください')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const res = await api.scenarios.create({
        name: form.name,
        triggerType: form.triggerType,
        triggerTagId: null,
        isActive: form.isActive,
      })
      if (res.success) {
        setShowCreate(false)
        setForm(DEFAULT_FORM)
        loadScenarios()
      } else {
        setFormError(res.error || '作成に失敗しました')
      }
    } catch {
      setFormError('作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (id: string, current: boolean) => {
    try {
      await api.scenarios.update(id, { isActive: !current })
      loadScenarios()
    } catch {
      setError('ステータスの変更に失敗しました')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このシナリオを削除しますか？')) return
    try {
      await api.scenarios.delete(id)
      loadScenarios()
    } catch {
      setError('削除に失敗しました')
    }
  }

  const getTriggerLabel = (triggerType: string) => TRIGGER_LABELS[triggerType] || triggerType

  return (
    <div>
      <Header
        title="シナリオ"
        description="DM自動配信シナリオの管理"
        action={
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: ACCENT }}
          >
            + 新規シナリオ
          </button>
        }
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">新規シナリオを作成</h2>
          <div className="space-y-4 max-w-lg">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">シナリオ名 <span className="text-red-500">*</span></label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="例: ウェルカムDMシナリオ"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">トリガータイプ</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.triggerType}
                onChange={(e) => setForm({ ...form, triggerType: e.target.value })}
              >
                {TRIGGER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="scenarioIsActive"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="scenarioIsActive" className="text-sm text-gray-600">作成後すぐに有効にする</label>
            </div>

            {formError && <p className="text-xs text-red-600">{formError}</p>}

            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={saving}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
                style={{ backgroundColor: ACCENT }}
              >
                {saving ? '作成中...' : '作成'}
              </button>
              <button
                onClick={() => { setShowCreate(false); setFormError('') }}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scenarios list */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse space-y-3">
              <div className="h-4 bg-gray-200 rounded w-3/4" />
              <div className="h-3 bg-gray-100 rounded w-full" />
            </div>
          ))}
        </div>
      ) : scenarios.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-gray-500 text-sm">シナリオがありません</p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-3 text-sm font-medium text-blue-500 hover:opacity-80 transition-opacity"
          >
            + 最初のシナリオを作成
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {scenarios.map((scenario) => (
            <div key={scenario.id} className="bg-white rounded-lg border border-gray-200 p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900 truncate">{scenario.name}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {getTriggerLabel(scenario.triggerType)}
                  </p>
                </div>
                {/* ON/OFF toggle */}
                <button
                  onClick={() => handleToggleActive(String(scenario.id), scenario.isActive)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ml-2 ${
                    scenario.isActive ? 'bg-blue-500' : 'bg-gray-300'
                  }`}
                  title={scenario.isActive ? '無効にする' : '有効にする'}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      scenario.isActive ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  {scenario.stepCount !== undefined && (
                    <span>{scenario.stepCount} ステップ</span>
                  )}
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    scenario.isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {scenario.isActive ? 'アクティブ' : '停止中'}
                  </span>
                </div>
                <button
                  onClick={() => handleDelete(String(scenario.id))}
                  className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  title="削除"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
