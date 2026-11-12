# BiteBox Django migration: Phase 1 deliverables

Phase 1 output for [MASTER_PROMPT.md](../MASTER_PROMPT.md) (Part C). **No application code has been written.** Implementation starts after these documents and the decisions below are approved.

| Deliverable (MASTER_PROMPT Part C) | Document |
|---|---|
| A. Requirement analysis, assumptions, open questions | [01-requirements-and-scope.md](01-requirements-and-scope.md) |
| K. MVP vs. future releases | [01-requirements-and-scope.md §1.6](01-requirements-and-scope.md#16-mvp-versus-later-releases) |
| B. System architecture diagram | [02-architecture.md §2.1](02-architecture.md#21-system-architecture) |
| C. Workflow diagrams (order, payment, dispatch, refund, KYC) | [02-architecture.md §2.3–2.4](02-architecture.md#23-order-lifecycle-proposed) |
| M. DRF architecture and API strategy | [02-architecture.md §2.5](02-architecture.md#25-drf-strategy) |
| O. Leaflet + OSM + geo adapters, PostGIS decision | [02-architecture.md §2.7](02-architecture.md#27-maps-and-geo-architecture) |
| D. ER diagram | [03-data-model.md §3.2](03-data-model.md#32-er-diagram) |
| E. Table specifications + MongoDB → PostgreSQL mapping | [03-data-model.md §3.3–3.4](03-data-model.md#33-table-specifications) |
| F. API specification (existing + new) | [04-api-spec.md](04-api-spec.md) |
| G. Frontend changes, NexPrime migration inventory | [05-frontend-plan.md](05-frontend-plan.md) |
| L. Signal Forms strategy | [05-frontend-plan.md §5.6](05-frontend-plan.md#56-signal-forms-strategy) |
| N. NexPrime strategy | [05-frontend-plan.md §5.5](05-frontend-plan.md#55-nexprime-strategy) |
| H. Django folder structure | [06-backend-structure-and-milestones.md §6.2](06-backend-structure-and-milestones.md#62-folder-structure) |
| I. Milestones and task breakdown | [06-backend-structure-and-milestones.md §6.4](06-backend-structure-and-milestones.md#64-milestones-and-task-breakdown) |
| J. Risks and security plan | [07-risks-and-security.md](07-risks-and-security.md) |
| Phase 2: NexPrime API check | [08-nexprime-api-check.md](08-nexprime-api-check.md) |
| Phase 2: wireframes for new screens | [09-wireframes.md](09-wireframes.md) |

## Status

| Phase | State |
|---|---|
| 1. Analysis | Done. The decisions below were accepted as recommended when the user said "continue" (12 Nov 2026). Q1–Q4 are still open. |
| 2. UI/UX + theme | Done: dark theme, `ThemeService`, `BbDialog` (CDK) used for every confirm dialog, NexPrime API check, wireframes. |
| 3. Django skeleton | Done: `backend-django/` (settings, envelope and errors, pagination, permissions, health, OpenAPI, `/ws/` protocol, Celery, Docker, CI job). Docker and the PostgreSQL/Redis CI job could not be run locally (see the Phase 3 report). Done. |
| 4. Parity schema | Done: 45 tables in 17 apps, migrations, constraints and indexes, `manage.py seed`, 83 tests, all passing on PostgreSQL 16 + PostGIS 3.4 (local install), including 15 PostgreSQL-only tests: geography columns, KNN, indexes and the ledger trigger. Changes from the plan: [03 §3.5](03-data-model.md#35-phase-4-implementation-notes-what-changed-from-the-plan-above). Done. |
| 5. Auth + RBAC | Done: register, login (with portal check), rotating refresh cookie with reuse detection, logout, forgot/reset/change password, `/auth/me`, admin users, staff admins, audit log, permission classes, WebSocket sign-in. Ported Node `auth.test.js` and the admin-management part of `admin-roles.test.js`: 141 tests pass on PostgreSQL. **Not switched in the frontend:** Django tokens name PostgreSQL users that Node (MongoDB) doesn't know, so `/auth` moves together with the features that use the signed-in user (see the Phase 5 report). OTP login and email verification stay in release 2. Awaiting approval for Phase 6. |

## Key findings

1. The Node backend is complete and well tested (~350 tests). It becomes the **specification**, and its tests become the Django acceptance suite.
2. The frontend already meets the Signal Forms rule (0 Reactive Forms). The Material → NexPrime work is the main frontend cost (107 files; `MatDialog` in 68).
3. NexPrime 0.1.5 has no programmatic dialog service. Recommendation: use `@angular/cdk/dialog` (not Material) behind a small facade.
4. There is no dark theme yet. NexPrime supports `data-theme="dark"`.
5. The backend's Vercel deployment can't run sweeps or sockets. Docker or VM is the only complete target, now and for Django.
6. The largest functional gaps: KYC (FSSAI, documents, bank details), variants and add-ons, delivery OTP, partial refunds, invoices, SMS/OTP login.

## Decisions needing approval

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | Money storage | **Integer paise (`bigint`)**, not `DecimalField` | Exact arithmetic, matches today's API (`*Paise`) and frontend, and avoids conversions at every boundary. Decimals add no precision for INR at paise resolution. |
| D2 | Angular workspace | **Keep the single app** with lazy panels | Already code-split. Splitting adds four builds and cross-app auth with no user benefit. |
| D3 | Order statuses | **Add `arrived_at_restaurant`. Delivery OTP is a precondition on `delivered`. Delivery failure = admin cancellation with a reason.** Add `partially_refunded` payment status. | Smallest change that covers the master prompt's workflow |
| D4 | Roles and permissions storage | **Keep in code** (not `roles`/`role_permissions` tables) | Small fixed set, versioned with code, no extra query per request |
| D5 | Geo | **PostGIS** (GeoDjango) | Exact KNN nearest-rider queries with an index. Available on managed PostgreSQL. |
| D6 | Dialogs | **`@angular/cdk/dialog`** with NexPrime-styled content | NexPrime lacks a programmatic opener. CDK is not Material. |
| D7 | Migration approach | **Build `backend-django/` alongside, keep the API contract, switch over via nginx** | Testable parity, reversible cut-over |
| D8 | Release scope | **MVP = parity + switch-over + delivery OTP + KYC + partial refunds + customer/rider NexPrime** (see 01 §1.6) | Replaces the platform with measurable risk first |
| D9 | Payment providers | **Razorpay only** (Cashfree later behind the same interface) | Already integrated and tested |
| D10 | SMS provider | **MSG91 adapter**, OTP login in release 2 | DLT registration lead time |
| D11 | Hosting | **DigitalOcean** (or your preference): managed PostgreSQL + Redis, Spaces, one app VM/App Platform | Simple, low cost for one city. The design is portable to AWS/Azure. |
| D12 | Existing sessions at cut-over | **Sign everyone out once** (don't migrate refresh sessions) | Simpler and safer. Users sign in again. |

Open questions Q1–Q9 are listed in [01-requirements-and-scope.md §1.3](01-requirements-and-scope.md#13-open-questions). Q1 (is there live production data?) has the biggest effect on the plan.

## Next phase (after approval)

**Phase 2: UI/UX and theme**
- Wireframes for the new screens (05 §5.3).
- Dark theme tokens and `ThemeService`.
- The `BbDialog` (CDK) facade and toast host, proved on one customer dialog.
- A NexPrime component API check (inputs and outputs read from the installed type definitions) for every component in the migration table.

No backend code until Phase 3.
