# Reddit and X Collection Design

## Goal

Add the first real collection slice for Reddit and X/Twitter so the app can run a query, persist crawl task state, and store raw content for review.

## Design Basis

- Reddit collection uses the official OAuth API instead of scraping pages. This follows Reddit's public API boundary and avoids brittle HTML parsing for the first MVP.
- X/Twitter collection uses X API v2 recent search (`/2/tweets/search/recent`) with bearer-token authentication. X documents endpoint-specific limits and a 100 result max per recent-search request, so the MVP caps each run conservatively.
- The existing `p-queue` worker remains the queue layer. This matches the scaffold design for a single 2-core/2GB server and avoids introducing Redis/BullMQ before multi-process execution is required.
- SQLite remains the task and content state store through Drizzle repositories. This keeps task progress visible after API restarts and preserves a later migration path.
- Zod remains the API validation layer. Platform-specific credentials are read from environment variables, not stored in the database.

## Scope

This slice implements:

- Create a crawl task from an existing Query and selected platform.
- Execute Reddit or X collection through platform adapters.
- Persist `crawl_tasks` status, counts, and errors.
- Persist normalized raw content rows in `raw_contents`.
- List crawl tasks for the Tasks page.
- List raw content for the Content Library page.

## Non-Goals

- No browser automation for X login.
- No CAPTCHA, 2FA, or anti-bot bypass.
- No paid full-archive X search.
- No Reddit comments expansion in the first cut; collect matching submissions first.
- No AI cleaning/analysis in this slice.

## Credential Model

Required for Reddit:

- `REDDIT_CLIENT_ID`
- `REDDIT_CLIENT_SECRET`
- `REDDIT_USER_AGENT`

Required for X/Twitter:

- `X_BEARER_TOKEN`

Missing credentials should mark the task as `failed` with a clear error message.

## Data Mapping

Reddit submissions map to `raw_contents`:

- `platform`: `reddit`
- `externalId`: Reddit fullname or id
- `url`: permalink or outbound URL
- `authorName`: author
- `text`: title plus self text
- `metricsJson`: score, comment count, subreddit
- `publishedAt`: created UTC

X tweets map to `raw_contents`:

- `platform`: `x`
- `externalId`: tweet id
- `url`: canonical tweet URL when author username is available, otherwise API URL fallback
- `authorName` / `authorHandle`: user display name and username
- `text`: tweet text
- `metricsJson`: public metrics
- `publishedAt`: created_at

## Trade-Offs

The first Reddit adapter uses direct official HTTP calls instead of `snoowrap` because the common Node wrapper is mature but stale, while this slice only needs read-only search and token exchange. The X adapter uses the official REST endpoint directly rather than a wrapper to keep runtime small; if posting, streaming, or OAuth user-context is added later, `twitter-api-v2` becomes the preferred library.

