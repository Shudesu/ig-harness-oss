'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  mediaPostsApi,
  type MediaPostApi,
  type MediaPostMediaItem,
  type MediaPostType,
} from '@/lib/api'
import Header from '@/components/layout/header'

const TYPE_LABELS: Record<MediaPostType, string> = {
  feed_image: 'フィード画像',
  carousel: 'カルーセル',
  reel: 'リール',
  story: 'ストーリー',
}

const STATUS_BADGES: Record<string, { label: string; bg: string; fg: string }> = {
  scheduled: { label: '予約済み', bg: '#EFF6FF', fg: '#1D4ED8' },
  processing: { label: '処理中', bg: '#FEF9C3', fg: '#A16207' },
  published: { label: '公開済み', bg: '#ECFDF5', fg: '#047857' },
  failed: { label: '失敗', bg: '#FEF2F2', fg: '#B91C1C' },
  canceled: { label: 'キャンセル', bg: '#F3F4F6', fg: '#6B7280' },
}

function acceptForType(postType: MediaPostType): string {
  if (postType === 'reel') return 'video/mp4,video/quicktime'
  if (postType === 'feed_image') return 'image/png,image/jpeg,image/gif,image/webp'
  return 'image/png,image/jpeg,image/gif,image/webp,video/mp4,video/quicktime'
}

