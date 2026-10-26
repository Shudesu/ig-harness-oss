# リールの表紙を指定する

「投稿」でリールを選び、動画をアップロードしてから「リールの表紙」を設定します。即時投稿・予約投稿の両方で使用できます。

- **自動**: 表紙を指定せず、Instagramの既定の動作を使います。
- **画像をアップロード**: JPG・PNG・WebP（5MB以下）を選びます。画面でJPEGに変換し、縦横比を保ったまま長辺最大1920pxに縮小してR2へ保存します。透過部分は白になります。縦長9:16を推奨します。
- **動画内の位置を指定**: 先頭からの秒数を入力します。0秒も指定できます。動画の長さ未満の位置を選んでください。

表紙指定はリール専用です。画像の表紙はリールタブ用で、Instagramの表示箇所によって切り抜きが異なる場合があります。予約一覧のプレビューは保存した指定の確認用で、Instagram側の反映を確認したものではありません。

## 予約時に画像取得エラーを避ける

画面からのアップロードは期限付き外部リンクを使わず、管理下のR2へ画像を保存します。公開が完了するまで画像一覧から削除しないでください。

Metaは表紙の公開URLを取得します。`WORKER_URL` は実際に画像を配信するURLに合わせ、`/images/<key>` がログイン不要で画像本体を返す必要があります。アプリの認証では画像を公開していますが、Cloudflare Access・WAF等で前段から遮断されていないことも必要です。管理画面全体の保護を解除する必要はありません。

APIから外部の表紙URLを指定する場合は、投稿処理が完了するまで有効なJPEG画像の直リンクを使ってください。共有ページやログインが必要なURLは使えません。入力検証はURL形式の確認であり、外部サーバーへの到達性・画像形式・将来の有効性は保証しません。

表紙を指定した投稿が失敗しても、自動で表紙を外して公開することはありません。失敗理由を確認し、画像を再アップロードして新しい投稿を作成してください。公開済みか不明な場合はInstagram上の投稿状態を確認してから再作成します。

## HTTP API

`POST /api/media-posts` の `media[0]` に `cover_url` または `thumb_offset` を追加します。どちらか一方を指定してください。

```json
{
  "post_type": "reel",
  "media": [{
    "type": "video",
    "url": "https://your-worker.example/images/video.mp4",
    "cover_url": "https://your-worker.example/images/cover.jpg"
  }],
  "caption": "投稿文",
  "scheduled_at": "2026-10-01T09:00:00+09:00"
}
```

動画フレームの場合は `cover_url` を削除して `"thumb_offset": 1500` とします（ミリ秒。1500 = 1.5秒）。`scheduled_at` の省略は即時の公開投稿になります。

`POST /api/images?purpose=reel-cover` はJPEGアップロード用です。通常の画像アップロードAPIと同様に認証が必要で、バイナリまたはbase64 JSONを受け付けます。画像の最大サイズはIG Harness側で5MBに制限し、Content-TypeとJPEGシグネチャを検査します。サーバー側でPNG等を自動変換するAPIではありません。

## SDK / MCP

SDKでは `media[0].coverUrl` または `media[0].thumbOffset` を使います。SDKがHTTPのsnake_caseへ変換します。取得結果の `media` 内もcamelCaseです。

```ts
await client.mediaPosts.create({
  postType: 'reel',
  media: [{ type: 'video', url: videoUrl, coverUrl }],
  scheduledAt: '2026-10-01T09:00:00+09:00',
})
```

MCP `create_media_post` では `media[0].cover_url` / `media[0].thumb_offset` を指定します。Worker・Web・SDK・MCPはこの機能を含むバージョンを揃えて更新してください。旧Workerは新しい指定を扱えません。

## 保存と公式仕様

表紙指定は既存の `media_posts.media` JSON内に保存されます。追加のDBマイグレーションは不要です。指定のない既存予約の動作は変わりません。

Meta公式APIでは `cover_url` が `thumb_offset` より優先されます。両方を渡しても画像取得失敗時の代替にはならないため、IG Harnessの投稿APIでは同時指定を拒否します。

出典: [Meta公式リール投稿サンプル](https://github.com/fbsamples/reels_publishing_apis/blob/main/insta_reels_publishing_api_sample/README.md#cover-url-cover_url)
