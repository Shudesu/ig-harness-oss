# トラブルシュート

| 症状 | 確認・復旧 |
|---|---|
| Graph code 190 / 接続確認失敗 | Instagram Login用tokenと `user_id` を確認。ownerで `PATCH /api/accounts/:id` の `accessToken` を更新する。env tokenの変更だけでDBを上書きしない。 |
| Webhook 403 | Instagram App Secret、X-Hub-Signature-256、対象accountのentry.idを確認。別Appの署名で別accountへ流さない。 |
| Webhookが届かない | App側callback/購読とaccount側subscribed_appsの両方、メッセージアクセス、tester承認を確認。 |
| 一斉配信が進まない | `GET /api/broadcasts/:id` のdeliverySummary、cron、受付枠を確認。window_closedは最終inboundから24時間外。uncertainは自動再送しない。 |
| シナリオが終了した | follower_scenariosのend_reasonを確認。window_expiredは期限超過またはinbound不明。 |
| MCP起動しない | `IG_HARNESS_API_URL` / `IG_HARNESS_API_KEY`、実在するdistの絶対パスを確認。Cursor/Claude Desktopは各クライアントの設定へスニペットを統合する。 |
| ブラウザだけAPIに接続できない | ADMIN_ORIGIN（旧互換名ADMIN_ORIGINS）とADMIN_ALLOW_CROSS_SITEを確認。Cookie移行後は再ログインする。 |
| migration失敗 | 表示されたファイル名で停止原因を調査。成功扱いでdeployしない。バックアップパスと適用履歴を保持する。 |
| 暗号化tokenが復号できない | 元のTOKEN_ENCRYPTION_KEYを復元する。新しい鍵を作って既存鍵へ上書きしない。 |
| 削除受付が確認待ち | ownerで対象本人・App・accountを確認後にresolve。signed_request.user_idをIGSIDと決めつけない。 |
| 削除処理が409 | 実行中作業を待って再試行。停止した旧プロセスのactive_mutationsが残る場合は、終了を確認して手動で復旧する。 |

[運用手順](../operations/review-remediation.md)に状態の意味と更新上の注意を記載。ログ・公開Issueにtokenや顧客本文を貼らない。


## Cookie / CSRF の確認（※Codex修正後の挙動）

- `Admin origin is not allowed`: 表示中の管理画面originを許可リストで確認。同じPagesプロジェクトのpreviewは許可される。独自ドメインは完全一致のみ。
- `ADMIN_ALLOW_CROSS_SITE` の設定エラー: Pages↔workers.devではtrueを明示する。`ADMIN_COOKIE_SAMESITE=Lax/Strict` とcross-siteを併用しない。
- 「ログインCookieを確認できません」: サードパーティCookie制限を確認し、同一サイトの独自ドメインまたは同一origin構成を使う。APIキーをブラウザ保存する方式へ自動で戻さない。
- CSRF 403: 管理画面を再読み込みしてsessionのCSRF値を取得する。CSRF Cookie自体が失われている場合は再ログイン。SDK/MCPのBearer呼び出しにはCSRFを要求しない。
- migration履歴はあるがschema確認が失敗: 表示されたtable/columnの実スキーマを確認する。履歴を消して強制再適用せず、バックアップと照合する。

トークン、Cookie値、CSRF値、D1バックアップを公開Issueやチャットへ貼らない。問題報告にはHTTP status、エラー文、originの構成、コミットだけを含める。