export default function PostsPage() {
  const [posts, setPosts] = useState<MediaPostApi[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [quota, setQuota] = useState<{ quotaUsage: number; quotaTotal: number } | null>(null)

  // form state
  const [postType, setPostType] = useState<MediaPostType>('feed_image')
  const [mediaItems, setMediaItems] = useState<MediaPostMediaItem[]>([])
  const [caption, setCaption] = useState('')
  const [mode, setMode] = useState<'now' | 'schedule'>('now')
  const [scheduledAt, setScheduledAt] = useState('')
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [items, limit] = await Promise.all([
        mediaPostsApi.list(),
        mediaPostsApi.publishingLimit().catch(() => null),
      ])
      setPosts(items)
      setQuota(limit)
    } catch (err) {
      setError(err instanceof Error ? err.message : '読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setFormError('')
    try {
      const uploaded: MediaPostMediaItem[] = []
      for (const file of Array.from(files)) {
        const { url } = await mediaPostsApi.uploadMedia(file)
        uploaded.push({ url, type: file.type.startsWith('video/') ? 'video' : 'image' })
      }
      setMediaItems((prev) => [...prev, ...uploaded])
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'アップロードに失敗しました')
    } finally {
      setUploading(false)
    }
  }

  const submit = async () => {
    setFormError('')
    if (mediaItems.length === 0) {
      setFormError('メディアをアップロードしてください')
      return
    }
    if (mode === 'schedule' && !scheduledAt) {
      setFormError('予約日時を指定してください')
      return
    }
    setSubmitting(true)
    try {
      await mediaPostsApi.create({
        postType,
        media: mediaItems,
        caption: caption || undefined,
        scheduledAt: mode === 'schedule' ? new Date(scheduledAt).toISOString() : undefined,
      })
      setMediaItems([])
      setCaption('')
      setScheduledAt('')
      setMode('now')
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '投稿の作成に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  const cancel = async (id: string) => {
    if (!window.confirm('この予約投稿をキャンセルしますか?')) return
    try {
      await mediaPostsApi.cancel(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'キャンセルに失敗しました')
    }
  }

  const publishNow = async (id: string) => {
    if (!window.confirm('今すぐ公開しますか? Instagram に公開投稿されます。')) return
    try {
      await mediaPostsApi.publishNow(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '公開に失敗しました')
    }
  }

  return (
    <div>
      <Header title="投稿" />
      <div style={{ maxWidth: 960 }}>
        {quota && (
          <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 16 }}>
            24時間の投稿枠: {quota.quotaUsage}/{quota.quotaTotal}
          </p>
        )}

        {/* ─── 新規投稿フォーム ─── */}
        <section style={{ border: '1px solid #E5E7EB', borderRadius: 12, padding: 20, marginBottom: 32 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>新規投稿</h2>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {(Object.keys(TYPE_LABELS) as MediaPostType[]).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setPostType(t)
                  setMediaItems([])
                }}
                style={{
                  padding: '6px 14px',
                  borderRadius: 20,
                  border: '1px solid',
                  borderColor: postType === t ? '#E1306C' : '#D1D5DB',
                  background: postType === t ? '#FDF2F8' : 'white',
                  color: postType === t ? '#E1306C' : '#374151',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          <input
            type="file"
            accept={acceptForType(postType)}
            multiple={postType === 'carousel'}
            onChange={(e) => void handleFiles(e.target.files)}
            disabled={uploading}
          />
          {uploading && <p style={{ fontSize: 13 }}>アップロード中…</p>}

          {mediaItems.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
              {mediaItems.map((item, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  {item.type === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.url} alt="" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8 }} />
                  ) : (
                    <video src={item.url} style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8 }} />
                  )}
                  <button
                    onClick={() => setMediaItems((prev) => prev.filter((_, j) => j !== i))}
                    style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, border: 'none', background: '#111827', color: 'white', fontSize: 11, cursor: 'pointer' }}
                    aria-label="削除"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {postType !== 'story' && (
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="キャプション(ハッシュタグ可)"
              rows={4}
              style={{ width: '100%', border: '1px solid #D1D5DB', borderRadius: 8, padding: 10, fontSize: 14, marginTop: 8 }}
            />
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12 }}>
            <label style={{ fontSize: 14 }}>
              <input type="radio" checked={mode === 'now'} onChange={() => setMode('now')} /> 今すぐ投稿
            </label>
            <label style={{ fontSize: 14 }}>
              <input type="radio" checked={mode === 'schedule'} onChange={() => setMode('schedule')} /> 日時指定
            </label>
            {mode === 'schedule' && (
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                style={{ border: '1px solid #D1D5DB', borderRadius: 8, padding: 6 }}
              />
            )}
          </div>
          {mode === 'schedule' && (
            <p style={{ fontSize: 12, color: '#9CA3AF', marginTop: 4 }}>
              ※ 公開は指定時刻から最大5分ずれます(5分毎のバッチ処理)
            </p>
          )}

          {formError && <p style={{ color: '#B91C1C', fontSize: 13, marginTop: 8 }}>{formError}</p>}

          <button
            onClick={() => void submit()}
            disabled={submitting || uploading}
            style={{ marginTop: 16, padding: '10px 24px', borderRadius: 8, border: 'none', background: '#E1306C', color: 'white', fontWeight: 600, cursor: 'pointer', opacity: submitting ? 0.6 : 1 }}
          >
            {submitting ? '送信中…' : mode === 'now' ? '投稿する' : '予約する'}
          </button>
        </section>

        {/* ─── 投稿一覧 ─── */}
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>投稿一覧</h2>
        {error && <p style={{ color: '#B91C1C', fontSize: 13 }}>{error}</p>}
        {loading ? (
          <p>読み込み中…</p>
        ) : posts.length === 0 ? (
          <p style={{ color: '#6B7280', fontSize: 14 }}>投稿はまだありません</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {posts.map((post) => {
              const badge = STATUS_BADGES[post.status] ?? STATUS_BADGES.canceled
              return (
                <div key={post.id} style={{ border: '1px solid #E5E7EB', borderRadius: 12, padding: 16, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                  {post.media[0] && post.media[0].type === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={post.media[0].url} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 72, height: 72, borderRadius: 8, background: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>🎬</div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, padding: '2px 10px', borderRadius: 10, background: badge.bg, color: badge.fg, fontWeight: 600 }}>{badge.label}</span>
                      <span style={{ fontSize: 13, color: '#374151' }}>{TYPE_LABELS[post.postType]}</span>
                      {post.postType === 'carousel' && (
                        <span style={{ fontSize: 12, color: '#9CA3AF' }}>{post.media.length}枚</span>
                      )}
                    </div>
                    {post.caption && (
                      <p style={{ fontSize: 13, color: '#4B5563', margin: '4px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{post.caption}</p>
                    )}
                    <p style={{ fontSize: 12, color: '#9CA3AF', margin: 0 }}>
                      {post.status === 'scheduled' ? `予約: ${post.scheduledAt}` : `更新: ${post.updatedAt}`}
                      {post.publishedMediaId && ` / media_id: ${post.publishedMediaId}`}
                    </p>
                    {post.error && (
                      <p style={{ fontSize: 12, color: '#B91C1C', marginTop: 4 }}>{post.error}</p>
                    )}
                  </div>
                  {post.status === 'scheduled' && (
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <button onClick={() => void publishNow(post.id)} style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, border: '1px solid #E1306C', background: 'white', color: '#E1306C', cursor: 'pointer' }}>今すぐ公開</button>
                      <button onClick={() => void cancel(post.id)} style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, border: '1px solid #D1D5DB', background: 'white', color: '#6B7280', cursor: 'pointer' }}>キャンセル</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
