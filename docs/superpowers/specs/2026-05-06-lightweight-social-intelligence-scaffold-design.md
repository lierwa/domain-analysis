# Lightweight Social Intelligence Scaffold Design

## Goal

Build the first project scaffold for the Social Intelligence Dashboard described in `init-plan.md`, optimized for a 2-core/2GB cloud server. The scaffold must avoid Docker, keep runtime dependencies light, and provide clear module boundaries for the stage 1 MVP workflow: Topic -> Query -> Source -> Task -> Content -> Analytics -> Report.

## Design Basis

- Fastify is selected because its official documentation emphasizes low overhead, TypeScript support, schema-oriented APIs, and high performance for Node.js services.
- SQLite is selected because the official SQLite guidance positions it as low-administration, efficient local application storage. This matches a small single-server MVP better than PostgreSQL.
- Drizzle ORM is selected because its official documentation supports SQLite/libSQL and keeps schema definitions close to TypeScript types without a heavy runtime layer.
- Crawlee is retained from the PRD because it is a mature crawler framework with Cheerio and Playwright integration. The MVP must prefer Cheerio/static fetch paths and reserve Playwright for sources that truly need browser automation.
- Tailwind CSS is selected for the UI because the product needs a responsive PC/mobile interface with a constrained black/white visual system and low custom CSS overhead.

## Architecture

The MVP will be a TypeScript monorepo with npm workspaces:

- `apps/api`: Fastify HTTP API. It exposes module routes for topics, queries, sources, tasks, contents, analytics, reports, settings, and health checks.
- `apps/web`: Vite + React + Tailwind CSS dashboard. It provides responsive page shells and feature views for the stage 1 navigation.
- `packages/db`: Drizzle SQLite schema and database client.
- `packages/shared`: Zod schemas, enums, and DTOs shared by API, web, and worker.
- `packages/worker`: Lightweight in-process task runner using `p-queue`. It owns crawl/clean/analyze/report job orchestration.
- `data`: local runtime directory for SQLite files, captured HTML/screenshots, and generated Markdown reports.

## Runtime Strategy

No Docker is used. Development starts API and Web separately through npm scripts. Production can run one built Fastify process behind Nginx/Caddy and serve the built web assets as static files or through a separate lightweight static server.

The MVP replaces PostgreSQL + Redis + BullMQ with SQLite-backed task state and `p-queue` concurrency control. This is a deliberate trade-off: it reduces operational memory and deployment complexity now, while preserving task repository boundaries so Redis/BullMQ can be introduced later without rewriting the UI or API contracts.

## Database Scope

The initial schema includes the PRD stage 1 entities:

- Topic
- Query
- Source
- CrawlTask
- RawContent
- CleanedContent
- AnalyzedContent
- TrendSnapshot
- Report

JSON-like fields are stored as text in SQLite and validated at the application boundary through Zod. This keeps SQLite simple while preserving a migration path to native JSON columns in PostgreSQL later.

## UI Scope

The first UI is a responsive operational dashboard, not a landing page. It uses black/white theme tokens with subtle gray borders and states. The layout has:

- Desktop: fixed sidebar + main workspace.
- Mobile: compact top navigation + scrollable content sections.
- Pages: Overview, Topics, Queries, Sources, Tasks, Content Library, Analytics, Reports, Settings.

## API Scope

The scaffold provides working health and metadata endpoints plus route modules for each stage 1 domain. Domain routes initially return typed placeholder data from service boundaries so the frontend can be wired without fake ad hoc structures. Actual crawler and AI behavior will be implemented incrementally behind the existing service/repository interfaces.

## Worker Scope

The worker package defines a task queue abstraction with explicit concurrency defaults suitable for 2-core/2GB:

- crawl concurrency: 1 by default
- analysis concurrency: 1 by default
- report generation: synchronous or single queued job

Playwright is not started by default. Crawlee adapters are scaffolded as extension points, with Cheerio/static collection as the preferred first implementation path.

## Error Handling

Validation errors use Zod schemas and return structured API errors. Task failures are persisted with status and error message fields. Worker failures should update task status instead of crashing the process.

## Testing

The scaffold includes Vitest for shared schema and API health behavior. The first tests verify that the shared enums/schema accept valid stage 1 payloads and that the API can build a server instance with a health route.

## Trade-Offs

SQLite is not ideal for high-concurrency multi-worker deployments, but it is the correct MVP choice for a small single-server system. `p-queue` is not a distributed queue, but it avoids Redis memory/ops cost and is enough for one server. Tailwind does not provide prebuilt enterprise components like MUI, so the scaffold must define reusable local UI primitives early to avoid copy-paste UI logic.
