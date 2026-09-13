# Design — WriteBack

**Dự án:** Learning English / WriteBack (tên tạm)  
**Loại tài liệu:** Technical Design (implementation-ready)  
**Phiên bản:** 1.3.1
**Ngày:** 2026-09-13  
**Trạng thái:** chốt theo PRD v1.4.1 (vận hành enterprise)  
**Nguồn hành vi:** [`docs/PRD.md`](./PRD.md)  
**Xung đột:** hành vi sản phẩm lấy PRD làm chuẩn; tài liệu này chỉ chốt *cách làm*. Nếu lệch PRD, sửa design hoặc cập nhật PRD trước khi code.  
**Changelog v1.1:** picker ranking; cloze inflection; unhide; sample/example; snapshot; onboarding; due GMT+7; lemma Free; unique email.  
**Changelog v1.2:** Redis rate-limit; Fly ≥ 2; staging; PITR; RBAC 4 role; audit_logs; impersonate; quota_grants; allowlist bảng; OpenAPI bắt buộc; eval+adversarial CI. D8 đổi (Redis). D10 = charged rows + grants.  
**Changelog v1.3:** `plan_limits` theo `LimitProfile` `free | premium | staff` (một nguồn sự thật, seed lúc migrate); bỏ hằng số staff trong code + env `ADMIN_REWRITE_NEW`. `/ready` trả `{ db, redis }`.
**Changelog v1.3.1:** `QUOTA_EXCEEDED` kèm `details.resetAt`, giờ reset suy từ `BUSINESS_TZ`; `GET /rewrite/:attemptId` luôn trả `modelRewriteEn` + `showModelRewriteToggle` (trình bày thuộc UI); `SCORING_TEMPERATURE = 0` là hằng số code cạnh `SCORING_PROMPT_VERSION` (không env).

---

## 0. Mục đích

Engineer đọc file này là implement MVP được: stack, repo, schema, endpoint, mã lỗi, thuật toán, env, deploy. Không cần đoán path, cột DB, hay chỗ trừ quota.

**In**

- Stack, topology, monorepo, module Nest / App Router
- Schema PostgreSQL + index (kể cả unique từng phần)
- REST API `/v1` (request/response, mã lỗi)
- Luồng Auth, ToS, allowlist, rewrite, quota, auto-add, SRS, import, xóa TK, RBAC, audit, impersonate
- Hợp đồng LLM, quan sát, bảo mật, mapping WR-xx, môi trường staging/prod

**Out**

- Không đổi phạm vi MVP (PRD §5.1 / §16)
- Không copy seed nội dung
- Không trang giá / thanh toán / native app / lớp học
- Không phải kế hoạch sprint từng task

---

## 1. Quyết định đã chốt (vòng design)

| ID | Chủ đề | Chốt | Hệ quả |
| --- | --- | --- | --- |
| D1 | Độ sâu tài liệu | Implementation-ready | Endpoint + cột + mã lỗi trong file này |
| D2 | Hình thái | UI Next.js **tách** API NestJS | Hai process, REST, cookie CORS |
| D3 | Auth | Auth.js **trên API** (Google) | Session DB; cookie domain API / parent domain |
| D4 | ORM / DB | Prisma + PostgreSQL (Neon) | Partial unique bằng SQL thuần trong migration |
| D5 | LLM | OpenAI JSON / structured outputs | 1 call / lần nộp; pin `prompt_version` + model env |
| D6 | Repo / deploy | Monorepo pnpm; web **Vercel**; API **Fly.io**; DB **Neon** | `NEXT_PUBLIC_API_URL`; production cần custom domain |
| D7 | Hợp đồng FE↔API | REST JSON + Zod `packages/shared` | Không tRPC |
| D8 | Rate limit | **Upstash Redis** | Quota vẫn đếm charged rows (D10). Redis chỉ cửa sổ rate-limit đa máy |
| D9 | Fetch sau login | Browser → API (credentials) | Trang `/app/*` không SSR data học |
| D10 | Nguồn quota | Đếm `rewrite_attempts.quota_charged` + `quota_grants` | Grant không sửa history |
| D11 | HA | Fly API **min 2** máy | Autoscaling off; min=2 |
| D12 | Môi trường | local / staging / prod | Neon branch staging; OAuth client riêng |
| D13 | Hạn mức | Bảng `plan_limits` theo `LimitProfile` (`free`\|`premium`\|`staff`) | Không hằng số/env cho staff; đọc DB qua `PlanLimitsService` |

---

## 2. Stack

| Lớp | Chọn | Ghi chú |
| --- | --- | --- |
| UI | Next.js 15 App Router, TypeScript strict, Tailwind, shadcn/ui | UI tiếng Việt; viewport 390px cho rewrite + ôn |
| API | NestJS 11, platform **Express** (mặc định) | Mount Auth.js `@auth/express` |
| Auth | Auth.js v5 (Google), Prisma adapter, **database sessions** | `maxAge` 30 ngày; `updateAge` 24h (refresh gia hạn) |
| DB | PostgreSQL 16 (Neon) | `timestamptz`; ngày nghiệp vụ `Asia/Ho_Chi_Minh` |
| ORM | Prisma 6 | Client chỉ trong `apps/api` |
| LLM | OpenAI API, model env `OPENAI_MODEL` (mặc định `gpt-4o-mini`) | Timeout 20s; `temperature: 0`; không retry SDK (retry = cùng attempt+revision) |
| Shared | `packages/shared`: Zod schema, SM-2, copy-block, visibility types | Web không import Prisma |
| Observability | `request_id`; Sentry; log JSON stdout | **Cấm** PII/câu sang analytics; alert budget / 5xx / machines < 2 |
| Analytics sản phẩm | Bảng `analytics_events` | Event PRD §14; không `user_en` |
| Hosting | Vercel (web), Fly.io (API, **min 2**), Neon PITR, Upstash Redis | Fly HTTP timeout ≥ 30s |
| CI | GitHub Actions: lint, typecheck, test, prisma validate, **eval vàng**, **adversarial**, secret scan, OpenAPI | Deploy tách: Vercel `apps/web`, Fly `apps/api` |
| Runtime | Node 22, pnpm workspaces | `packageManager` pin |

**Không dùng:** queue/worker (chấm sync 20s), email, object storage, GraphQL, tRPC, Clerk. Redis **có** (rate-limit).

---

## 3. Topology và domain

```
[Browser]
    |  pages, cookie parent-domain (prod/staging)
    v
[apps/web  Vercel] ----landing RSC----> không gọi LLM
    |
    |  fetch(NEXT_PUBLIC_API_URL, credentials: 'include')
    v
[apps/api  Fly × ≥2] --Prisma--> [Neon Postgres + PITR]
    |                 --Redis--> [Upstash]  // chỉ rate-limit
    |  chỉ POST submit rewrite
    v
[OpenAI]
```

### 3.1 URL

| Môi trường | Web | API | Cookie `Domain` |
| --- | --- | --- | --- |
| Local | `http://localhost:3000` | `http://localhost:4000` | **không** set `Domain` |
| Staging | `https://app.staging.<root>` | `https://api.staging.<root>` | `.staging.<root>` hoặc `.<root>` nếu subdomain cho phép |
| Production | `https://app.<root>` | `https://api.<root>` | `.<root>` ví dụ `.writeback.app` |

`SameSite=Lax; Secure (prod); HttpOnly; Path=/`. Tên cookie: `wb.session`.

Hai subdomain cùng eTLD+1 là **same-site** → Lax cookie đi kèm `fetch` credentials tới API.

OAuth callback Google Console: `https://api.<root>/auth/callback/google`.  
`AUTH_URL` = origin API (Auth.js tạo redirect đúng).  
Sau login: redirect `callbackUrl` = origin web (`/app` hoặc `/`).

### 3.2 CORS

API:

- `Access-Control-Allow-Origin` = đúng origin web (không `*`)
- `Allow-Credentials: true`
- `Allow-Headers: Content-Type, X-Request-Id`
- Reject request mutating nếu `Origin` không nằm allowlist (CSRF)

### 3.3 Fly

- HTTP service port 4000
- Health: `GET /v1/health` (không auth); `/v1/ready` = DB + Redis ping
- **min_machines_running = 2** (prod và staging)
- Rate limit: Redis INCR + TTL cửa sổ; **không** bảng PG rate-limit

---

## 4. Monorepo và module

```
/
  pnpm-workspace.yaml          apps/*  packages/*
  docs/PRD.md
  docs/design.md
  apps/web/                    Next.js
  apps/api/                    NestJS + prisma/
  packages/shared/             Zod + thuần TypeScript
```

### 4.1 `packages/shared`

