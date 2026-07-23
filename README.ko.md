🌐 [日本語](README.md) | [English](README.en.md) | [简体中文](README.zh-CN.md) | **한국어** | [Español](README.es.md)

# IG Harness

> ### **[데모 페이지 보기](https://shudesu.github.io/ig-harness-oss/)** 👈

Instagram DM 완전 오픈소스 자동화 / 마케팅 자동화 도구. **A사 / B사 의 무료 대체제**.
Cloudflare 무료 플랜으로 운영 가능. 서버 비용 **₩0**.  Claude Code에서 모든 작업 가능.

### ▶️ [영상으로 보기 (YouTube)](https://youtu.be/xzEanXQtlO0)

[![클릭하여 YouTube 재생 — IG Harness 도입 전체 과정](https://img.youtube.com/vi/xzEanXQtlO0/maxresdefault.jpg)](https://youtu.be/xzEanXQtlO0)

> 📖 **셋업 가이드 (스크린샷 포함 완전판)**: <https://harness-wiki.pages.dev/article/ig-harness-complete-setup-guide>

**현재 버전**: v0.11.1 ・ MIT License ・ TypeScript / Cloudflare Workers + D1 + R2

---

## 왜 IG Harness인가?

| | A사 | B사 | **IG Harness** |
|---|---|---|---|
| 월 요금 | $15+ | 월 ₩90,000–270,000 | **₩0** |
| 댓글 → DM 자동 발송 | ✅ | ✅ | ✅ |
| 팔로우 게이트 (특전 배포) | ✅ | ✅ | ✅ |
| 스텝 발송 | ✅ | ✅ | ✅ |
| 리치 메시지 (카드/버튼) | ✅ | ✅ | ✅ |
| 폼 | ✅ | ✅ | ✅ |
| 트래킹 링크 | 일부 | ✅ | ✅ |
| API 공개 | ❌ | ❌ | **전 기능** |
| Claude Code (AI) 지원 | ❌ | ❌ | **MCP server 내장** |
| LINE 공식 계정 연동 | ❌ | ❌ | **UUID 크로스링크** |
| 멀티 계정 | 별도 계약 | 별도 계약 | **기본 탑재** |
| Meta 심사 | 불필요 | 불필요 | **불필요 (Standard Access로 동작)** |
| 소스코드 | 비공개 | 비공개 | **MIT (이 레포)** |

---

## 퀵스타트

### 명령어 한 줄로 완전 셋업

```bash
npx create-ig-harness
```

CLI가 다음 작업을 모두 수행합니다:
- Cloudflare 계정 인증 (wrangler login)
- D1 데이터베이스 + R2 버킷 생성, 스키마·마이그레이션 적용
- Worker / 관리 화면 배포
- Instagram 프로 계정 credentials 등록
- Meta App Webhook 연동 설정 안내 (Privacy Policy / Data Deletion / Terms URL 자동 표시)
- 관리 화면 최초 로그인용 Owner 사용자 생성

소요 시간: 약 5분. 완료 후 관리 화면 (`https://<your-name>-admin.pages.dev`)에서 즉시 운영 시작.

### 필요한 것

- Cloudflare 계정 (무료 플랜으로 OK)
- Instagram 프로 계정 (비즈니스 / 크리에이터) + Meta App
- Node.js 22+ / pnpm

---

## 주요 기능

### 인게이지먼트 (팔로워 유입의 핵심)
- **인게이지먼트 게이트** — A사 스타일의 "댓글 → DM → 팔로우 확인 → 특전 배포" 루프. 팔로우가 완료되지 않으면 "팔로우 후 다시 돌아오세요" DM을 보내고, 팔로우 확인 후 특전 DM을 자동 발송
- **댓글 → DM 자동 발송** — 특정 게시물 / 릴스에 달린 댓글을 트리거로 DM으로 특전 발송 (전체 게시물 또는 개별 지정)
- **댓글 자동 답글** — 키워드별 댓글 자동 답변 (@mention 포함 최상위 댓글 방식, Standard Access로 동작)
- **스토리 멘션 → DM** — 멘션 감지 시 자동 DM 발송
- **DM 키워드 트리거** — 특정 키워드가 담긴 DM 수신 시 게이트 실행

### 발송
- **스텝 발송** — 키워드 트리거로 시간차를 두고 DM을 연속 발송
- **팔로업 드립** — 특전 발송 후 분 단위 딜레이로 최대 3통까지 추가 DM
- **일괄 발송** — 전체 팔로워 또는 태그 필터링으로 DM 일괄 발송, 예약 발송 지원
- **리치 메시지** — 버튼이 포함된 카드, 캐러셀, 퀵 리플라이

### CRM
- **팔로워 관리** — Webhook 자동 등록, 프로필 조회, 커스텀 메타데이터, 태그
- **오퍼레이터 채팅** — 관리 화면에서 직접 1:1 답장. 자동 발송 DM / 버튼 클릭도 대화 로그에 재현 표시
- **프로필 사진 캐시** — Instagram CDN 서명 만료 문제를 R2로 영구 캐시
- **폼** — DM 내에서 데이터 수집, 응답 → 메타데이터 자동 저장
- **트래킹 링크** — 클릭 측정, 유입 경로 분석

### LINE Harness 연동
- **UUID 크로스 플랫폼 연동** — 공유 시크릿 webhook으로 IG 팔로워와 LINE 친구를 동일 UUID로 양방향 연결. 1:1 고유 URL을 보내는 것만으로 "이 IG 유저 = 이 LINE 친구" 관계가 양쪽 DB에 자동 기록
- **유입 IG 계정 기록** — 멀티 계정 운영 시 어느 IG 계정을 통해 LINE 등록이 이루어졌는지 추적

### 멀티 계정
- **복수의 Instagram 계정**을 하나의 Worker / 대시보드에서 관리
- **계정별 스코프** — 팔로워·게이트·발송을 계정 단위로 분리
- **Webhook 라우팅** — `entry.id`로 수신 계정을 자동 판별, 별도 Meta App도 멀티 시크릿 서명 검증으로 대응

### 운영 모니터링
- **`GET /api/health`** — 계정별 토큰 잔여 일수·API 실제 호출 생사 확인 (체크포인트 / 동결 감지)·마지막 webhook 수신·DM 발송 실패 수·cron 생사 확인
- 외부 프로브와 조합하여 이상 발생 시 알림 (토큰 만료·발송 실패 급증·응답 없음)

### AI 통합
- **MCP Server 내장** (`@ig-harness/mcp-server`) — Claude Code에서 자연어로 모든 작업 가능
- **공식 SDK** (`@ig-harness/sdk`) — TypeScript 타입 지원 SDK, ESM + CJS

### iOS 앱 지원
- **`GET /api/capabilities`** — iOS 공식 앱 (the-harness-ios)과의 호환성 판별 엔드포인트

### 콘텐츠 게시
- **콘텐츠 게시** — 피드 이미지·캐러셀·릴스·스토리 (즉시/예약 게시)

---

## 아키텍처

```
[ Instagram Platform ] ⇄ [ Cloudflare Worker (Hono) ] ⇄ [ D1 SQLite ] + [ R2 ]
                                   ⇅
                         [ Cloudflare Pages (Next.js 15) ]
                                   ⇅
                         [ MCP Server / SDK / Claude Code ]
```

- **Worker** (`apps/worker`): API + Webhook 수신 + 이미지 배포, cron (5분마다) 으로 발송 처리·토큰 갱신·생존 프로브
- **Web** (`apps/web`): Next.js 15 대시보드
- **Packages**:
  - `@ig-harness/sdk` — TypeScript SDK
  - `@ig-harness/mcp-server` — Claude Code용 MCP server
  - `create-ig-harness` — 셋업 CLI
  - `@ig-harness/ig-sdk` — Instagram Graph API 경량 래퍼
  - `@ig-harness/db` — D1 마이그레이션 + 헬퍼
  - `@ig-harness/shared` — 타입 정의 공유

---

## Standard Access 제한에 대하여

Instagram Messaging API는 본인이 소유·관리하는 프로 계정이라면 **Standard Access (Meta App Review 불필요)** 만으로 DM 발송·인게이지먼트 게이트·유사 댓글 답글까지 동작합니다.

**Advanced Access (App Review 필수)가 필요한 경우는 다음에 한정**:
- 부모 댓글 바로 아래에 중첩되는 진짜 스레드형 reply
- 본인이 소유·관리하지 않는 계정(고객 계정)을 호스팅하는 멀티테넌트 운영

IG Harness의 댓글 답글은 `@mention` 포함 최상위 댓글 방식으로 구현되어 있어, Standard Access 그대로 동작합니다.

---

## 문서

- [셋업 가이드 (영상·YouTube)](https://youtu.be/xzEanXQtlO0)
- [셋업 가이드 (스크린샷 포함)](https://harness-wiki.pages.dev/article/ig-harness-complete-setup-guide)
- [npm: @ig-harness/sdk](https://www.npmjs.com/package/@ig-harness/sdk)
- [npm: @ig-harness/mcp-server](https://www.npmjs.com/package/@ig-harness/mcp-server)
- [npm: create-ig-harness](https://www.npmjs.com/package/create-ig-harness)

---

## 라이선스

MIT License. 상업적 이용·변경·재배포 자유.

---

## 기여

Issue / PR 환영합니다. OSS 레포로의 PR은 `Shudesu/ig-harness-oss` (이 레포)에 제출해 주세요.

---

> **IG Harness** by [@Shudesu](https://github.com/Shudesu) — AI 네이티브 시대의 오픈소스 Instagram DM 자동화
