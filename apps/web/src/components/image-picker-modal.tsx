'use client'

import { useCallback, useEffect, useState } from 'react'
import { imagesApi, type UploadedImageItem } from '@/lib/api'

interface Props {
  open: boolean
  onClose: () => void
  onPick: (url: string) => void
}

export default function ImagePickerModal({ open, onClose, onPick }: Props) {
  const [items, setItems] = useState<UploadedImageItem[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const all = await imagesApi.listAll()
      setItems(all.sort((a, b) => b.uploaded.localeCompare(a.uploaded)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load images')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const handleUpload = async (file: File) => {
    setUploading(true)
    setError('')
    let uploadedUrl: string | null = null
    try {
      const uploaded = await imagesApi.upload(file)
      uploadedUrl = uploaded.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed')
      setUploading(false)
      return
    }
    // Upload succeeded — commit the pick even if the gallery refresh fails.
    onPick(uploadedUrl)
    onClose()
    setUploading(false)
    // Fire-and-forget refresh so a listing failure doesn't surface as
    // "upload failed" to the operator.
    load().catch(() => {})
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">画像を選択</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="閉じる">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-4 border-b border-gray-200">
          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium cursor-pointer hover:bg-gray-50">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            {uploading ? 'アップロード中...' : '画像をアップロード'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleUpload(f)
                e.target.value = ''
              }}
            />
          </label>
          {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center text-sm text-gray-400 py-12">読み込み中...</div>
          ) : items.length === 0 ? (
            <div className="text-center text-sm text-gray-400 py-12">
              まだ画像がありません。上のボタンからアップロードしてください。
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {items.map((img) => (
                <button
                  key={img.key}
                  onClick={() => {
                    onPick(img.url)
                    onClose()
                  }}
                  className="group relative aspect-square rounded-lg border border-gray-200 overflow-hidden hover:border-[#E1306C] transition-colors"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                    <span className="opacity-0 group-hover:opacity-100 text-white text-xs font-medium">選択</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