| Export | Trách nhiệm |
| --- | --- |
| `scoringOutputSchema` | Zod — JSON chấm bài (PRD 10.4 + phụ lục B) |
| `importDocumentSchema` | Import JSON v1 (phụ lục A) |
| `normalizeCopyBlock(s)` | NFKC, lower, bỏ punct Unicode, gộp whitespace |
| `blankHeadword(sentence, headword, extras[])` | Cloze: word-boundary, blank headword + extras (inflectionSet), không lộ đáp án |
| `inflectionSet(headword)` | Họ tense/plural/gerund + bảng ~50 bất quy tắc trong file shared; không fuzzy spelling |
| `matchReviewAnswer(answer, accepted[])` | trim + case-insensitive; `accepted` = headword ∪ inflection ∪ surface đã blank |
| `nextSm2(card, q)` | Phụ lục C PRD; q=1 new/learning = +10 phút |
| `businessDate(now, tz)` | `YYYY-MM-DD` theo `Asia/Ho_Chi_Minh` |
| `isDueToday(nextReviewAt, now, tz)` | So sánh date GMT+7 |
| Types DTO dùng chung (không class Nest) | `MeDto`, error union, v.v. |

Web và API đều phụ thuộc `shared`. **Không** để logic quota/picker trong web.

### 4.2 Nest — `apps/api/src`

Một module = một bounded context. Guard phân quyền **server-side**.

| Module | Việc |
| --- | --- |
| `HealthModule` | `/v1/health`, `/v1/ready` (DB ping + Redis ping) |
| `AuthModule` | Mount `/auth/*`; session; Google |
| `UsersModule` | `/v1/me`, ToS, onboarding, xóa TK |
| `CatalogModule` | Topic/lemma/prompt nội bộ + visibility |
| `RewriteModule` | Start, picker, submit, copy-block, idempotency |
| `LlmModule` | OpenAI client, `prompt_version`, cost |
| `QuotaModule` | Đếm lượt, 429, đổi plan giữa ngày |
| `VocabModule` | Cards, ẩn, **unhide**, chi tiết từ; **cấm** add tay |
| `ReviewModule` | Session ôn, SM-2, cloze/type/flashcard |
| `DashboardModule` | Widget streak/due/quota |
| `HistoryModule` | List + chi tiết attempt của mình |
| `AdminContentModule` | CRUD + publish rules |
| `AdminImportModule` | Dry-run / commit / publish-all batch |
| `AdminUsersModule` | Plan, override, role, allowlist, audit |
| `SupportModule` | Impersonate, quota grants |
| `AuditModule` | `audit_logs` append-only |
| `AnalyticsModule` | `track(name, props)` ghi DB |
| `CommonModule` | `RequestId`, filter lỗi, timezone, `VisibilityService`, `RolesGuard` |

**Không** module thanh toán / email / TTS.

### 4.3 Next — `apps/web/app`

IA = PRD phụ lục D. **Không** Route Handler nghiệp vụ (không chấm bài trên Vercel).

| Route | Data |
| --- | --- |
| `/`, `/terms`, `/privacy`, `/login` | Public; login = `window.location` tới API `/auth/signin/google` |
| `/app` | Dashboard — `GET /v1/dashboard` |
| `/app/rewrite` | Start + form |
| `/app/rewrite/[attemptId]` | Feedback / revision |
| `/app/vocab`, `/app/vocab/[lemmaId]` | Cards |
| `/app/review` | Phiên ôn |
| `/app/history` | Lịch sử |
| `/app/account` | Onboarding 1–3 topic, xóa `XOA` |
| `/admin/*` | Nav theo role: editor = nội dung; support = users/impersonate/audit của mình; admin = tất cả. API 403 nếu thiếu role. Impersonate → redirect `/app`, không `/admin` |

Middleware Next (tùy chọn): gọi `GET /v1/me` với cookie forward. Nếu không có session → `/login`. Nếu `tosAcceptedAt` null → chặn `/app` và `/admin`. Nếu `learningBlocked` → cho `/app/account` + thông báo beta, chặn rewrite/review/vocab/history. Nếu `onboardingTopicIds.length` không thuộc 1–3 → chỉ `/app/account` (chọn topic). Nếu `impersonatorId` → **không** `/admin`; banner “đang xem với tư cách {email đích}”. **Không** tin middleware: API vẫn enforce.

Admin UI desktop-first; `/app` responsive 390px.

---

## 5. Quy ước chung

### 5.1 ID và thời gian

- ID nghiệp vụ: UUID v4, cột `@db.Uuid`
- Mọi thời điểm: `timestamptz` UTC
- Ngày hạn ngạch / streak / due “hôm nay”: `Asia/Ho_Chi_Minh` (`BUSINESS_TZ`)
- Due SRS (hàng đợi + badge “hôm nay”): `isDueToday(next_review_at)` — date GMT+7 ≤ hôm nay, card `hidden_at IS NULL`, content còn published

### 5.2 Envelope lỗi

Mọi lỗi JSON (không kể Auth.js HTML):

```json
{
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "Bạn đã hết lượt viết lại hôm nay. Lượt mới vào 00:00 GMT+7.",
    "request_id": "…",
    "details": {}
  }
}
```

`message` tiếng Việt, hiện được cho user. Header `X-Request-Id` luôn có (client gửi hoặc server mint).

`QUOTA_EXCEEDED`: `message` nêu giờ reset **suy ra từ `BUSINESS_TZ`** (không hard-code chuỗi múi giờ trong code); `details.resetAt` = mốc ISO đầu ngày nghiệp vụ kế tiếp (`businessDayRange(now, BUSINESS_TZ).end`) để UI hiển thị theo giờ máy người dùng.

### 5.3 Mã lỗi

| `code` | HTTP | Khi nào |
| --- | --- | --- |
| `UNAUTHENTICATED` | 401 | Không session |
| `TOS_REQUIRED` | 403 | Chưa `tos_accepted_at`, gọi API học |
| `BETA_BLOCKED` | 403 | Allowlist bật, email không có, `role` không phải staff |
| `ONBOARDING_REQUIRED` | 403 | `onboardingTopicIds` không thuộc 1–3 visible |
| `FORBIDDEN` | 403 | User gọi `/v1/admin/*`; add tay vocab; POST revision hết cửa sổ |
| `NOT_FOUND` | 404 | Attempt/vocab của người khác **hoặc** không tồn tại (cùng 404) |
| `NO_PROMPT` | 422 | Picker hết ứng viên |
| `VALIDATION` | 422 | Body, độ dài, `XOA` sai |
| `COPY_BLOCKED` | 422 | Khớp sample / model rewrite sau normalize; **không** gọi LLM, không trừ |
| `UNPUBLISHED` | 409 | Lemma/prompt không còn published lúc submit |
| `SCORING_IN_PROGRESS` | 409 | Cùng attempt+revision đang gọi LLM |
| `CONFLICT` | 409 | Tạo tay trùng `headword`/`slug`/`external_key` còn sống; impersonate khi actor đã có phiên mở |
| `QUOTA_EXCEEDED` | 429 | Hết lượt mới / retry ngày |
| `RATE_LIMITED` | 429 | Vượt `RATE_LIMIT_*`; không LLM, không trừ |
| `LLM_TIMEOUT` | 502 | > 20s hoặc 5xx OpenAI |
| `LLM_INVALID_SCHEMA` | 502 | JSON không Zod; thiếu 1-1 `used_required_words` |
| `PAYLOAD_TOO_LARGE` | 413 | Import > 2MB |

**Ẩn tồn tại:** `attemptId` / `lemmaId` không thuộc user → `NOT_FOUND`, không 403.

### 5.4 Idempotency rewrite

Khóa: `(attempt_id, revision)`. Submit **trong transaction**: `SELECT … FOR UPDATE` hàng attempt (rev đang nộp).

- Đã `scored` + `quota_charged` → trả **đúng** payload cũ, 200, không LLM, không trừ lần 2
- `scoring` và `updated_at` < 25s → `SCORING_IN_PROGRESS`
- `scoring` quá 25s → cho submit lại (coi như fail)
- Timeout / schema / 5xx: `status=failed`, `quota_charged=false`, client nộp lại cùng id
- Đếm quota **trong cùng transaction** (sau `SELECT … FOR UPDATE` hàng user): `COUNT(*)` charged hôm nay GMT+7 + `SUM` `quota_grants.extra_*` cùng ngày. Hai tab không cả hai qua cửa.

Rate limit: Redis `INCR` key `rl:{name}:{userId}:{window}` + `EXPIRE` cửa sổ; `count > limit` → 429, không LLM. Không phụ thuộc 1 máy.

---

## 6. Auth, session, cổng học

### 6.0 Gắn Auth.js

- Path: `GET|POST /auth/*` trên API (không prefix `/v1`)
- Provider: Google; email bắt buộc
- Adapter: `@auth/prisma-adapter`
- `session.strategy: "database"`
- `session.maxAge`: 2592000 (30 ngày)
- `session.updateAge`: 86400
- Events: `signIn` → `last_login_at=now`; user mới `role=user`, `plan=free`
- Hủy consent Google: không tạo session (Auth.js)
- Staff (`editor`/`support`/`admin`) **bỏ qua allowlist** (vẫn cần ToS + attest 15+)

