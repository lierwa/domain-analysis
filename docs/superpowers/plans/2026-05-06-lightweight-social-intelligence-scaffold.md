# Lightweight Social Intelligence Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a lightweight monorepo scaffold for the stage 1 Social Intelligence Dashboard.

**Architecture:** Use npm workspaces with separate API, Web, DB, Shared, and Worker packages. Keep deployment single-server friendly by using Fastify, SQLite/Drizzle, Tailwind CSS, and a local `p-queue` worker instead of Docker, PostgreSQL, Redis, and BullMQ.

**Tech Stack:** TypeScript, Fastify, React, Vite, Tailwind CSS, Drizzle ORM, SQLite/libSQL, Zod, p-queue, Vitest.

---

### Task 1: Workspace Foundation

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `data/.gitkeep`

- [ ] Create npm workspace scripts for `dev`, `build`, `test`, `typecheck`, and per-app commands.
- [ ] Add shared TypeScript compiler settings.
- [ ] Ignore local runtime data while keeping `data/.gitkeep`.

### Task 2: Shared Domain Contracts

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/domain.ts`
- Create: `packages/shared/src/schemas.ts`
- Create: `packages/shared/src/schemas.test.ts`

- [ ] Write Vitest tests for Topic and Query validation.
- [ ] Implement Zod enums and schemas for stage 1 entities.
- [ ] Export stable DTO types from `packages/shared/src/index.ts`.

### Task 3: SQLite Database Package

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/schema.ts`

- [ ] Define Drizzle SQLite tables for Topic, Query, Source, CrawlTask, RawContent, CleanedContent, AnalyzedContent, TrendSnapshot, and Report.
- [ ] Add a lightweight database client factory using `DATABASE_URL`.
- [ ] Keep JSON fields as SQLite text columns for portability.

### Task 4: API App

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/index.ts`
- Create: `apps/api/src/config.ts`
- Create: `apps/api/src/routes/health.ts`
- Create: `apps/api/src/routes/modules.ts`
- Create: `apps/api/src/server.test.ts`

- [ ] Write API health route test first.
- [ ] Build Fastify server factory with health and module routes.
- [ ] Keep routes thin and ready for service/repository implementation.

### Task 5: Worker Package

**Files:**
- Create: `packages/worker/package.json`
- Create: `packages/worker/tsconfig.json`
- Create: `packages/worker/src/index.ts`
- Create: `packages/worker/src/taskQueue.ts`
- Create: `packages/worker/src/jobs.ts`

- [ ] Define a `TaskQueue` wrapper around `p-queue` with conservative concurrency defaults.
- [ ] Add placeholder job handlers for crawl, clean, analyze, and report generation.
- [ ] Add Chinese WHY comments around concurrency and Playwright deferral.

### Task 6: Web App

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/index.html`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/postcss.config.js`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/styles.css`
- Create: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/components/AppShell.tsx`
- Create: `apps/web/src/pages/*.tsx`

- [ ] Build Tailwind black/white theme tokens.
- [ ] Create responsive shell for desktop sidebar and mobile top nav.
- [ ] Add stage 1 pages with real navigation and typed placeholder content.

### Task 7: Verification

**Files:**
- Modify: project scripts only if verification reveals command issues.

- [ ] Run `npm install` if dependencies are missing.
- [ ] Run `npm test`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Record any environment limitation explicitly.
