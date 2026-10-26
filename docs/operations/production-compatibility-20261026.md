# 本番機能の維持確認（2026-10-26）

PR #29の反映準備で、既存配信ソースにはOSS mainに含まれていないリール表紙指定とCloud管理画面の同一origin API設定があることを確認した。これらを戻さずに更新できるよう、既存実装を新しい配信状態管理へ統合した。

- リール表紙のJPEG化・アップロード、画像URLまたは動画フレーム位置の入力、HTTP/SDK/MCPの受け渡しを維持する。
- 保存済みのmedia JSONからcoverUrl/thumbOffsetを取り出し、即時・予約の両方でMeta要求へ渡す。結果不明時に表紙を省略して再公開しない。
- Cloud用の管理画面はNEXT_PUBLIC_SAME_ORIGIN_API=1を明示してビルドし、相対URLで同一originのAPIを使う。単体Pages向けは引き続きNEXT_PUBLIC_API_URLの指定が必要。
- DB列の追加はない。PR #29の0022までのmigrationが必要。

Worker 245件、Instagram SDK 32件、API SDK 48件のテストと全対象typecheckを通過。表紙のHTTP入力から実SQLiteへの保存、スケジューラ、モックMeta要求までを検証した。Workerの本番bindingを指定したdry-runも通過。

単体本番と代表Cloud環境のスキーマだけを取得し、ローカルSQLite上で0022までの移行・schema検証を通過した。これは本番データ移行の実行結果ではない。実反映前に対象を固定し、D1バックアップ、各DBの実スキーマ、既存秘密・R2・DO bindingを再確認する。

実Meta投稿とブラウザ操作は行っていない。Cloud全環境へ配布する場合は、Cloud用bundle・新規開設schema・TOKEN_ENCRYPTION_KEYの配布を含めた別の反映手順が必要。