User xóa cứng: cascade Account, Session, attempts, cards, overrides, events, quota_grants, impersonation (target). **Không** `users.deleted_at`. Cùng email Google tạo **user mới trống** vì unique email đã giải phóng. `audit_logs`: `actor_id`/`target` giữ UUID; strip `props.email`; không xóa hàng (365 ngày).

### 6.1 Cổng theo thứ tự (mọi API học)

1. Session hợp lệ  
2. `tos_accepted_at`  
3. Allowlist (nếu `BETA_ALLOWLIST_ENABLED=true`) trừ staff (`editor`/`support`/`admin`)  
4. Onboarding: 1–3 `user_onboarding_topics` còn visible  
5. Nếu session có `impersonatorId`: không vào `/v1/admin/*`  
6. Nghiệp vụ (quota, visible, …)

Allowlist: bảng `beta_allowlist_emails` (UI admin). Env `BETA_ALLOWLIST_EMAILS` chỉ **seed lần đầu**, không SoT sau migrate.

`GET /v1/me` không yêu cầu ToS/onboarding. `POST /v1/me/tos` body `{ "accept": true, "ageAttested": true }`. `PUT /v1/me/onboarding` + `GET /v1/topics`: session+ToS+beta. Nếu `tos_version` trên hàng accept < env → `TOS_REQUIRED`.

`GET /v1/me` thêm `impersonatorId` (null nếu không impersonate).

### 6.2 `GET /v1/me`

```json
{
  "id": "…",
  "email": "a@gmail.com",
  "name": "…",
  "role": "user",
  "plan": "free",
  "tosAcceptedAt": "…|null",
  "onboardingTopicIds": ["…"],
  "learningBlocked": false,
  "learningBlockedReason": null,
  "impersonatorId": null,
  "limits": {
    "rewriteNewPerDay": 10,
    "retryPerDay": 3,
    "reviewSessionCap": 20,
    "newCardsUsedNaturalPerDay": 20
  }
}
```

Admin trên `/app`: `limits` = hàng `staff` của `plan_limits` (100 / 10 / 40 / `null` không trần card). Impersonate: `limits` + catalog của **user đích**.

---

## 7. Schema

Prisma trong `apps/api/prisma/schema.prisma` (copy phụ lục A). Unique headword/slug/external_key trên bản chưa xóa: SQL mục 7.6. `users.email`: `@@unique` (Auth.js). Thêm unique `lower(email)` trong SQL.

### 7.1 Enum

`Role`: `user` \| `editor` \| `support` \| `admin`  
`Plan`: `free` \| `premium`  
`ContentStatus`: `draft` \| `published`  
`OverrideKind`: `allow` \| `deny`  
`AttemptStatus`: `started` \| `scoring` \| `scored` \| `failed`  
`IdeaMatchStatus`: `enough` \| `missing` \| `off_topic`  
`SrsStatus`: `new` \| `learning` \| `review` \| `mastered`  
`ReviewMode`: `flashcard` \| `type` \| `cloze`  
`LimitProfile`: `free` \| `premium` \| `staff`

`content_gone` (topic/lemma unpublish/xóa) **không** lưu cột — tính lúc đọc bằng join. User gỡ bộ ôn: `srs_cards.hidden_at`.

### 7.2 Bảng (logic)

**Auth.js (bắt buộc adapter):** `users`, `accounts`, `sessions`, `verification_tokens`.

Mở rộng `users`: `role`, `plan`, `tos_accepted_at`, `last_login_at`, `onboarding_completed_at`, `streak_count`, `streak_last_date` (`date`), timestamps. **`email` unique** (Auth.js `findUnique`). **Không** `deleted_at`.

**`tos_acceptances`:** `user_id`, `accepted_at`, `tos_version`, `privacy_version`, `age_attested`.

**Nội dung:** `topics`, `lemmas`, `prompts`, `prompt_lemmas`.

- `lemmas.headword` giữ nguyên display; `headword_normalized` = `lower(trim(headword))`
- `lemmas.example_en` bắt buộc khi publish
- `lemmas.included_in_free` — **cờ Free duy nhất**
- `prompts.text_vi` ≤ 500 (check DB + app)
- `prompts.external_key` nullable
- **Không** `included_in_free` trên topic/prompt; **không** `thin_content_*`

**Catalog user:** `user_onboarding_topics` `(user_id, topic_id)` PK; 1–3 dòng.  
`user_topic_overrides`: unique `(user_id, topic_id)`, `kind`, `created_by_id`.

**Học:** `rewrite_attempts`, `srs_cards`, `srs_reviews`, `review_sessions`.

**Vận hành:** `plan_limits`, `plan_changes`, `import_batches`, `analytics_events`, `audit_logs`, `beta_allowlist_emails`, `quota_grants`, `impersonation_sessions`, `user_daily_activity`.

### 7.3 `rewrite_attempts`

| Cột | Ý |
| --- | --- |
| `id` | UUID hàng |
| `attempt_id` | UUID mint lúc start (gia đình rev 1+2) |
| `revision` | 1 hoặc 2 |
| `parent_attempt_id` | NULL nếu rev 1; = `id` hàng rev 1 nếu rev 2 |
| `user_id`, `prompt_id` | |
| `status` | |
| `user_en` | lúc nộp |
| `prompt_text_vi_snapshot` | |
| `targets_snapshot` | JSON `[{ lemmaId, headword, pos, senseVi }]` — **không** `sample_en` |
| `sample_en_snapshot` | Snapshot lúc start; **không** serialize ra GET start/đề |
| `topic_id_snapshot` | |
| `scored_at`, `overall_score`, `idea_match_*` | |
| `feedback` | JSON đầy đủ LLM |
| `display_issues` | tối đa 3 lỗi đã cắt (high trước) |
| `model`, `prompt_version`, tokens, `cost_estimate_usd`, `latency_ms`, `request_id` | |
| `quota_charged` | true chỉ khi scored hợp lệ |
| `fail_reason` | `timeout` \| `invalid_schema` \| `provider_5xx` \| null |

Constraint: `UNIQUE (attempt_id, revision)`; `revision IN (1,2)`; rev 1: `attempt_id = id`.

Mint: tạo UUID `A`, insert `id=A`, `attempt_id=A`, `revision=1`, `status=started`. Không trừ quota.

Rev 2: insert hàng mới `attempt_id=A`, `revision=2`, `parent_attempt_id=id_rev1`.

URL `/app/rewrite/[attemptId]` dùng **family** `attempt_id`.

### 7.4 `srs_cards`

- `UNIQUE (user_id, lemma_id)` kể cả hidden (chặn re-add)
- `hidden_at` — user gỡ / hoàn tác
- `counted_toward_daily_new` — chỉ card used∧natural tính trần 20
- `added_from_attempt_id`, `added_revision`
- SM-2: `ef` default 2.5, `repetitions`, `interval_days`, `next_review_at`, `status`
- Card mới: `next_review_at = now()`, `status=new`, `interval_days=0`

Visible ôn / due / trang chi tiết: `hidden_at IS NULL` **và** lemma+topic published chưa xóa. Topic/lemma unpublish hoặc xóa mềm → compute `content_gone` lúc đọc (không backfill bắt buộc). Badge due: visible AND `isDueToday`. Unhide: `hidden_at = NULL`; không đổi SM-2.

### 7.5 `plan_limits` (seed)

| profile | rewrite_new | retry | session_cap | new_cards_used_natural |
| --- | --- | --- | --- | --- |
| free | 10 | 3 | 20 | 20 |
| premium | 50 | 10 | 40 | NULL (không trần) |
| staff | 100 | 10 | 40 | NULL (không trần) |

Profile = `limitProfileFor(role, plan)`: role staff (`editor`/`support`/`admin`) → `staff`, còn lại → `plan`. **Không** hằng số trong code, **không** env override; đổi hạn mức = sửa hàng (UI admin = backlog P1).

### 7.6 Index SQL (migration)

```sql
CREATE UNIQUE INDEX users_email
  ON users (lower(email));

CREATE UNIQUE INDEX topics_slug_alive
  ON topics (slug) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX lemmas_headword_alive
  ON lemmas (headword_normalized) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX prompts_external_key_alive
  ON prompts (external_key) WHERE deleted_at IS NULL AND external_key IS NOT NULL;

CREATE INDEX lemmas_topic_status ON lemmas (topic_id, status) WHERE deleted_at IS NULL;
CREATE INDEX prompts_topic_status ON prompts (topic_id, status) WHERE deleted_at IS NULL;
CREATE INDEX prompt_lemmas_lemma ON prompt_lemmas (lemma_id);

CREATE INDEX attempts_user_scored ON rewrite_attempts (user_id, scored_at)
  WHERE quota_charged = true;
CREATE INDEX attempts_user_prompt ON rewrite_attempts (user_id, prompt_id, scored_at);

CREATE INDEX cards_user_due ON srs_cards (user_id, next_review_at)
  WHERE hidden_at IS NULL;
CREATE INDEX cards_user_lemma ON srs_cards (user_id, lemma_id);

CREATE INDEX reviews_session ON srs_reviews (session_id);
CREATE INDEX events_name_created ON analytics_events (name, created_at);
CREATE INDEX audit_logs_action_created ON audit_logs (action, created_at);
CREATE INDEX quota_grants_user_date ON quota_grants (user_id, date);
CREATE UNIQUE INDEX impersonation_one_open_actor ON impersonation_sessions (actor_id) WHERE ended_at IS NULL;
```

