'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { engagementGatesApi, type EngagementGate } from '@/lib/api'
import CampaignWizard from '../../new/campaign-wizard'

/**
 * Same URL-parsing trick as the detail page: Next's static export bakes
 * '_' into useParams(), so we read the id from window.location instead.
 */
function resolveIdFromPath(): string | null {
  if (typeof window === 'undefined') return null
  const match = window.location.pathname.match(/\/campaigns\/([^/]+)\/edit\/?$/)
  if (!match) return null
  const id = decodeURIComponent(match[1])
  if (!id || id === '_') return null
  return id
}

export default function EditCampaignClient() {
  const [id, setId] = useState<string | null>(null)
  const [gate, setGate] = useState<EngagementGate | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setId(resolveIdFromPath())
  }, [])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      try {
        const data = await engagementGatesApi.get(id)
        if (!cancelled) setGate(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'load failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) return <div className="text-sm text-gray-500 p-8">読み込み中...</div>
  if (error || !gate) {
    return (
      <div className="p-8 text-sm">
        <div className="text-red-600 mb-3">{error || 'キャンペーンが見つかりません'}</div>
        <Link href="/campaigns" className="text-[#E1306C] hover:underline">
          ← キャンペーン一覧に戻る
        </Link>
      </div>
    )
  }

  return <CampaignWizard existingGate={gate} />
}
