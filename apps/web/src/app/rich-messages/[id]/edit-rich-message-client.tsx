'use client'

import { useEffect, useState } from 'react'
import { richMessagesApi, type RichMessage } from '@/lib/api'
import RichMessageBuilder from '../rich-message-builder'

/**
 * Next.js's static export bakes generateStaticParams values ('_') into
 * the client bundle's route params, so useParams() returns '_' even when
 * the browser URL is /rich-messages/<real-uuid>/ served via CF Pages
 * _redirects rewrite. Read from window.location instead to get the real
 * path segment the user is actually on.
 */
function resolveIdFromPath(): string | null {
  if (typeof window === 'undefined') return null
  const match = window.location.pathname.match(/\/rich-messages\/([^/]+)\/?$/)
  if (!match) return null
  const id = decodeURIComponent(match[1])
  if (!id || id === '_') return null
  return id
}

export default function EditRichMessageClient() {
  const [id, setId] = useState<string | null>(null)
  const [existing, setExisting] = useState<RichMessage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Resolve once on mount — the URL is stable for this page view.
  useEffect(() => {
    setId(resolveIdFromPath())
  }, [])

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setError('')
    let cancelled = false
    ;(async () => {
      try {
        const data = await richMessagesApi.get(id)
        if (cancelled) return
        if (!data) {
          setError('DMテンプレートが見つかりません (id: ' + id + ')')
        } else {
          setExisting(data)
        }
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

  // If the URL didn't give us a usable id (direct hit on /rich-messages/_/),
  // surface that instead of a permanent loading spinner.
  useEffect(() => {
    if (id === null && typeof window !== 'undefined') {
      // Give the first effect a tick to run.
      const t = setTimeout(() => {
        if (resolveIdFromPath() === null) {
          setError('URL から ID を取得できませんでした')
          setLoading(false)
        }
      }, 50)
      return () => clearTimeout(t)
    }
  }, [id])

  if (loading) return <div className="text-sm text-gray-500 p-8">読み込み中...</div>
  if (error) return <div className="text-sm text-red-600 p-8">{error}</div>
  if (!existing) return <div className="text-sm text-gray-500 p-8">データなし</div>

  return <RichMessageBuilder existing={existing} />
}
