# Reddit and X Collection Implementation Plan

> Superpowers-managed execution plan. Update checkboxes as tasks complete.

**Goal:** Run real Reddit and X/Twitter collection jobs from configured queries and show persisted task/content results.

**Architecture:** Keep the single-server MVP architecture: Fastify API, Drizzle/SQLite repositories, `p-queue` worker, official platform APIs, React Query UI.

---

### Task 1: Shared Contracts

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/schemas.test.ts`

- [x] Add raw content DTO schema for list views.
- [x] Reuse existing `taskStatuses` and `platforms`.

### Task 2: DB Repositories

**Files:**
- Modify: `packages/db/src/repositories.ts`
- Modify: `packages/db/src/topicQuerySourceRepository.test.ts`

- [x] Add crawl task repository create/list/update helpers.
- [x] Add raw content repository insert/list helpers.
- [x] Deduplicate raw content by platform + external id.

### Task 3: Platform Adapters

**Files:**
- Create: `packages/worker/src/adapters/types.ts`
- Create: `packages/worker/src/adapters/reddit.ts`
- Create: `packages/worker/src/adapters/x.ts`
- Modify: `packages/worker/src/jobs.ts`

- [x] Implement Reddit OAuth token exchange and submission search.
- [x] Implement X API v2 recent search.
- [x] Normalize both sources into shared raw content input.
- [x] Fail clearly when credentials are missing.

### Task 4: API Routes

**Files:**
- Create: `apps/api/src/routes/crawlRoutes.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/routes/topicQuerySourceRoutes.test.ts`

- [x] Add `GET /api/crawl-tasks`.
- [x] Add `POST /api/queries/:id/crawl`.
- [x] Add `GET /api/raw-contents`.

### Task 5: Web Wiring

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/api.test.ts`
- Modify: `apps/web/src/pages/QueriesPage.tsx`
- Modify: `apps/web/src/pages/TasksPage.tsx`
- Modify: `apps/web/src/pages/ContentPage.tsx`

- [x] Add Run buttons for Reddit and X query collection.
- [x] Render persisted task rows.
- [x] Render raw content rows.

### Task 6: Verification

- [x] Run `npm test`.
- [x] Run `npm run typecheck`.
- [x] Run `npm run build`.
- [x] Record credential limitations.