Check:

```sql
ALTER TABLE prompts ADD CONSTRAINT prompts_text_vi_len CHECK (char_length(text_vi) <= 500);
ALTER TABLE rewrite_attempts ADD CONSTRAINT attempts_user_en_len
  CHECK (user_en IS NULL OR char_length(user_en) <= 400);
ALTER TABLE rewrite_attempts ADD CONSTRAINT attempts_rev CHECK (revision IN (1, 2));
```

### 7.7 Prisma models (tham chiếu)

Tên model PascalCase; cột camelCase map `@map("snake")`. Schema đầy đủ: phụ lục A. Không thêm cột override lemma.

`PromptLemma`: PK `(promptId, lemmaId)`, `sortOrder` 0..n (2–5 lemma).

`plan_changes`: `user_id`, `from_plan`, `to_plan`, `changed_by_id`, `note`, `created_at`. Mọi đổi plan ghi 1 hàng.

`import_batches`: `admin_id`, `filename`, `schema_version`, `strict`, `result` JSON (errors/warnings/counts), `committed_at` null nếu chỉ dry-run.

`user_daily_activity`: PK `(user_id, date)` date = GMT+7; `rewrite_new_count`, `review_count` — **cache streak/dashboard**, có thể rebuild từ attempts/reviews.

`quota_grants`: cộng lượt theo ngày GMT+7; không sửa `quota_charged`.

`audit_logs.props` JSONB — **cấm** key `user_en`, `sample_en`. `email` chỉ khi action `user.pii_view` (có thể mask).

Rate-limit: Redis, không bảng PG.

`analytics_events.props` JSONB — **cấm** key `user_en`, `sample_en`, `email`.

---

## 8. Visibility và picker

### 8.1 `VisibilityService.canSeeLemma(user, lemma)` / prompt

```
alive = deleted_at IS NULL AND status = published
plan_allows =
  user.role IN (admin, editor, support)
  OR user.plan == premium
  OR lemma.included_in_free == true
visible = alive
  AND (plan_allows OR topic_id IN allow_list)
  AND topic_id NOT IN deny_list
```

Prompt visible khi: prompt alive AND **mọi** target lemma visible.

Staff `/app` = mọi published. Preview draft **chỉ** `/v1/admin/*`.

### 8.2 Picker (không LLM)

Ứng viên:

- Prompt published, chưa xóa
- Mọi target published + visible
- Optional filter `topicId` (user chọn) — topic vẫn visible
- `lemmaId` (CTA chi tiết từ): **chỉ** prompt chứa lemma — lọc **trước** ranking
- Không lặp prompt đã **scored hợp lệ** trong 7 ngày nếu còn prompt khác thỏa; hết kho thì lặp, ưu tiên `max(scored_at)` cũ nhất

**Không hard-filter tập due.** Mọi ứng viên (sau lọc trên) tính điểm, **random đều trong top N=8**.

| Tín hiệu | Điểm |
| --- | --- |
| Mỗi target due hôm nay (calendar GMT+7) hoặc `status=learning` | +3 |
| Target có attempt 14 ngày `used=false` OR `natural=false` | +2 |
| Topic ∈ onboarding | +1 |
| User chưa scored prompt này | +1 |

Hết ứng viên → `NO_PROMPT`, không mint attempt. Hết quota bài mới → `QUOTA_EXCEEDED`, không mint.

---

## 9. Quota, copy-block, auto-add

### 9.1 Đếm lượt

`rewriteNewUsed` = số hàng `revision=1 AND quota_charged` có `scored_at` thuộc calendar day GMT+7.

`rewriteRetryUsed` = số hàng `revision=2 AND quota_charged` cùng day (gọi LLM thành công schema).

Còn lại: `max(0, limit - used + grants)` với `limit` theo plan/role hiện tại; `quota_grants.extra_*` cùng ngày GMT+7.

`POST /rewrite/start`: nếu `rewriteNewLeft = 0` → 429, **không insert** attempt.

Trừ: set `quota_charged=true` **trong cùng transaction** lúc lưu scored hợp lệ (sau `FOR UPDATE`).

**Không trừ:** timeout, 5xx, sai schema, copy-block, 409, 429, chưa gọi LLM, start bỏ dở.

Rev 2 không trừ lượt mới.

### 9.2 Cửa sổ revision

- Tồn tại rev 1 `quota_charged` cùng `attempt_id`
- `now <= scored_at_rev1 + 900s` (server)
- Cùng `prompt_id` và cùng set `target lemma ids` (so snapshot)
- Còn trần retry ngày
- Chưa có rev 2 scored; nếu rev 2 failed → được nộp lại cùng `(attempt_id, 2)`

Hết hạn / hết retry: API `FORBIDDEN` / ẩn nút; không LLM.

### 9.3 Copy-block (trước LLM)

`normalizeCopyBlock(user_en)` bằng:

- `sample_en_snapshot` của attempt (rev 1 và 2) — **không** đọc sample sống
- Rev 2: thêm `model_rewrite_en` của rev 1

Khớp → `COPY_BLOCKED`. Câu rỗng / chỉ space / > 400 → `VALIDATION`.

LLM assemble dùng cùng `sample_en_snapshot` + `prompt_text_vi_snapshot`.

### 9.4 Auto-add

Sau scored hợp lệ (rev 1 hoặc 2), mỗi target lemma **visible**:

- Đã có card `(user, lemma)` kể cả hidden → **không** insert, không unhide, không reset SM-2  
- `used=false OR natural=false`: luôn insert nếu chưa có; `counted_toward_daily_new=false`; không toast hoàn tác  
- used∧natural: nếu Free và số card `counted_toward_daily_new=true` tạo trong ngày GMT+7 ≥ 20 → **không** insert; copy “đã đạt hạn từ mới hôm nay”; bài chấm vẫn 200  
- Premium/Admin: không trần  
- Card mới: SM-2 default, due ngay, `added_from_attempt_id`

Hoàn tác toast (10s UI): `POST /v1/vocab/cards/:cardId/undo-auto-add` chỉ khi card tạo từ attempt đó, used∧natural, `hidden_at` null. Set hidden. Đếm trần 20: card `counted_toward_daily_new AND hidden_at IS NULL AND added_at in day`.

**Unhide:** `POST /v1/vocab/:lemmaId/unhide` — card của mình, `hidden_at` not null, lemma vẫn visible → `hidden_at = NULL`. Không reset SM-2. Không tự unhide lúc chấm.

Không API add tay → `FORBIDDEN`.

---

## 10. SRS

`nextSm2` đúng PRD phụ lục C v1.3. `q=1` khi `new`/`learning` → `next_review_at = now+10m`, `status=learning`, `repetitions=0`. `q=1` khi `review`/`mastered` → interval 1 ngày, `status=learning`. `q≥3` tăng repetitions; `interval≥21` → `mastered`.

**Mode (server chọn, không toggle):**

- `new` → flashcard  
- `learning` | `review` → cloze nếu có nguồn câu; không → gõ từ  

Nguồn cloze (thứ tự): (a) `user_en` attempt mới nhất lemma `used:true`; (b) `model_rewrite_en` nếu chưa used đúng; (c) `lemma.example_en`. **Không** `prompt.sample_en`. GET mặt trước: `blankHeadword(sentence, headword, inflectionSet(headword))`, không đáp án.

So khớp gõ/cloze: `matchReviewAnswer` với accepted = headword ∪ inflectionSet ∪ các token đã blank. Đúng `q=4`, sai `q=1`. **Không** ghi đè `used` lúc chấm bài.

Phiên: `POST` tạo session `cap` = 20/40; `graded_count` tăng khi grade thành công; hết cap → `ended_at`, user được `POST` session mới cùng ngày.

Hàng đợi: due hôm nay (calendar) overdue lâu nhất → learning → new (chen new nếu số due đã lấy < cap). Bỏ hidden / content gone.

Streak: +1 nếu GMT+7 có ≥1 `review_graded` **hoặc** ≥1 rewrite `revision=1` charged. Miss 1 ngày → `streak_count=0`. Rev 2 không cộng.

---

## 11. LLM

Chỉ `LlmModule.scoreRewrite`.

**Input assemble (server):** `text_vi` (snapshot), `required_words[]`, `sample_en` (**snapshot**), `user_en` (untrusted, đã truncate 400).

**System prompt** pin `SCORING_PROMPT_VERSION` (mặc định `score.v1`). Ý = PRD phụ lục B. File `apps/api/src/llm/prompts/score.v1.txt` — đổi nội dung = bump version.

