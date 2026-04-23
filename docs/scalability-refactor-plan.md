# Scalability Refactor Plan

## Current bottlenecks

1. Dashboard analytics execute many sequential Firestore reads (`N+1` pattern) when sessions grow.
2. Session sorting was partially done client-side after loading all matching docs.
3. Domain logic, Firestore access, and view rendering are mixed in dashboard modules.
4. There is no centralized validation/model layer for Firestore payloads.
5. Rule and UI tests require local emulator/browser setup with no CI workflow to enforce it.

## Recommended target architecture

- **Data layer**: Firestore adapters only (CRUD + query helpers).
- **Domain/service layer**: attendance stats, role constraints, and schedule rules.
- **Presentation layer**: dashboard modules focused on state + rendering only.
- **Shared model schema**: `zod` (or lightweight runtime guards) to validate writes and parse reads.
- **Ops/quality**: GitHub Actions workflow with Firestore emulator for rules tests and Playwright (or Puppeteer with bundled Chrome) for UI smoke tests.

## Prioritized improvements

### P1 (high impact)

- Replace per-session record reads with batched session-id queries.
- Push ordering/filtering into Firestore queries where supported.
- Add pagination for sessions and records in admin dashboards.
- Add composite indexes and capture them in `firestore.indexes.json`.

### P2

- Split `firestore.js` into feature repositories:
  - `repositories/classes-repo.js`
  - `repositories/users-repo.js`
  - `repositories/attendance-repo.js`
- Move analytics functions into `services/attendance-analytics.js`.
- Introduce JSDoc typedefs for all public entities.

### P3

- Add structured telemetry for failed/slow operations.
- Add optimistic UI updates with rollback for attendance marking.
- Consider migrating to TypeScript once module boundaries are stabilized.

## What to remove / simplify

- Remove compatibility wrappers after dashboards consume stable service APIs.
- Remove duplicated Firebase config paths (`js/firebase-config.js` and `js/modules/firebase-config.js`) by keeping one source of truth.
- Remove manual Promise wrappers around `async` code.

## Suggested success metrics

- 60%+ fewer Firestore reads for analytics pages at 100+ sessions.
- <1.5s median dashboard load time on warm cache.
- 90%+ module-level unit test coverage for service layer.
- CI required status checks for rules + UI smoke tests before merge.
