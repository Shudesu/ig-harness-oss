/** Normalize cover uploads to JPEG, without changing their aspect ratio. */
export async function prepareReelCover(file: File): Promise<File> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('表紙はJPG・PNG・WebP画像を選択してください')
  }
  if (file.size > 5 * 1024 * 1024) throw new Error('表紙は5MB以下の画像を選択してください')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('表紙画像を読み込めませんでした。別の画像を選択してください')
  }
  try {
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('表紙画像を変換できませんでした')
    // JPEG has no alpha channel; preserve transparent artwork against white.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (!blob || blob.type !== 'image/jpeg' || blob.size > 5 * 1024 * 1024) {
      throw new Error('表紙画像を変換できませんでした。小さい画像を選択してください')
    }
    return new File([blob], 'reel-cover.jpg', { type: 'image/jpeg' })
  } finally {
    bitmap.close()
  }
}
