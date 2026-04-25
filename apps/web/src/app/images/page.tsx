'use client'

import { useCallback, useEffect, useState } from 'react'
import { imagesApi, richMessagesApi, type RichMessageBlock, type UploadedImageItem } from '@/lib/api'
import Header from '@/components/layout/header'

const ACCENT = '#E1306C'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Recursively scan blocks for a match on the given image URL. Used to warn
 * before deleting images that a live rich message still references.
 */
function blocksReferenceUrl(blocks: RichMessageBlock[], url: string): boolean {
  return blocks.some((b) => {
    if (b.type === 'image' && b.url === url) return true
    if (b.type === 'card' && b.image_url === url) return true
    if (b.type === 'carousel' && b.cards.some((c) => c.image_url === url)) return true
    return false
  })
}

export default function ImagesPage() {
  const [items, setItems] = useState<UploadedImageItem[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [listTruncated, setListTruncated] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const maxPages = 20
      const pageSize = 200
      const out: UploadedImageItem[] = []
      let cursor: string | undefined
      let truncated = false
      for (let page = 0; page < maxPages; page++) {
        const res = await imagesApi.list(cursor, pageSize)
        out.push(...res.items)
        if (!res.cursor) break
        cursor = res.cursor
        if (page === maxPages - 1 && res.cursor) truncated = true
      }
      setItems(out.sort((a, b) => b.uploaded.localeCompare(a.uploaded)))
      setListTruncated(truncated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load images')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setError('')
    try {
      for (const file of Array.from(files)) {
        await imagesApi.upload(file)
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (img: UploadedImageItem) => {
    // Check if any rich message references this image URL before deleting —
    // otherwise live templates would point at a dead asset.
    let referencingNames: string[] = []
    try {
      const allMessages = await richMessagesApi.list()
      referencingNames = allMessages
        .filter((m) => blocksReferenceUrl(m.blocks, img.url))
        .map((m) => m.name)
    } catch {
      // If the lookup itself fails, warn but don't block — operator can force.
    }

    if (referencingNames.length > 0) {
      const proceed = confirm(
        `この画像は ${referencingNames.length} 件のリッチメッセージで使用中です：\n\n` +
          referencingNames.map((n) => `・${n}`).join('\n') +
          '\n\n削除するとこれらのメッセージで画像が表示されなくなります。本当に削除しますか？',
      )
      if (!proceed) return
    } else if (!confirm(`${img.original_filename ?? img.key} を削除しますか？`)) {
      return
    }

    try {
      await imagesApi.remove(img.key)
      await load()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'delete failed')
    }
  }

  const copyUrl = (url: string, key: string) => {
    navigator.clipboard.writeText(url)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 1500)
  }

  return (
    <div>
      <Header title="画像ギャラリー" description="R2 にアップロード済みの画像（リッチメッセージで使用）" />

      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm text-gray-500">
          {loading ? '読み込み中...' : `${items.length} 件`}
        </div>
        <label
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white cursor-pointer"
          style={{ backgroundColor: ACCENT, opacity: uploading ? 0.6 : 1 }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          {uploading ? 'アップロード中...' : 'アップロード'}
          <input
            type="file"
            multiple
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              handleUpload(e.target.files)
              e.target.value = ''
            }}
          />
        </label>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {listTruncated && (
        <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-sm text-yellow-800">
          ⚠️ 画像が 4,000 件を超えているため、一部のみ表示中です。R2 のキーは UUID 順で並んでいるため、表示されていない画像があります。
        </div>
      )}

      {!loading && items.length === 0 && !error && (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
          <div className="text-gray-400 text-sm">まだ画像がありません</div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {items.map((img) => (
          <div key={img.key} className="bg-white rounded-lg border border-gray-200 overflow-hidden group">
            <div className="aspect-square bg-gray-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt="" className="w-full h-full object-cover" />
            </div>
            <div className="px-3 py-2">
              <div className="text-[11px] text-gray-600 truncate font-medium" title={img.original_filename ?? img.key}>
                {img.original_filename ?? img.key}
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5">
                {formatSize(img.size)} · {img.uploaded.slice(0, 10)}
              </div>
            </div>
            <div className="border-t border-gray-100 flex">
              <button
                onClick={() => copyUrl(img.url, img.key)}
                className="flex-1 px-2 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
              >
                {copiedKey === img.key ? '✓ コピー済み' : 'URL'}
              </button>
              <button
                onClick={() => handleDelete(img)}
                className="px-3 py-1.5 text-[11px] font-medium text-red-500 hover:bg-red-50"
              >
                削除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
