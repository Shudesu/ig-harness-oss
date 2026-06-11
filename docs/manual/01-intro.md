---
chapter: 1
title: イントロ
tier: free
status: placeholder
---

# 第1章 イントロ

> 【tier: 無料】IG Harness が解決する課題、ManyChat / Inflact との違い、Standard Access のままで戦う設計思想を理解する。

IG Harness は、Instagram 運用における DM 自動返信・キーワードトリガー・LP 誘導などを「自前ホスト」で回すための OSS です。同じ領域の SaaS（ManyChat、Inflact、MobileMonkey 等）は機能こそ豊富ですが、月額課金・ベンダーロックイン・Meta 規約変更時の挙動不透明さといった構造的なリスクを抱えています。とくに ManyChat の comment reply 機能は Meta の Advanced Access（App Review 通過）を前提に組まれているため、個人運用者がゼロから審査を通すのは現実的ではありません。

IG Harness はこの前提を逆手に取り、「Standard Access のままで戦える機能だけ」を主戦場に据えています。具体的には、コメント自動返信のような審査必須機能には依存せず、DM への返信、フォロー有無の判定（engagement gates）、ストーリーズ／投稿リンクへの誘導といった、Standard Access の範囲で完結するフローで設計されています。これによって、Meta App Review に時間を溶かすことなく、配信者が自分のドメイン・自分の Cloudflare アカウントで運用を開始できます。

さらに本マニュアルが扱う最大の差別化ポイントは、姉妹 OSS である **LINE Harness** とのシームレス連携です。IG → LINE への中間ページ＋push 配信フローを使うことで、Instagram で集めたリードを LINE 公式アカウント側の濃いリストへ流し込み、CRM／ステップ配信を継続できます（第5章で詳述）。

このマニュアルは「マーケター向け運用書」です。OSS 本体のソースコードリーディングではなく、運用設計と意思決定のドキュメントとして書かれています。第1〜3章および第7章は **無料公開**、第4〜6章は **🔒有料章**（統合プレイブック ¥98,000 買い切りに含まれる範囲）として段階的に深掘りしていきます。

## 章の目的
- IG Harness が「何を解決する OSS か」を1分で説明できる
- ManyChat / Inflact と比べて、どの軸（料金・審査・ロックイン）で優位なのかを判断できる
- このマニュアルの読み方（無料章→有料章への進め方）を把握する

## 想定読者
- ManyChat 等の SaaS から脱却したい IG 運用者
- AAA 生徒・Harness コミュニティ会員で、IG → LINE 動線を自前構築したい人
- Meta App Review に時間を溶かしたくない、個人 / 小規模事業者

## 目次
- 1.1 IG Harness が解決する3つの課題
- 1.2 ManyChat / Inflact との比較表（料金・審査・ロックイン）
- 1.3 「Standard Access のまま戦う」設計思想
- 1.4 LINE Harness 連携で広がる導線
- 1.5 無料 vs 有料 — 本マニュアルの読み方

## 前提
- Instagram プロアカウント／ビジネスアカウントを保有している
- ある程度の DM 運用経験がある（ManyChat 等の利用経験は不問）

## 次の章
- 第2章では、自前 Cloudflare アカウントへのセットアップ手順を最短ルートで通す。

---
*このファイルはプレースホルダーです。本文は別セッションで執筆します。*