**OpenAI:**

- `response_format`: json_schema strict = `scoringOutputSchema`
- Timeout 20s  
- `temperature` = hằng số `SCORING_TEMPERATURE = 0` trong code, cạnh `SCORING_PROMPT_VERSION` (**không** env). Đổi = bump `prompt_version` + eval vàng.  
- `max_output_tokens` env  
- Không gửi conversation history  

**Cost:** `cost_estimate_usd = in/1e6 * OPENAI_PRICE_IN + out/1e6 * OPENAI_PRICE_OUT`.

Mọi call (kể cả rev 2) ghi tokens + cost trên attempt. Tổng ngày GMT+7 `>` `DAILY_AI_BUDGET_USD` → log `ai_budget_exceeded` (metric/log, không UI).

LLM down: SRS vẫn chạy; rewrite `LLM_TIMEOUT` / 502.

Validate sau parse: `used_required_words.length === targets.length` và set headword lowercase **đúng bằng** set snapshot (1-1). Sai → `LLM_INVALID_SCHEMA`, không trừ. **Không** sửa `used`/`natural` bằng `inflectionSet`.

Trước đổi `SCORING_PROMPT_VERSION`: chạy bộ **20 cặp vàng** `apps/api/src/llm/eval/score.v1.json` (text_vi, user_en, expected idea_match + used). Fail eval → không ship version mới.

`overall_score` integer 0–100; `idea_match.status` enum.

Cắt lỗi hiển thị: gộp `grammar_issues` + `lexical_issues`; high trước, tối đa 3 → `display_issues`. History dùng bản đã lưu, không gọi LLM.

---

## 12. API

Base: `https://api.<root>/v1`  
Auth: cookie session. Trừ `GET /health`, `/ready`, `/auth/*`.

### 12.1 Public / session

| Method | Path | Auth | Thành công | Lỗi |
| --- | --- | --- | --- | --- |
| GET | `/health` | không | `{ status: "ok" }` | |
| GET | `/ready` | không | `{ db: true, redis: true }` | 503 |
| * | `/auth/*` | Auth.js | redirect / session | |
| GET | `/me` | session | mục 6.2 | 401 |
| POST | `/me/tos` | session | `{ tosAcceptedAt }` | 401, VALIDATION |
| PUT | `/me/onboarding` | session+ToS+beta | `{ topicIds }` 1–3 visible | 403/422 |
| DELETE | `/me` | session | 204; body `{ "confirm": "XOA" }` | 422 gõ sai; xóa cứng |

`PUT /me/onboarding` cũng dùng sau này trên account (đổi 1–3 topic).

API học (rewrite/review/vocab/dashboard/history) thêm `ONBOARDING_REQUIRED` nếu chưa 1–3 topic.

### 12.2 Rewrite

**POST `/rewrite/start`**

Body: `{ "topicId": "uuid?", "lemmaId": "uuid?" }`  
`lemmaId` = CTA chi tiết từ.

Hết quota bài mới → **429**, không body attempt.  
Hết ứng viên → **422 `NO_PROMPT`**.

Mint: snapshot `prompt_text_vi` + `sample_en` vào hàng `started`.

200:

```json
{
  "attemptId": "…",
  "revision": 1,
  "prompt": {
    "id": "…",
    "textVi": "…",
    "hintsVi": null,
    "topicId": "…",
    "topicNameVi": "…",
    "targets": [
      { "lemmaId": "…", "headword": "deadline", "pos": "noun", "senseVi": "…" }
    ]
  },
  "quota": { "rewriteNewLeft": 9, "retryLeft": 3 },
  "revisionUntil": null
}
```

**Cấm** field `sampleEn`, `modelRewriteEn`, `exampleEn` trên object `prompt`.

**POST `/rewrite/:attemptId/submit`**

Body: `{ "revision": 1, "userEn": "…" }`  
Rev 2: `"revision": 2`.

200: feedback (thứ tự field phục vụ UI PRD 10.4) + `cardsAdded[]` + `cardsDeferredCap20` + `revisionUntil` (rev1).

Không hero score; vẫn trả `overallScore`.

**GET `/rewrite/:attemptId`**

Gia đình attempt của mình: rev 1 bắt buộc, rev 2 nếu có. 404 nếu không phải chủ. Luôn trả `modelRewriteEn` của **mọi** revision đã chấm cùng cờ `showModelRewriteToggle`; quy tắc trình bày (sau checklist ở rev 1; toggle thu gọn trên form rev 2 chỉ khi điểm lần 1 < 50; hai bản sau rev 2 — PRD 10.4) thuộc UI. Server **không** gate theo thời gian; chống chép = copy-block lúc nộp.

**POST `/rewrite/:attemptId/revision`** (optional alias) — không cần; client POST submit `revision:2` sau khi `GET` biết còn cửa sổ.

Không queue offline.

### 12.3 Vocab

| Method | Path | Ghi chú |
| --- | --- | --- |
| GET | `/vocab` | `{ topics: [...cards visible], hidden: [{ cardId, lemmaId, headword, topicNameVi }] }` |
| GET | `/vocab/:lemmaId` | 200 nếu card visible; **404** hidden/không có. Có `exampleEn`. Tối đa 3 `user_en` used=true; không thì 1 example label “câu mẫu”. Không `cefr`, không `sampleEn`. |
| POST | `/vocab/:lemmaId/hide` | Gỡ bộ ôn |
| POST | `/vocab/:lemmaId/unhide` | Lấy lại; 404 nếu không phải chủ / không có card |
| POST | `/vocab/cards/:cardId/undo-auto-add` | Toast |
| POST | `/vocab` (add tay) | **403** |

CTA ôn / viết lại: client gọi review session filter hoặc `start { lemmaId }`.

### 12.4 Review

**POST `/review/sessions`** → `{ sessionId, cap, remaining }`

**GET `/review/sessions/:id/next`** → card + mode + payload mặt trước (cloze đã blank) **hoặc** `{ done: true }`

**POST `/review/sessions/:id/grade`**

- Flashcard: `{ cardId, quality }` `1|3|4|5`  
- Type/cloze: `{ cardId, answer }` server chấm  

200: `{ quality, correct?, next }`

Hết cap: `done: true`, `reason: "cap"`.

### 12.5 Dashboard / history

**GET `/dashboard`**

`streak`, `dueToday`, `reviewedToday`, `rewriteNewToday` (chỉ rev1 charged), `quota`, `topics[]` (5 topic nhiều card visible, `% mastered`), `cta`.

Due **không** hidden/content gone. Empty chưa card: CTA viết lại, không hiện due > 0. Due = calendar GMT+7.

**GET `/history?cursor&limit`** list excerpt, điểm phụ, badge revision.

**GET `/history/:attemptId`** = GET rewrite family, không LLM.

### 12.6 Admin — nội dung

Prefix `/v1/admin`, guard theo role (PRD 7.1). Impersonate session **403** mọi `/v1/admin/*`.

CRUD nội dung: `editor` + `admin`.

- `/admin/topics` GET list/filter, POST, PATCH `:id`, POST `:id/publish`, POST `:id/unpublish`, DELETE soft — publish ghi audit  
- `/admin/lemmas` tương tự; unique headword alive → upsert semantics khi import, 409 nếu tạo trùng tay; publish chặn thiếu `example_en`  
- `/admin/prompts` — publish chặn: thiếu `sample_en`, lemma chưa published, khác topic, `text_vi` > 500  
- GET topic `:id/context` — số prompt/lemma, blocker ≥ 2 prompt/lemma (**không** exception)

**Import:**

- `POST /admin/import/dry-run` body JSON ≤ 2MB UTF-8  
- `POST /admin/import/commit` `{ "batchId" }` hoặc cùng payload sau khi dry-run  
- Mọi item **draft**; JSON `published` bị bỏ qua  
- `strict: true` fail cả file  
- `POST /admin/import/:batchId/publish-all` — publish lần lượt, báo lỗi từng dòng (UI in)

Dry-run không ghi nội dung (chỉ `import_batches` với `committed_at` null).

Upsert lemma theo `headword_normalized`; prompt theo `external_key`.

### 12.7 Admin — user / allowlist / audit

Guard: `GET` user = `support`+`admin` (ghi `user.pii_view`). Đổi plan/role/allowlist = `admin`.

- `GET /admin/users?q=email`  
- `GET /admin/users/:id`  
- `POST /admin/users/:id/plan` `{ plan, note }`  
- `POST /admin/users/:id/role` `{ role, note }` — chỉ admin; không tự demote admin cuối  
- `PUT /admin/users/:id/overrides` `{ allowTopicIds, denyTopicIds }`  
- `GET|POST|DELETE /admin/allowlist` — email lower unique; `GET` gồm `enabled` flag  
- `GET /admin/audit?cursor` — admin: mọi; support: action của mình  

Override lemma → 404.

### 12.8 Support

`support` + `admin`.

SoT impersonate = bảng `impersonation_sessions`. **Không** đổi `sessions.user_id` (Auth.js vẫn là staff).

