🌐 [日本語](README.md) | [English](README.en.md) | **简体中文** | [한국어](README.ko.md) | [Español](README.es.md)

# IG Harness

> ### **[查看在线演示](https://shudesu.github.io/ig-harness-oss/)** 👈

Instagram DM 完全开源自动化 / 营销自动化工具。**A 厂商 / B 厂商 的免费替代方案**。
运行于 Cloudflare 免费套餐，服务器费用 **¥0**。支持通过 Claude Code 进行全部操作。

### ▶️ [视频教程 (YouTube)](https://youtu.be/xzEanXQtlO0)

[![点击在 YouTube 上播放 — IG Harness 完整配置流程](https://img.youtube.com/vi/xzEanXQtlO0/maxresdefault.jpg)](https://youtu.be/xzEanXQtlO0)

> 📖 **配置指南（含截图完整版）**: <https://harness-wiki.pages.dev/article/ig-harness-complete-setup-guide>

**当前版本**: v0.11.1 ・ MIT License ・ TypeScript / Cloudflare Workers + D1 + R2

---

## 为什么选择 IG Harness？

| | A 厂商 | B 厂商 | **IG Harness** |
|---|---|---|---|
| 月费 | $15+ | ¥10,000–30,000/月 | **¥0** |
| 评论 → DM 自动分发 | ✅ | ✅ | ✅ |
| 关注门控（福利分发） | ✅ | ✅ | ✅ |
| 步骤式序列推送 | ✅ | ✅ | ✅ |
| 富媒体消息（卡片/按钮） | ✅ | ✅ | ✅ |
| 表单 | ✅ | ✅ | ✅ |
| 追踪链接 | 部分支持 | ✅ | ✅ |
| 开放 API | ❌ | ❌ | **全功能开放** |
| Claude Code (AI) 支持 | ❌ | ❌ | **内置 MCP server** |
| LINE 官方账号联动 | ❌ | ❌ | **UUID 跨平台关联** |
| 多账号管理 | 需单独购买 | 需单独购买 | **标准内置** |
| Meta 审核 | 无需 | 无需 | **无需（Standard Access 即可运行）** |
| 源代码 | 不公开 | 不公开 | **MIT（本仓库）** |

---

## 快速开始

### 一条命令完成全部配置

```bash
npx create-ig-harness
```

CLI 将自动完成以下所有步骤：
- Cloudflare 账号认证 (wrangler login)
- 创建 D1 数据库 + R2 存储桶，应用 Schema 迁移
- 部署 Worker / 管理后台
- 注册 Instagram Pro 账号的凭证
- 引导完成 Meta App 的 Webhook 联动配置（自动展示 Privacy Policy / Data Deletion / Terms URL）
- 创建管理后台首次登录用的 Owner 账户

所需时间：约 5 分钟。完成后即可在管理后台（`https://<your-name>-admin.pages.dev`）立即投入使用。

### 前置条件

- Cloudflare 账号（免费套餐即可）
- Instagram Pro 账号（企业号 / 创作者号）+ Meta App
- Node.js 22+ / pnpm

---

## 核心功能

### 互动引流（主要获客手段）
- **互动门控** — A 厂商 风格的「评论 → DM → 关注验证 → 福利分发」闭环。若用户尚未关注，自动发送"请先关注再回来"DM，确认关注后自动发送福利 DM
- **评论 → DM 自动分发** — 以特定帖子 / Reels 的评论为触发器，通过 DM 发放福利（支持全部帖子或单独指定）
- **评论自动回复** — 按关键词自动回复评论（采用带 @mention 的顶层评论方式，Standard Access 下可用）
- **Story 提及 → DM** — 检测到提及后自动发送 DM
- **DM 关键词触发** — 收到含特定关键词的 DM 时触发门控逻辑

### 消息推送
- **步骤式序列推送** — 关键词触发后按时间间隔依次发送多条 DM
- **追加 DM（跟进滴灌）** — 福利发放后以分钟级延迟最多追加 3 条消息
- **群发推送** — 向全体粉丝或按标签筛选后的用户群发 DM，支持预约发送
- **富媒体消息** — 带按钮的卡片、轮播图、快速回复

### CRM
- **粉丝管理** — Webhook 自动注册、资料获取、自定义元数据、标签
- **客服会话** — 直接从管理后台进行 1:1 回复。自动发送的 DM 及按钮点击行为也会在会话记录中还原展示
- **头像缓存** — 通过 R2 永久缓存 Instagram CDN 的签名图片，避免链接过期失效
- **表单** — 在 DM 内收集数据，回答自动保存至元数据
- **追踪链接** — 点击量统计与流量来源分析

### LINE Harness 联动
- **UUID 跨平台关联** — 通过共享密钥 Webhook，将 IG 粉丝与 LINE 好友双向关联至同一 UUID。只需发送一条专属 URL，"该 IG 用户 = 该 LINE 好友"即可自动记录至两个数据库
- **流量来源 IG 账号记录** — 多账号场景下，可追踪用户是通过哪个 IG 账号注册 LINE 的

### 多账号管理
- 通过 **一个 Worker / 一个管理后台** 管理多个 Instagram 账号
- **账号级隔离** — 粉丝、门控、推送均按账号维度独立管理
- **Webhook 路由** — 根据 `entry.id` 自动识别接收账号；多 Meta App 场景支持多密钥签名验证

### 运维监控
- **`GET /api/health`** — 按账号展示 Token 剩余有效天数、API 实际调用的存活状态（检查点 / 封号检测）、最近一次 Webhook 接收时间、DM 发送失败数、Cron 任务存活状态
- 可与外部探针结合，在异常时触发告警（Token 过期、发送失败激增、无响应等）

### AI 集成
- **内置 MCP Server** (`@ig-harness/mcp-server`) — 通过 Claude Code 以自然语言执行全部操作
- **官方 SDK** (`@ig-harness/sdk`) — 带类型定义的 TypeScript SDK，支持 ESM + CJS

### iOS 应用支持
- **`GET /api/capabilities`** — 与 iOS 官方客户端（the-harness-ios）进行兼容性判断的端点

---

## 架构

```
[ Instagram Platform ] ⇄ [ Cloudflare Worker (Hono) ] ⇄ [ D1 SQLite ] + [ R2 ]
                                   ⇅
                         [ Cloudflare Pages (Next.js 15) ]
                                   ⇅
                         [ MCP Server / SDK / Claude Code ]
```

- **Worker** (`apps/worker`): API + Webhook 接收 + 图片分发，Cron（每 5 分钟）负责推送处理、Token 刷新和存活探测
- **Web** (`apps/web`): Next.js 15 管理后台
- **Packages**:
  - `@ig-harness/sdk` — TypeScript SDK
  - `@ig-harness/mcp-server` — 适用于 Claude Code 的 MCP server
  - `create-ig-harness` — 配置 CLI
  - `@ig-harness/ig-sdk` — Instagram Graph API 轻量封装
  - `@ig-harness/db` — D1 迁移工具 + 辅助函数
  - `@ig-harness/shared` — 共享类型定义

---

## 关于 Standard Access 的限制

Instagram Messaging API 针对您本人拥有并管理的 Pro 账号，在 **Standard Access（无需 Meta App Review）** 下即可实现 DM 推送、互动门控以及模拟评论回复等功能。

**仅以下场景才需要 Advanced Access（须通过 App Review）**：
- 在父评论下方嵌套的真正线程式回复
- 以多租户模式托管非自有账号（即客户的账号）

IG Harness 的评论回复采用带 `@mention` 的顶层评论投放方式实现，无需 Advanced Access 即可正常运行。

---

## 文档

- [配置指南（视频 · YouTube）](https://youtu.be/xzEanXQtlO0)
- [配置指南（含截图）](https://harness-wiki.pages.dev/article/ig-harness-complete-setup-guide)
- [npm: @ig-harness/sdk](https://www.npmjs.com/package/@ig-harness/sdk)
- [npm: @ig-harness/mcp-server](https://www.npmjs.com/package/@ig-harness/mcp-server)
- [npm: create-ig-harness](https://www.npmjs.com/package/create-ig-harness)

---

## 许可证

MIT License。可自由用于商业用途、修改及再分发。

---

## 贡献

欢迎提交 Issue / PR。向 OSS 仓库提交的 PR 请发至 `Shudesu/ig-harness-oss`（本仓库）。

---

> **IG Harness** by [@Shudesu](https://github.com/Shudesu) — AI 原生时代的开源 Instagram DM 自动化工具
