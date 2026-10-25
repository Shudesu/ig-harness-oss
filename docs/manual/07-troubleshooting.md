# トラブルシュート

| 症状 | 確認・復旧 |
|---|---|
| Graph code 190 / 接続確認失敗 | Instagram Login用tokenと `user_id` を確認。ownerで `PATCH /api/accounts/:id` の `accessToken` を更新する。env tokenの変更だけでDBを上書きしない。 |
| Webhook 403 | Instagram App Secret、X-Hub-Signature-256、対象accountのentry.idを確認。別Appの署名で別accountへ流さない。 |
| Webhookが届かない | App側callback/購読とaccount側subscribed_appsの両方、メッセージアクセス、tester承認を確認。 |
| 一斉配信が進まない | `GET /api/broadcasts/:id` のdeliverySummary、cron、受付枠を確認。window_closedは最終inboundから24時間外。uncertainは自動再送しない。 |
| シナリオが終了した | follower_scenariosのend_reasonを確認。window_expiredは期限超過またはinbound不明。 |
| MCP起動しない | `IG_HARNESS_API_URL` / `IG_HARNESS_API_KEY`、実在するdistの絶対パスを確認。Cursor/Claude Desktopは各クライアントの設定へスニペットを統合する。 |
| ブラウザだけAPIに接続できない | 管理画面originがADMIN_ORIGINSに含まれるか確認。sessionStorageを使用するため再ログインも確認。 |
| migration失敗 | 表示されたファイル名で停止原因を調査。成功扱いでdeployしない。バックアップパスと適用履歴を保持する。 |
| 暗号化tokenが復号できない | 元のTOKEN_ENCRYPTION_KEYを復元する。新しい鍵を作って既存鍵へ上書きしない。 |
| 削除受付が確認待ち | ownerで対象本人・App・accountを確認後にresolve。signed_request.user_idをIGSIDと決めつけない。 |
| 削除処理が409 | 実行中作業を待って再試行。停止した旧プロセスのactive_mutationsが残る場合は、終了を確認して手動で復旧する。 |

[運用手順](../operations/review-remediation.md)に状態の意味と更新上の注意を記載。ログ・公開Issueにtokenや顧客本文を貼らない。