- `POST /admin/users/:id/impersonate` `{ reason }` (≥ 10 ký tự) → `{ expiresAt }` TTL **1800s**. Target phải `role=user`. Một session open / actor. Audit `impersonate.start`.
- Request học: `actor` = session user; nếu có hàng open (`ended_at` null, `expires_at > now`) → `effectiveUser` = target. `GET /v1/me` = DTO đích + `impersonatorId`.
- `POST /admin/impersonate/stop` — `ended_at=now`; cũng hết khi TTL. Audit `impersonate.stop`.
- Đang impersonate → mọi `/v1/admin/*` 403.
- `POST /admin/users/:id/quota-grants` `{ reason, extraRewriteNew, extraRetry }` — grant ngày GMT+7; `extraRewriteNew` ≤ limit plan đích.

### 12.9 Topics cho onboarding

`GET /topics` — topic **visible** = published, chưa xóa, và có ≥ 1 lemma visible với user (id, nameVi) cho picker 1–3. Không browse lemma.

---

## 13. Publish rules (server)

- Publish lemma: `example_en` không rỗng; không cần đủ prompt  
- Publish prompt: `sample_en` normalize không rỗng; mọi target published **cùng topic**; 2–5 targets  
- Topic UI blocker: lemma published < 2 prompt published chứa nó. **Không** `thin_content_ok`  
- Unpublish prompt: **không** tự unpublish lemma  
- Soft delete topic: ẩn con khỏi học; card compute content_gone  

Import: luôn draft; dry-run cảnh báo thiếu sample / example / mỏng ngữ cảnh (PRD phụ lục A).

---

## 14. Frontend — hợp đồng UX kỹ thuật

Không lặp UI copy PRD; chỉ ràng buộc kỹ thuật:

- Start/GET đề: **không** render sample / example của prompt  
- Chi tiết từ / flashcard: `exampleEn` hoặc câu user; không `sampleEn`  
- Kết quả: khớp ý + checklist → tối đa 3 lỗi → naturalness/encouragement → điểm phụ → model rewrite (rev1 sau checklist; form rev2 toggle chỉ khi `overallScore < 50`, mặc định đóng; sau rev2 hiện hai bản)  
- Prefill rev2 = `user_en` lần 1  
- Toast hoàn tác 10s chỉ used∧natural; list đã gỡ + unhide  
- 409 unpublish: form chết, CTA start attempt mới  
- 429 start/nộp: copy hết lượt, reset 00:00 GMT+7, CTA ôn  
- 390px: không scroll ngang bắt buộc trên rewrite + 1 thẻ ôn  
- Landing: “tới 50 lượt/ngày”, không “không giới hạn”  
- Điểm history: typography phụ  
- Onboarding: chặn shell học đến khi 1–3 topic  
- Impersonate: banner cố định “Đang xem với tư cách {email} — Dừng”; CTA stop. Không hiện `/admin` trong nav.  

Client: `fetch` wrapper gắn `credentials: 'include'`, `X-Request-Id`.

---

## 15. Quan sát, chi phí, bảo mật

- Mọi request: `request_id`  
- Sentry: stack, `request_id`; **scrub** `user_en`, cookie, Authorization  
- Log LLM: model, tokens, cost, `prompt_version`, `attempt_id` — không log full `user_en` ở info  
- Rate limit **Redis**: `RATE_LIMIT_SUBMIT_PER_MIN` (gợi ý 10), `RATE_LIMIT_START_PER_MIN` (gợi ý 20)  
- Prompt injection: `apps/api/src/llm/eval/adversarial.v1.json` ≥ 15 case; CI bắt buộc  
- Eval vàng: `apps/api/src/llm/eval/score.v1.json` — CI fail → không deploy version prompt  
- OpenAPI: generate từ Zod, publish artifact CI  
- Alert: API 5xx, Fly machines < 2, `daily_ai_budget`, eval fail  
- P95 TTFB `/app/rewrite` và `/app/review` < 2s **không** gồm LLM  
- Neon PITR bật; RPO 1h / RTO 4h — runbook `docs/runbooks/restore.md` (owner viết trước beta)  

---

## 16. Env

**API**

```
DATABASE_URL
REDIS_URL
AUTH_SECRET
AUTH_URL
AUTH_GOOGLE_ID
AUTH_GOOGLE_SECRET
APP_ORIGIN
COOKIE_DOMAIN
NODE_ENV
APP_ENV=local|staging|prod
BUSINESS_TZ=Asia/Ho_Chi_Minh
BETA_ALLOWLIST_ENABLED
BETA_ALLOWLIST_EMAILS          # seed only
TOS_VERSION
PRIVACY_VERSION
OPENAI_API_KEY
OPENAI_MODEL=gpt-4o-mini
OPENAI_PRICE_IN
OPENAI_PRICE_OUT
OPENAI_DATA_HANDLING=zero_retention
DAILY_AI_BUDGET_USD
SCORING_PROMPT_VERSION=score.v1
RATE_LIMIT_SUBMIT_PER_MIN
RATE_LIMIT_START_PER_MIN
SENTRY_DSN
```

**Web**

```
NEXT_PUBLIC_API_URL
NEXT_PUBLIC_APP_ORIGIN
SENTRY_DSN
```

Không commit secret. Allowlist SoT = bảng. Staging dùng bộ secret/OAuth/DB riêng.

---

## 17. Mapping WR-xx → module

| WR | Module API | Ghi chú design |
| --- | --- | --- |
| 10.1 | Auth, Users | Allowlist bảng; ToS version; attest 15+ |
| 10.2 | web IA | Không `/pricing` |
| 10.3 | Catalog, Visibility, picker trong Rewrite | |
| 10.4 | Rewrite, Llm, Quota | Mint id; schema cứng |
| 10.5 | Vocab | 404 nếu không visible card; unhide; cấm add tay |
| 10.6 | Review | SM-2 shared + 10 phút; cloze inflection |
| 10.7 | Dashboard | |
| 10.8 | History | 404 chéo user |
| 10.9 | Users | `XOA`; đổi onboarding |
| 10.10 | AdminContent, AdminImport | Audit publish |
| 10.11 | AdminUsers, Audit | PII view audit |
| 10.12 | web `/terms` `/privacy` | Version env |
| 10.13 | Support | Impersonate, quota grants |
| 11 | Common, Redis, Fly, CI | SLO, PITR |

---

## 18. ADR ngắn

**ADR-001 Tách Nest khỏi Next.** Split để API timeout 20s + cookie/LLM không nằm serverless Vercel. Giá: 2 deploy + CORS. PRD v1.3+ chốt split.

**ADR-002 Auth.js trên API.** Một nơi session sát phân quyền. Web không verify JWT. Production bắt buộc custom domain.

**ADR-003 Database session.** Khớp “30 ngày, refresh gia hạn”; revoke lúc xóa TK xóa `sessions`.

**ADR-004 Redis rate-limit.** v1.1: Postgres buckets. v1.2: Upstash Redis vì min 2 máy Fly. **Quota vẫn D10** (charged rows + grants), không đếm trên Redis.

**ADR-005 REST + Zod shared.** Nest DTO `nestjs-zod`. **OpenAPI bắt buộc** (DoD) generate từ schema shared.

**ADR-006 OpenAI structured outputs.** Model rẻ `gpt-4o-mini`; đổi env không đổi schema. `OPENAI_DATA_HANDLING=zero_retention` trước beta.

**ADR-007 Client-side data.** Cookie API không biến Next thành BFF.

**ADR-008 attempt family.** `attempt_id` mint = `id` rev 1; rev 2 hàng khác.

**ADR-009 Quota đếm charged rows + grants.** Cache `user_daily_activity` rebuild được.

**ADR-010 sample_en không bao giờ trên start/GET đề / vocab / flashcard.**

**ADR-011 Staging tách.** Neon branch + OAuth client + OpenAI project riêng. Không clone PII prod.

**ADR-012 RBAC 4 role.** Tách editor/support/admin để audit và least privilege. Impersonate không mở `/admin`.

---

## 19. Thứ tự implement gợi ý (không phải sprint)

1. Monorepo, Prisma, health (`/ready` = DB+Redis), Auth Google, `/me`, ToS, allowlist bảng  
2. Catalog + visibility + admin CRUD + publish rules  
3. Import dry-run/commit  
4. Picker + start attempt (không LLM)  
5. Submit + OpenAI + quota + copy-block + idempotency  
6. Auto-add + undo + vocab detail  
7. SRS session + 3 mode + dashboard/streak  
8. History, account xóa TK, admin users/override  
9. RBAC, audit, allowlist UI, impersonate, quota grants  
10. Redis rate-limit, Fly min 2, staging, PITR runbook, eval+adversarial CI, OpenAPI  

Mỗi bước có test: visibility (lemma Free + staff), picker ranking + CTA lemma, copy-block snapshot, schema 1-1, SM-2 + 10 phút, 404 chéo user, quota không trừ khi 502, start 429 không mint, unhide, cloze word-boundary, RBAC 403, impersonate TTL, audit pii_view.

