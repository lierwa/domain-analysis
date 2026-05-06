# ADR 0001 — Phase 2: Topic raw-content merged view (planned)

## Status

Proposed — not implemented in the Topic raw library + E2 milestone.

## Context

`CONTEXT.md` requires:

- B3: merge rows by off-platform identity with optional “expand by Query”.
- D3: merged row shows platform, time, snippet, link, author, and **hit Query names**.
- `external_id` missing: weaker dedupe key (e.g. normalized URL) must be documented.

## Decision (target)

- Add API support: optional `queryId` filter; merged DTO or `?view=merged` / `?expand=1` (exact shape TBD at implementation).
- Document dedupe key precedence: `(platform, external_id)` when `external_id` present; else fallback rule to avoid silent wrong merges.

## Consequences

- Requires SQL or application-level aggregation and join to `queries` for names.
- Frontend toggle state must stay in sync with API mode.
