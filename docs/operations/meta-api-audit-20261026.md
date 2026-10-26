# Meta API監査の照合と修正（2026-10-26）

対象はIGのみ。監査の基準 `52fbba3` と現在の修正ブランチを比較し、対応済み箇所を作り直さず差分を実装した。以下はローカル実装・検証の記録であり、実Metaアカウントでの送受信成功を意味しない。

## 一次資料で確認したこと

developers.facebook.comはweb取得ツールで429になったため、ブラウザを使わずHTTPで公式HTMLを取得し、本文を確認した。

- コメントへの初回DMはcomment_idを指定するprivate reply。1コメント1通、通常の投稿・リール等は7日以内、Liveは配信中のみ。続きは相手の応答後の通常ウィンドウ内。[Meta Private Replies](https://developers.facebook.com/documentation/instagram-platform/private-replies/?locale=en_US)
- Standard/Advanced Accessは、自分が所有・管理してApp Dashboardへ登録したプロアカウントか、他者のアカウントへ提供するかで条件が分かれる。「スレッド返信はStandardで常に失敗」「トップレベル投稿なら審査回避」は公式資料からは支持されない。[Meta Comment Moderation](https://developers.facebook.com/documentation/instagram-platform/comment-moderation/?locale=en_US)
- Graph API v21.0の一般APIの終了日は2027-01-21。2026-10ではない。Marketing APIの別表と混同しない。既定をv25.0へ変更した。[Graph API versions](https://developers.facebook.com/docs/graph-api/changelog/versions/?locale=en_US)
- 非messagingの一般呼び出しとメッセージング系の制限は別であり、一律「200回/時」の実装はしない。使用率ヘッダーと実エラーを扱う。[Instagram Platform overview](https://developers.facebook.com/documentation/instagram-platform/overview/?locale=en_US)
- 投稿画像はJPEG。コンテナの状態にはIN_PROGRESS、FINISHED、ERROR、EXPIRED、PUBLISHEDがある。[Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing/?locale=en_US)
- 長期tokenは60日。refreshには少なくとも24時間経過した未失効の長期tokenが必要。[Business Login for Instagram](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login/?locale=en_US)

接頭辞IGAA/IGQVJのどちらかだけを正解とはしていない。接頭辞は契約上の認証判定に使わず、graph.instagram.comの実応答とuser_idで検証する。公開APIの版・上限・アクセス条件は変わり得るため、この確認日と対象APIを残す。

## 実装内容

| 監査項目 | 対応 |
|---|---|
| A-1/A-2 導入案内 | Instagram LoginとInstagram用App Secretへ統一済み。接頭辞の断定も除去。Facebook Pageとの紐付けを前提にしない。 |
| A-3 接続検証 | POST/PATCH /api/accountsは保存前に/meを確認。不正token・別user_idは保存しない。新規追加ではID省略時に自動取得。usernameも実応答を使用。確認できるのはprofileであり、全機能のpermissionを確認したとは表示しない。 |
| A-4 broadcast | 24h/主担当の適格性を送信直前に確認。宛先別status・reason・Meta code/subcodeを保存。明確なthrottling拒否だけ待機して再試行。管理画面に送信済み・未送信・対象外・要確認件数を表示。 |
| A-5 scenario/drip | 共通のlast_inbound_at判定へ統一。delivered_atを期限起点にしない。期限外はwindow_expired、standbyは送信しない。処理前claimで競合を防ぎ、送信結果不明なら再送せず履歴を残す。 |
| A-6 comment→DM | 最初はcomment_id宛てのprivate reply。D1のaccount/comment単位のclaimで重複防止。日時不明ならMetaからcomment timestampを確認。Liveコメントは配信中の確認を実装していないので未対応として停止する。 |
| A-7 public reply | 権限回避との断定を除去。既存のルールはスレッド返信、ゲートはトップレベルの配置を維持。DM成功後にのみ公開返信し、失敗をMetaコード付きで表示。公開返信失敗でprivate replyを再送しない。 |
| A-8 deletion | form署名検証・受付記録・本人確認後の削除は既に対応。Meta user_idをIGSIDへ推測変換しない。 |
| A-9 API版 | SDK/Worker/installerの既定は一か所のv25.0。IG_GRAPH_API_VERSIONで上書き可。updateでは明示した環境値だけを反映し、既存のpinを勝手に解除しない。 |
| A-10 rate/health | profileはキャッシュを利用し、コメントのみ/standbyで不要なprofile取得をしない。80002を含むrate error、usage header、Retry-Afterを処理。190は即時healthへ反映。既知の失効・ID不一致では自動配信を止め、監視用probeは継続する。 |
| A-11 standby | 記録専用。トリガー・連携通知・ステップ・特典を送らない。ownershipを保存し、後続配信も止める。通常messageの既存dedupキーは維持。自動take-controlは行わない。 |
| A-12 carousel | 子IDを保存し、全子FINISHED後だけ親を作成。生成・公開のphaseをclaimし、同時実行でも重ねて公開しない。失敗・期限切れ・結果不明を区別。公開上限はAPIのquota_totalを優先し、取得値に上限が無い場合のfallbackは50。 |
| A-13/A-14 docs | Business/Creator、token寿命・再接続、権限対応、購読フィールドを整理。ガイド表示はsubscribed_appsと共通のフィールド定数を使う。 |

## コメントの既存文面を維持するための変更

private replyでは確認済みのテキスト1通の経路を使う。ゲートではinitial_dm_textに返信案内を添え、ユーザーの返信後に元のrich CTA/ボタンを送る。画像・テンプレートのコメントルールは最初に返信依頼を送り、元の内容をDBへ保持したまま返信後に届ける。元の本文・画像を削除したり、黙って短縮したりしない。

既存の「下のボタンを押して」等の初回文面は、公開前にこの応答フローに合うか確認する。コメント起点のシナリオも相手のinboundまで待機する。結果不明の再送はしない。明確な未送信エラーは記録を残し、再接続後の新しいコメントで再開できる。

## Tokenとpermissionの扱い

- 登録時の/me成功は、DM・コメント・投稿の全permissionや長期tokenであることを保証しない。画面でもその範囲を明記する。
- 失効時はMetaで新しい長期tokenを取得し、設定画面から更新する。更新失敗時は既存の暗号化credentialを保持する。
- 以前の登録でidとuser_idが混同されている場合はhealthにaccount_id_mismatchを表示し、自動配信しない。別アカウントへ履歴を誤移管しないため、自動でIDを置換しない。既存履歴とApp/アカウントを照合して修復する。
- IG_REQUIRE_APPSECRET_PROOF=trueを設定した環境では、Graph要求とrefreshにHMAC-SHA256のappsecret_proofを付ける。API tokenや生のGraphエラー本文はログへ出さない。
- 通常DMは本実装では24hを上限とする。広告経路やHUMAN_AGENTの例外は自動適用しない。人手サポートの拡張枠は別の権限確認・設計が必要。

## 反映前の確認

0022_meta_delivery_policy.sqlは追加的変更のみ。古いqueueはlegacy_dmとして保持し、新規のコメント処理をprivate replyへ切り替える。Workerと管理画面を対応するソースで更新する。バックアップ、対象DB/アカウント、実スキーマを確認してから反映する。

画像投稿の画面はJPEGを選ぶ。DM用アップロードのPNG等は維持する。本製品のカルーセル入力上限は10のままとし、ネイティブアプリや別APIの20件を未検証のまま流用しない。公開URL・JPEG・コンテナ有効期限・Metaの実quotaを確認する。

実Metaのsubscription、secret、profile、permission、private replyの到達、postback、メディア公開は、コード上のHTTP/DBテストだけでは証明できない。公開・本番反映・実送信はこの作業では行っていない。

## 検証結果

- Worker 213件、ig-sdk 25件、SDK 46件、installer 14件、migration/policy/read-retry 8件、MCP stdio 1件、計307件を通過。HTTPはモック、DBは実migration適用済みのローカルSQLiteを使用。
- 同じコメントへの並行要求、7日経過、24h経過、standby、停止中ゲート、明確な制限拒否、送信結果不明、画像による応答後の再開を確認。配信状況APIのaccount分離も確認。
- 全対象typecheck、各パッケージ・Worker・管理画面buildを通過。管理画面は検証用NEXT_PUBLIC_API_URL=https://worker.exampleを指定。接続先未指定のbuildは設定ガードで停止することも確認した。
- 外部ディスク上でNext buildと同時実行した際に一部テストが5秒制限に達したが、build終了後のWorker全213件は既定timeoutのまま通過した。
- migration policyは22ファイル通過。ローカルD1へ0022を適用済み。実Meta送信・リモートD1変更・公開PR・本番deployは未実施。