---

## 20. Ràng buộc khi mở rộng (PRD §20)

Không phá: draft/published + soft delete nội dung; plan + override **topic** + cờ Free trên lemma; quota ngày + log LLM; history không chấm lại; AI không ghi lemma published; `sample_en` không lên UI ôn; allowlist / onboarding / mint `attempt_id` lúc start (có quota); audit append-only; impersonate không vào `/admin`.

Lớp học / thi / SSO trường = bảng mới, không nhồi vào `rewrite_attempts`.

---

## 21. Checklist đối chiếu DoD PRD §18

Design đủ để thỏa 15 mục DoD PRD §18 nếu implement đúng file này. Cụ thể:

- Allowlist + onboarding 1–3 + catalog đúng plan (lemma Free) + `attempt_id` + schema `idea_match` + 1-1 words  
- Trần 10/50/100 từ `plan_limits` (profile free/premium/staff); start hết quota 429 không mint; draft không lộ  
- Import draft; publish tay; API chặn prompt thiếu sample / lemma thiếu example  
- Plan + allow topic hiệu lực ngay; quota `max(0, limit − charged + grants)` + `FOR UPDATE` hàng user  
- Auto-add only; unhide từ list đã gỡ; chấm không tự unhide  
- Revision 15 phút server, POST trễ 403  
- Cloze word-boundary + inflection; fallback gõ từ; cap 20/40; due calendar; q=1 learning 10 phút  
- Chi tiết từ: `exampleEn`, không cefr, không sample  
- Xóa `XOA` (unique email)  
- LLM down không trừ; eval 20 cặp vàng khi bump prompt  
- Không pricing/TTS/lớp/thi/luận/browse / thin_content  
- GET đề không sample  
- RBAC 4 role; impersonate TTL + reason; publish/PII/plan audit 365 ngày  
- Staging tách; Fly ≥ 2; Redis rate-limit; Neon PITR; OpenAPI artifact  

---

## Phụ lục A — Prisma schema v1

Tên bảng `@map` snake_case. Unique headword/slug/external_key từng phần: SQL mục 7.6. **`users.email` dùng `@@unique`** (Auth.js `findUnique`). Unique `lower(email)` bổ sung trong SQL.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role { user editor support admin }
enum Plan { free premium }
enum ContentStatus { draft published }
enum OverrideKind { allow deny }
enum AttemptStatus { started scoring scored failed }
enum IdeaMatchStatus { enough missing off_topic }
enum SrsStatus { new learning review mastered }
enum ReviewMode { flashcard type cloze }
enum LimitProfile { free premium staff }

model User {
  id                    String    @id @default(uuid()) @db.Uuid
  name                  String?
  email                 String    @unique
  emailVerified         DateTime? @db.Timestamptz(6)
  image                 String?
  role                  Role      @default(user)
  plan                  Plan     @default(free)
  tosAcceptedAt         DateTime? @map("tos_accepted_at") @db.Timestamptz(6)
  lastLoginAt           DateTime? @map("last_login_at") @db.Timestamptz(6)
  onboardingCompletedAt DateTime? @map("onboarding_completed_at") @db.Timestamptz(6)
  streakCount           Int       @default(0) @map("streak_count")
  streakLastDate        DateTime? @map("streak_last_date") @db.Date
  createdAt             DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt             DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  accounts           Account[]
  sessions           Session[]
  tosAcceptances     TosAcceptance[]
  onboardingTopics   UserOnboardingTopic[]
  overrides          UserTopicOverride[]
  cards              SrsCard[]
  attempts           RewriteAttempt[]
  reviewSessions     ReviewSession[]
  dailyActivity      UserDailyActivity[]
  planChanges        PlanChange[]          @relation("PlanChangeSubject")
  planChangesMade    PlanChange[]          @relation("PlanChangeActor")
  overridesCreated   UserTopicOverride[]    @relation("OverrideActor")
  importBatches      ImportBatch[]
  events             AnalyticsEvent[]
  auditLogs          AuditLog[]           @relation("AuditActor")
  quotaGrants        QuotaGrant[]         @relation("QuotaGrantUser")
  quotaGrantsMade    QuotaGrant[]          @relation("QuotaGrantActor")
  impersonationsAsActor  ImpersonationSession[] @relation("ImpersonationActor")
  impersonationsAsTarget ImpersonationSession[] @relation("ImpersonationTarget")
  allowlistCreated    BetaAllowlistEmail[]

  @@map("users")
}

model Account {
  id                String  @id @default(uuid()) @db.Uuid
  userId            String  @map("user_id") @db.Uuid
  type              String
  provider          String
  providerAccountId String  @map("provider_account_id")
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@index([userId])
  @@map("accounts")
}

model Session {
  id           String   @id @default(uuid()) @db.Uuid
  sessionToken String   @unique @map("session_token")
  userId       String   @map("user_id") @db.Uuid
  expires      DateTime @db.Timestamptz(6)
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("sessions")
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime @db.Timestamptz(6)

  @@unique([identifier, token])
  @@map("verification_tokens")
}

model TosAcceptance {
  id              String   @id @default(uuid()) @db.Uuid
  userId          String   @map("user_id") @db.Uuid
  acceptedAt      DateTime @map("accepted_at") @db.Timestamptz(6)
  tosVersion      String   @map("tos_version")
  privacyVersion  String   @map("privacy_version")
  ageAttested     Boolean   @map("age_attested")
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("tos_acceptances")
}

model Topic {
  id                 String        @id @default(uuid()) @db.Uuid
  slug               String
  nameVi             String        @map("name_vi")
  status             ContentStatus @default(draft)
  createdAt          DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt          DateTime     @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt          DateTime?     @map("deleted_at") @db.Timestamptz(6)
  lemmas             Lemma[]
  prompts            Prompt[]

  @@map("topics")
}

model Lemma {
  id                 String        @id @default(uuid()) @db.Uuid
  headword           String
  headwordNormalized String        @map("headword_normalized")
  pos                String?
  phonetic           String?
  senseVi            String        @map("sense_vi")
  exampleEn          String?       @map("example_en")
  notesVi            String?       @map("notes_vi")
  topicId            String        @map("topic_id") @db.Uuid
  includedInFree     Boolean       @default(false) @map("included_in_free")
  status             ContentStatus @default(draft)
  cefr               String?
  createdAt          DateTime     @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt          DateTime     @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt          DateTime?     @map("deleted_at") @db.Timestamptz(6)
  topic              Topic         @relation(fields: [topicId], references: [id])
  promptLinks        PromptLemma[]
  cards              SrsCard[]

  @@index([topicId, status])
  @@map("lemmas")
}

model Prompt {
  id             String        @id @default(uuid()) @db.Uuid
  externalKey    String?       @map("external_key")
  textVi          String        @map("text_vi")
  topicId        String        @map("topic_id") @db.Uuid
  sampleEn       String?       @map("sample_en")
  hintsVi        String?       @map("hints_vi")
  status         ContentStatus @default(draft)
  createdAt      DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime      @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt      DateTime?     @map("deleted_at") @db.Timestamptz(6)
  topic          Topic         @relation(fields: [topicId], references: [id])
  lemmaLinks     PromptLemma[]
  attempts       RewriteAttempt[]

  @@index([topicId, status])
  @@map("prompts")
}

model PromptLemma {
  promptId  String @map("prompt_id") @db.Uuid
  lemmaId   String @map("lemma_id") @db.Uuid
  sortOrder Int    @default(0) @map("sort_order")
  prompt    Prompt @relation(fields: [promptId], references: [id], onDelete: Cascade)
  lemma     Lemma  @relation(fields: [lemmaId], references: [id])

  @@id([promptId, lemmaId])
  @@index([lemmaId])
  @@map("prompt_lemmas")
}

model UserOnboardingTopic {
  userId  String @map("user_id") @db.Uuid
  topicId String @map("topic_id") @db.Uuid
  user    User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, topicId])
  @@map("user_onboarding_topics")
}

model UserTopicOverride {
  id          String       @id @default(uuid()) @db.Uuid
  userId      String       @map("user_id") @db.Uuid
  topicId     String       @map("topic_id") @db.Uuid
  kind        OverrideKind
  createdAt   DateTime     @default(now()) @map("created_at") @db.Timestamptz(6)
  createdById String       @map("created_by_id") @db.Uuid
  user        User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdBy   User         @relation("OverrideActor", fields: [createdById], references: [id])

  @@unique([userId, topicId])
  @@map("user_topic_overrides")
}

model PlanLimit {
  profile                   LimitProfile @id
  rewriteNewPerDay         Int  @map("rewrite_new_per_day")
  retryPerDay               Int  @map("retry_per_day")
  reviewSessionCap          Int  @map("review_session_cap")
  newCardsUsedNaturalPerDay Int? @map("new_cards_used_natural_per_day")

  @@map("plan_limits")
}

