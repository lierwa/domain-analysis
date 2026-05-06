# Public Reddit and X Collection Plan

> Goal: Crawl public Reddit and X data with open-source crawler infrastructure, low concurrency, and clear rate-limit states. Do not add login automation, proxy pools, captcha bypass, or high-concurrency scraping.

**Open-source basis**
- Crawlee for crawler lifecycle, retries, rate limiting, and conservative concurrency.
- Reddit public JSON endpoints before official OAuth API.
- Nitter RSS/public frontend before X official API or browser automation.

### Task 1: Open-source crawler dependency

- [x] Add `crawlee` to the worker package.
- [x] Use Crawlee crawler classes instead of hand-rolled HTTP crawl loops.

### Task 2: Conservative crawl defaults

- [x] Add shared low-concurrency crawler options.
- [x] Force single concurrency for public collection.
- [x] Add same-domain delay and request-per-minute limits.

### Task 3: Reddit public collection

- [x] Make Reddit public JSON the default collection path.
- [x] Preserve official Reddit API as explicit `REDDIT_COLLECTION_MODE=official_api`.
- [x] Normalize Reddit public JSON into raw content rows.
- [x] Remove secret requirement from default Reddit collection.

### Task 4: X public collection

- [x] Add Nitter RSS adapter as the default X path.
- [x] Preserve official X API as explicit `X_COLLECTION_MODE=official_api`.
- [x] Normalize RSS items into raw content rows.
- [ ] Add instance health tracking and fallback instance rotation.

### Task 5: Non-blocking task execution

- [x] Make crawl API return immediately with a running task.
- [x] Continue collection in the process-local queue.
- [x] Persist success, failure, and rate-limit outcomes.
- [ ] Move queue to durable storage before production deployment.

### Task 6: Playwright fallback

- [ ] Add Playwright-only fallback for public X pages.
- [ ] Keep Playwright concurrency at 1.
- [ ] Add hard page timeout, max scroll count, and browser cleanup.
- [ ] Mark forced-login pages as `login_required` instead of trying to bypass.

### Task 7: Verification

- [x] Run unit tests.
- [x] Run typecheck.
- [x] Run live Reddit public JSON smoke test.
- [ ] Run live X Nitter RSS smoke test with configured instance.
