# 旧ログイン → 統合ログイン ID 照合チェック（B-17, 2026-11-16）

移行するかどうかの判断材料を集めるための手順。**読み取りだけで済み、状態は変えない。**
実機（Meta アカウント）が必要なため、このドキュメントは手順の確定を目的とする。

## 目的

旧ログイン（Instagram Login, `IGAA…` / `graph.instagram.com`）と統合ログイン
（Facebook Login / Unified login, `EAA…` / `graph.facebook.com`）で、同じ
Instagram アカウントの ID 体系が一致するかを確認する。一致しない場合、
移行するとフォロワー履歴・24時間窓・ゲート進捗が別人扱いになる
（SCREENING.md 4章のリスク表）。

## 手順（同一アカウントで両方式のトークンが取れる間に実施）

1. **`/me` の ID**
   - 旧: `curl -H "Authorization: Bearer $IGAA_TOKEN" https://graph.instagram.com/v25.0/me?fields=user_id,username`
   - 新: `curl -H "Authorization: Bearer $EAA_TOKEN" https://graph.facebook.com/v25.0/me?fields=user_id,username`
   - `user_id` が一致するか記録する。
2. **Webhook の `entry.id`**
   - 両トークンで `subscribed_apps` を設定し、テストコメントを送る。
   - `POST /webhook` のログ（`[webhook] object: instagram entries:` の後の
     `entry[].id`）に記録された ID を、各ログイン方式ごとに記録する。
3. **同一相手の IGSID**
   - 同じテスターから DM を送り、`followers.igsid` を各方式で比較する
     （管理画面の友だち一覧、または `GET /api/friends` で確認）。
4. **結果を次の表に記録** し、移行手順（docs/manual/10-migration.md）を確定させる。

| 項目 | 旧ログイン | 統合ログイン | 一致 |
|---|---|---|---|
| `/me user_id` | | | |
| webhook `entry.id` | | | |
| 同一相手の IGSID | | | |

## 判定

- **3つとも一致** → 移行時の ID 変換は不要。移行手順どおりで可。
- **不一致あり** → PATCH は既存の検証（`validateIgAccount` の `ig_user_id` 一致）で
  自動的に中止され安全側に倒れるが、IGSID が変わると履歴が別人扱いになる。
  移行は「新規アカウント登録＋旧アカウント停止」として計画し、
  フォロワー履歴の引き継ぎ手段（実機で再確認）を先に設計する。

## 実施記録

- 実施日: （未実施 — 要実機）
- 実施者: （）
- 結果: （）