model PlanChange {
  id          String   @id @default(uuid()) @db.Uuid
  userId      String   @map("user_id") @db.Uuid
  fromPlan    Plan     @map("from_plan")
  toPlan      Plan     @map("to_plan")
  changedById String   @map("changed_by_id") @db.Uuid
  note        String
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  user        User     @relation("PlanChangeSubject", fields: [userId], references: [id], onDelete: Cascade)
  actor       User     @relation("PlanChangeActor", fields: [changedById], references: [id])

  @@index([userId])
  @@map("plan_changes")
}

model RewriteAttempt {
  id                   String            @id @default(uuid()) @db.Uuid
  attemptId            String            @map("attempt_id") @db.Uuid
  revision             Int
  parentAttemptId      String?           @map("parent_attempt_id") @db.Uuid
  userId               String            @map("user_id") @db.Uuid
  promptId             String            @map("prompt_id") @db.Uuid
  status               AttemptStatus    @default(started)
  userEn               String?           @map("user_en")
  promptTextViSnapshot  String            @map("prompt_text_vi_snapshot")
  sampleEnSnapshot     String            @map("sample_en_snapshot")
  targetsSnapshot      Json             @map("targets_snapshot")
  topicIdSnapshot      String            @map("topic_id_snapshot") @db.Uuid
  scoredAt             DateTime?        @map("scored_at") @db.Timestamptz(6)
  overallScore         Int?            @map("overall_score")
  ideaMatchStatus      IdeaMatchStatus? @map("idea_match_status")
  ideaMatchCommentVi   String?          @map("idea_match_comment_vi")
  feedback             Json?
  displayIssues        Json?           @map("display_issues")
  model                String?
  promptVersion        String?          @map("prompt_version")
  inputTokens          Int?            @map("input_tokens")
  outputTokens         Int?            @map("output_tokens")
  costEstimateUsd      Decimal?         @map("cost_estimate_usd") @db.Decimal(12, 6)
  latencyMs            Int?            @map("latency_ms")
  requestId            String?          @map("request_id")
  quotaCharged         Boolean          @default(false) @map("quota_charged")
  failReason           String?          @map("fail_reason")
  createdAt            DateTime        @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt            DateTime        @updatedAt @map("updated_at") @db.Timestamptz(6)
  user                 User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  prompt               Prompt           @relation(fields: [promptId], references: [id])
  parent               RewriteAttempt?  @relation("AttemptRevision", fields: [parentAttemptId], references: [id])
  children             RewriteAttempt[] @relation("AttemptRevision")

  @@unique([attemptId, revision])
  @@index([userId, scoredAt])
  @@index([userId, promptId])
  @@map("rewrite_attempts")
}

model SrsCard {
  id                      String    @id @default(uuid()) @db.Uuid
  userId                  String    @map("user_id") @db.Uuid
  lemmaId                 String    @map("lemma_id") @db.Uuid
  status                  SrsStatus @default(new)
  ef                      Float     @default(2.5)
  repetitions             Int       @default(0)
  intervalDays            Int       @default(0) @map("interval_days")
  nextReviewAt            DateTime  @map("next_review_at") @db.Timestamptz(6)
  hiddenAt                DateTime? @map("hidden_at") @db.Timestamptz(6)
  countedTowardDailyNew   Boolean   @default(false) @map("counted_toward_daily_new")
  addedFromAttemptId      String?   @map("added_from_attempt_id") @db.Uuid
  addedRevision           Int?     @map("added_revision")
  createdAt               DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt               DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  user                    User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  lemma                   Lemma     @relation(fields: [lemmaId], references: [id])
  reviews                 SrsReview[]

  @@unique([userId, lemmaId])
  @@index([userId, nextReviewAt])
  @@map("srs_cards")
}

model ReviewSession {
  id          String    @id @default(uuid()) @db.Uuid
  userId      String    @map("user_id") @db.Uuid
  cap         Int
  gradedCount Int       @default(0) @map("graded_count")
  startedAt   DateTime  @default(now()) @map("started_at") @db.Timestamptz(6)
  endedAt     DateTime? @map("ended_at") @db.Timestamptz(6)
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  reviews     SrsReview[]

  @@index([userId, startedAt])
  @@map("review_sessions")
}

model SrsReview {
  id        String        @id @default(uuid()) @db.Uuid
  cardId    String        @map("card_id") @db.Uuid
  sessionId String        @map("session_id") @db.Uuid
  mode      ReviewMode
  quality   Int
  createdAt DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)
  card      SrsCard      @relation(fields: [cardId], references: [id], onDelete: Cascade)
  session   ReviewSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
  @@index([cardId])
  @@map("srs_reviews")
}

model UserDailyActivity {
  userId          String   @map("user_id") @db.Uuid
  date            DateTime @db.Date
  rewriteNewCount Int      @default(0) @map("rewrite_new_count")
  reviewCount     Int      @default(0) @map("review_count")
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, date])
  @@map("user_daily_activity")
}

model ImportBatch {
  id            String    @id @default(uuid()) @db.Uuid
  adminId       String    @map("admin_id") @db.Uuid
  filename      String
  schemaVersion Int       @map("schema_version")
  strict        Boolean
  result        Json
  committedAt   DateTime? @map("committed_at") @db.Timestamptz(6)
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  admin         User      @relation(fields: [adminId], references: [id])

  @@map("import_batches")
}

model AnalyticsEvent {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String?  @map("user_id") @db.Uuid
  name      String
  props     Json
  requestId String?  @map("request_id")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  user      User?    @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([name, createdAt])
  @@map("analytics_events")
}

model AuditLog {
  id         String   @id @default(uuid()) @db.Uuid
  actorId    String?   @map("actor_id") @db.Uuid
  action      String
  targetType String    @map("target_type")
  targetId   String?   @map("target_id")
  props      Json
  requestId  String?   @map("request_id")
  createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  actor      User?     @relation("AuditActor", fields: [actorId], references: [id], onDelete: SetNull)

  @@index([action, createdAt])
  @@index([actorId])
  @@map("audit_logs")
}

model BetaAllowlistEmail {
  email       String   @unique // always lower(trim)
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  createdById String   @map("created_by_id") @db.Uuid
  createdBy   User     @relation(fields: [createdById], references: [id])

  @@map("beta_allowlist_emails")
}

model QuotaGrant {
  id               String   @id @default(uuid()) @db.Uuid
  userId           String   @map("user_id") @db.Uuid
  date             DateTime @db.Date
  extraRewriteNew  Int      @map("extra_rewrite_new")
  extraRetry       Int      @map("extra_retry")
  reason           String
  createdById      String   @map("created_by_id") @db.Uuid
  createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  user             User     @relation("QuotaGrantUser", fields: [userId], references: [id], onDelete: Cascade)
  actor            User     @relation("QuotaGrantActor", fields: [createdById], references: [id])

  @@index([userId, date])
  @@map("quota_grants")
}

model ImpersonationSession {
  id        String    @id @default(uuid()) @db.Uuid
  actorId    String    @map("actor_id") @db.Uuid
  targetId   String    @map("target_id") @db.Uuid
  reason     String
  expiresAt  DateTime  @map("expires_at") @db.Timestamptz(6)
  endedAt    DateTime? @map("ended_at") @db.Timestamptz(6)
  createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  actor      User      @relation("ImpersonationActor", fields: [actorId], references: [id])
  target     User      @relation("ImpersonationTarget", fields: [targetId], references: [id], onDelete: Cascade)

  @@index([actorId, endedAt])
  @@map("impersonation_sessions")
}
```

Rate-limit SoT = Redis, không bảng PG. Seed `plan_limits` (free/premium/staff) lúc migrate. Constraint `char_length` và unique từng phần: SQL mục 7.6.

---

## Phụ lục B — JSON submit rewrite (200)

```json
{
  "attemptId": "…",
  "revision": 1,
  "scoredAt": "2026-09-13T07:01:00.000Z",
  "overallScore": 72,
  "ideaMatch": { "status": "enough", "commentVi": "…" },
  "usedRequiredWords": [
    { "headword": "deadline", "used": true, "natural": true, "commentVi": "…" }
  ],
  "displayIssues": [],
  "naturalnessNoteVi": "…",
  "encouragementVi": "…",
  "modelRewriteEn": "…",
  "showModelRewriteToggle": false,
  "revisionUntil": "2026-09-13T07:16:00.000Z",
  "revisionAvailable": true,
  "cardsAdded": [{ "cardId": "…", "lemmaId": "…", "headword": "deadline", "undoable": true }],
  "cardsDeferredCap20": [],
  "quota": { "rewriteNewLeft": 8, "retryLeft": 3 }
}
```

`showModelRewriteToggle`: `true` chỉ khi `revision==2` form **trước nộp** lấy từ GET rev1 `overallScore < 50`. Response lần 1: luôn có `modelRewriteEn` để UI đặt sau checklist (không phải hero).

---

*Hết design v1.3.1. Đổi D1–D12 hoặc PRD v1.4+ phải bump phiên bản file này.*

