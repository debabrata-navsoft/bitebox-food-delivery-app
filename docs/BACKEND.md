# BiteBox Backend: Developer Guide

This guide explains how the BiteBox API is built: the stack, how the code is organised, how a request travels through it, and the shared mechanisms every feature relies on (auth, permissions, the order state machine, dispatch, payments, notifications, ledgers, realtime). It ends with how to test, run and extend it.

- **Who it is for:** developers working on `backend/`.
- **What it does not repeat:** endpoint-by-endpoint details and business rules are in [DOCUMENTATION.md](DOCUMENTATION.md) (note: its backend chapters still describe the earlier Node version; this guide describes the current Django code). The live API contract is Swagger at `http://localhost:8000/api/docs`.

## 1. Stack at a glance

| Area | Choice |
|---|---|
| Language | Python 3.12 |
| Framework | Django 5.2, Django REST framework 3.18, `djangorestframework-camel-case` (JSON is camelCase on the wire, snake_case in Python) |
| Database | PostgreSQL 16 + PostGIS 3.4 (via psycopg 3). No GeoDjango/GDAL: a small custom `PointField` and SQL functions in `common/` |
| Realtime | Django Channels 4 (one WebSocket at `/ws/`), Redis channel layer |
| Background jobs | Celery 5 worker + beat, Redis broker |
| Server | uvicorn (ASGI); Daphne for `runserver` in development |
| API docs | drf-spectacular (OpenAPI 3) |
| Auth | PyJWT (HS256 access tokens), Argon2 password hashing (bcrypt accepted for imported hashes) |
| Integrations | Razorpay, Cloudinary, SMTP, Web Push (pywebpush), FCM, MSG91 SMS, Nominatim/Photon (geocoding), OSRM (routing) |
| Quality | pytest + pytest-django, ruff (format + lint), mypy with Django/DRF plugins, pip-audit |

Pinned versions are in `backend/requirements/base.txt` (runtime) and `requirements/dev.txt` (tools).

## 2. Folder layout

```
backend/
├── manage.py                 # defaults to config.settings.development
├── pyproject.toml            # ruff, pytest, mypy configuration
├── requirements/             # base.txt, dev.txt, prod.txt
├── config/
│   ├── settings/             # base, development, test, staging, production
│   ├── urls.py               # /api/v1/... + docs + uploads
│   ├── asgi.py, routing.py   # HTTP + WebSocket (/ws/)
│   ├── wsgi.py
│   └── celery.py             # Celery app and the beat schedule
├── common/                   # shared building blocks (envelope, errors, permissions, paging, geo, crypto…)
├── apps/                     # one Django app per business area (22 folders)
├── tests/                    # cross-cutting tests (access matrix, security, OpenAPI, Postgres)
├── conftest.py               # shared pytest fixtures
├── docker/entrypoint.sh      # api | worker | beat | migrate
├── Dockerfile, docker-compose.yml
└── private-uploads/          # KYC files (never served by URL)
```

## 3. Configuration

Settings live in `config/settings/` and read `backend/.env` through django-environ (template: `.env.example`).

| Module | Used for | Notable behaviour |
|---|---|---|
| `base.py` | Everything shared | Apps, middleware, DRF defaults, JWT, rate limits, storage, maps, payments, notifications |
| `development.py` | `manage.py`, local uvicorn | DEBUG on; if Redis isn't running it falls back to an in-memory channel layer and runs Celery tasks eagerly |
| `test.py` | pytest | Fast hashing, local uploads, mock payments, eager Celery, in-memory channels. **Requires `TEST_DATABASE_URL` whose database name ends in `_test`** (it refuses to start otherwise) |
| `production.py` | Deployments | Requires strong `SECRET_KEY`/`JWT_SECRET`, `SMTP_HOST`, `FIELD_ENCRYPTION_KEY`, `ALLOWED_HOSTS`; forces mock payments off; HSTS, secure cookies, shared Redis cache |
| `staging.py` | Staging | Production settings with a short HSTS |

Main setting groups (names only): `DATABASE_URL`, `REDIS_URL`, `JWT_*`, `REFRESH_*`, `SIGNUP_OTP_REQUIRED`, `OTP_*`, `*_RATE_LIMIT`, `SMTP_*`, `UPLOAD_DIR`, `PRIVATE_UPLOAD_DIR`, `FIELD_ENCRYPTION_KEY`, `CLOUDINARY_*`, `RESTAURANT_KYC_REQUIRED`, `RIDER_KYC_REQUIRED`, `OFFER_APPROVAL_REQUIRED`, `GEOCODER_*`, `ROUTING_*`, `RAZORPAY_*`, `PAYMENTS_MOCK_ENABLED`, `VAPID_*`, `PUSH_ALLOWED_HOSTS`, `SMS_PROVIDER`, `MSG91_*`, `FCM_CREDENTIALS_FILE`, `DISPATCH_SWEEP_ON_REQUESTS`, `REPORT_TIMEZONE`.

> Never commit `backend/.env` or paste its values anywhere.

## 4. How a request flows

```
HTTP request
  → middleware (CORS, security, CamelCase, DispatchSweepMiddleware)
  → config/urls.py → apps/<app>/urls.py
  → APIView: permission_classes check (deny by default)
  → validated(Serializer, request.data / query_params)      # 422 on bad input
  → apps/<app>/services.py  (business logic, transactions)
  → Django models / PostgreSQL
  → ok(data)  →  {"success": true, "message": "...", "data": ...}
```

- **Views stay thin.** They check permissions, validate input with `common.validation.validated(...)` (which returns only declared fields) and call a service function.
- **Services hold the logic.** They take plain values and the acting user, use `transaction.atomic()` for multi-row writes, and raise `common.api.ApiError` for anything the client should see.
- **One response shape.** `common.api.ok()` wraps success; `common.exceptions.exception_handler` turns every error into `{success: false, message, code, details}`. Validation errors become 422 `VALIDATION_ERROR` with `details` keyed by field path. Unknown `/api/...` routes return a JSON 404; unexpected errors become a generic 500 (details only in logs, with secrets redacted by `common/log_redaction.py`).
- **Paging.** List endpoints use `common.pagination.Page` / `paginate()` and return `{items, pagination: {page, limit, total, totalPages}}` (default 20, max 100).
- **Rate limits.** `common.throttling.rate_limit(SETTING, message)` on views; counters live in the cache (Redis in production).
- **No trailing slashes** in routes. About 229 routes across the apps.

### URL map

Everything is under `/api/v1/` (except docs and public image files):

| Prefix | Who | Examples |
|---|---|---|
| `auth/…` | Anyone / signed in | register, login, OTP, refresh, logout, me |
| `restaurants`, `categories`, `foods`, `geo/…` | Public | catalogue, search, menus, place search, routes |
| `cart`, `orders`, `addresses`, `payments/…`, `coins/…`, `support/…` | Customers | ordering and account features |
| `my/restaurant/…` | Restaurant partners | profile, menu, orders, offers, earnings, reviews |
| `delivery/…` | Riders | availability, offers, current order, earnings |
| `admin/…` | Admin roles (by permission) | dashboards, accounts, orders, finance, coupons, support, audit log |
| `health`, `health/live`, `health/ready` | Monitoring | DB, Redis and worker checks |
| `/api/docs`, `/api/docs.json` | Developers | Swagger UI and the raw schema |
| `/uploads/images/<name>` | Public | locally stored images |

## 5. The `common/` package

| Module | What it gives you |
|---|---|
| `api.py` | `ApiError` (+ `bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`), `ok()` |
| `exceptions.py` | The DRF exception handler, JSON 404/500 |
| `validation.py` | `validated()`, `field_error()`, `parse_id()`, `PageQuery` |
| `pagination.py` | `Page`, `paginate()` |
| `permissions.py` | `PUBLIC`, `IsSignedIn` (default), `role_required(*roles)`, `permission_required(*perms)` (any one) |
| `models.py` | `BaseModel` (UUIDv7 `id`, `created_at`, `updated_at`), `AppendOnlyModel` (logs), `RatingSummary`, constraint helpers |
| `fields.py`, `filters.py` | Serializer fields (`PaiseField`, `UUIDRef`…), admin list filters and facets |
| `geo.py`, `geo_sql.py` | `GeoPoint`, `haversine_m`, `PointField`; `DWithin`, `Distance` SQL helpers |
| `crypto.py` | AES-256-GCM `encrypt`/`decrypt`/`last4` for sensitive fields |
| `schema.py` | OpenAPI helpers: `envelope()`, `errors(*codes)`, `pagination()` |
| `throttling.py`, `http.py` | Rate limits; `PublicCacheMixin` (60 s CDN cache on public reads) |
| `pdf.py` | Dependency-free A4 PDF writer (invoices, statements) |
| `health.py`, `log_redaction.py`, `migration_ops.py`, `slug.py`, `ids.py` | Health checks, log scrubbing, Postgres-only migration ops, slugs, `uuid7()` |
| `seed.py` + `management/commands/seed.py` | Development seed data (see §12) |

## 6. Apps

| App | Responsibility | Key models |
|---|---|---|
| `accounts` | Users, sign-up/sign-in, sessions, OTP codes, profile, admin account management | `User`, `Session`, `OtpChallenge` |
| `rbac` | Roles and permissions (`roles.py` only, no models) | — |
| `audit` | Admin audit log (`@audited` decorator) | `AuditLog` |
| `customers` | Saved delivery addresses | `Address` |
| `restaurants` | Partner onboarding, admin review, public discovery and search | `Restaurant` |
| `menus` | Food categories and dishes | `FoodCategory`, `FoodItem` |
| `cart` | One cart per customer; the server-side price quote | `Cart`, `CartItem` |
| `coupons` | Coupons and offers (restaurant, platform, payment), approval queue | `Coupon`, `CouponRedemption` |
| `orders` | Placing orders, the status state machine, panel and ops views | `Order`, `OrderItem`, `OrderStatusHistory`, `OrderCancellation` |
| `delivery` | Rider profile, vehicle, availability, location | `DeliveryPartner`, `RiderVehicle`, `RiderAvailabilityLog` |
| `dispatch` | Matching riders to orders, offers, the sweep | `DeliveryAssignment`, `DispatchSettings` |
| `payments` | COD, Razorpay and mock payments, refunds, webhooks, saved cards | `Payment`, `Refund`, `WebhookEvent`, `SavedCard` |
| `finance` | Settlements, double-entry ledger, payouts, commission, invoices, reports | `OrderSettlement`, `LedgerEntry`, `Payout`, `CommissionRule`, `Invoice` |
| `coins` | Coins wallet and ledger, referrals, campaigns, welcome/birthday rewards | `CoinWallet`, `CoinTransaction`, `CoinBatch`, `Referral`, `RewardCampaign`… |
| `reviews` | Order, restaurant and dish reviews, replies, reports, moderation | `Review`, `ReviewResponse`, `ReviewReport`… |
| `support` | Support tickets and messages | `SupportTicket`, `SupportMessage`, `SupportTicketEvent` |
| `kyc` | Partner documents and payout bank account | `KycDocument`, `PayoutAccount` |
| `uploads` | Image uploads (type check, metadata strip, storage) | — |
| `geo` | Place search and routing proxies with caching | — |
| `tracking` | Rider GPS points and the tracking view | `TrackingPoint` |
| `notifications` | In-app inbox and push/FCM/email/SMS deliveries | `Notification`, `NotificationDelivery`, `PushSubscription`, `DeviceToken`, `ChannelPreference` |
| `newsletter` | Footer newsletter sign-ups | `NewsletterSubscription` |
| `realtime` | WebSocket consumer and event helpers | — |

Each app follows the same shape: `models.py`, `serializers.py` (input validation), `services.py` (logic), `views.py`, `urls.py`, `tests/`, and `tasks.py` where it has background work. Panels follow URL conventions: `my/restaurant/…` for partners, `delivery/…` for riders, `admin/…` for staff.

## 7. Authentication

- **Access token:** a short-lived HS256 JWT (`apps/accounts/tokens.py`) carrying the user id, role and `token_version`. The browser keeps it in memory only.
- **Refresh token:** random, stored only as a SHA-256 hash in `Session`, sent as the HttpOnly cookie `bb_refresh` scoped to `/api/v1/auth`. Every refresh rotates it. Reusing an old token after a short grace window revokes the whole session family (theft detection); within the grace window, two tabs refreshing together both succeed.
- **Every request re-checks the user:** `BearerAuthentication` reloads the user and rejects the token unless the account is active and `token_version` matches. Password change, suspension and role change bump the version, so they apply immediately.
- **Refresh and logout** also require a trusted `Origin` and the `X-Requested-With: BiteBox` header (CSRF protection for the cookie).
- **One-time codes** (`apps/accounts/otp.py`): 6-digit codes stored as HMACs, 5 attempts, resend waits and hourly limits, by SMS (phone sign-in and verification) or email (sign-up when `SIGNUP_OTP_REQUIRED`, email verification).

## 8. Roles and permissions

Defined in `apps/rbac/roles.py`, applied through `common/permissions.py`.

- **Roles** (`Role`): `customer`, `restaurant`, `delivery`, and the admin roles `admin` (super admin), `operations_admin`, `finance_admin`, `support_admin`, `operator`.
- **Permissions** (`Permission`): 30 strings such as `orders:view`, `orders:manage`, `riders:kyc`, `finance:view`, `accounts:suspend`, `admins:manage`.
- **Who gets what:** the super admin has every permission. Other admin roles get their role preset (`ROLE_PERMISSIONS`) or, when set, the account's `custom_permissions`. `admins:manage` is super-admin only.
- **Implied permissions:** `REQUIRES` lists dependencies (for example `orders:manage` needs `orders:view`); `with_required()` adds them, so a "manage" grant can always read what it manages.
- **In views:** admin endpoints use `permission_required(Permission.X)` (any one of several is enough); panel endpoints use `role_required(Role.RESTAURANT)`. Partner and rider endpoints take their scope from `request.user`, never from ids sent by the client.
- **Deny by default:** the DRF default permission is `IsSignedIn`; public views must set `permission_classes = PUBLIC`, and every public route must be listed in `tests/test_access_control.py`.

## 9. Core business mechanisms

### Order lifecycle (`apps/orders/workflow.py`)

The **only** place an order's status changes.

- `TRANSITIONS[from][to]` lists which actors (customer, restaurant, delivery, admin, system) may make each move: `pending → confirmed → preparing → ready_for_pickup → assigned → arrived_at_restaurant → picked_up → on_the_way → delivered`, plus `rejected` and `cancelled` from the allowed states.
- `transition()` does a conditional update ("still in status X"). Repeating the same move is a no-op; losing a race returns 409 `ORDER_CHANGED`; an illegal move returns 409 `INVALID_TRANSITION`.
- The same transaction writes `OrderStatusHistory` (and `OrderCancellation`). On delivery it creates the `OrderSettlement` and posts it to the finance ledger; on pickup it creates the delivery OTP.
- Side effects run afterwards, each idempotent and isolated: release the coupon, settle or refund the payment, free the rider, close assignments, coins events. Then the realtime `order:updated` event and the status notifications.

### Placing an order and pricing

- `apps/cart/services.py#build_quote` prices the cart on the server, always in **integer paise**: `apps/cart/pricing.py#compute_pricing` (delivery fee, taxes) and `discounts.py#Stack`.
- **Discount stacking:** at most one of each kind, applied in `STACK_ORDER` (restaurant offer → platform offer → coupon → payment offer), each on the food left after the previous one; coins come last. Eligibility is `coupons/services.py#problem` / `assert_eligible`. Restaurants fund only their own offers.
- `apps/orders/services.py#place_order` takes an idempotency key, snapshots items, address and restaurant onto the order, reserves coupon and coins, and starts payment.

### Dispatch (`apps/dispatch/`)

- Finds the nearest free, verified, recently located rider with PostGIS distance (riders within the same 500 m band are equal; the longest idle goes first) and offers the order to **one rider at a time** with a timeout.
- `DeliveryPartner.current_offer` and `active_order` are compare-and-set locks; each order has at most one live `DeliveryAssignment`.
- `sweep(now)` expires unanswered offers, re-dispatches waiting orders, and applies the timeouts: auto-reject orders the restaurant didn't answer, cancel unpaid online orders after the payment window, cancel orders nobody picked up. Tunables are in `dispatch/config.py#DISPATCH`; pickup/delivery ranges are admin-editable (`DispatchSettings`).

### Payments (`apps/payments/`)

- Providers (`providers.py`): cash on delivery, Razorpay (only when both keys are set), and a mock provider for development and tests (never in production). Tests swap providers with `use_online_provider`.
- `services.py` owns every payment state change: start, confirm, mark paid/failed, abandon, refunds (automatic, admin, manual), and the Razorpay webhook (signature-checked, de-duplicated through `WebhookEvent`). `reconcile()` re-checks recent payments every 5 minutes.
- Online orders stay invisible to the restaurant (`submitted_at` empty) until paid.

### Money ledgers

- **Finance** (`apps/finance/ledger.py`): a double-entry ledger; each posting sums to zero and is keyed, so repeating it does nothing. Rows are immutable (database trigger). Settlements per order, payouts, refunds after delivery, commission rules, and numbered PDF invoices (per Indian financial year).
- **Coins** (`apps/coins/wallet.py`): only this module changes wallets. Each operation locks the wallet, takes a deterministic idempotency key (e.g. `order-reward:<orderId>`) and writes an immutable `CoinTransaction` with FIFO batches. Events reach the programme only through `coins/events.py` (best-effort, never fails the caller).

### Notifications (`apps/notifications/`)

- `notify(user_ids, …)` stores inbox rows, emits `notification:new`, and plans one `NotificationDelivery` per external channel (Web Push, FCM, email, SMS) that the type uses and the person allows. It never raises.
- Each delivery is attempted in the background; failures retry with back-off (1, 5, 15, 60 min), then become dead letters that admins can retry. Web Push endpoints must be on `PUSH_ALLOWED_HOSTS` (SSRF guard).
- All emails use one branded layout: `notifications/emails.py` + `templates/emails/layout.{html,txt}`.
- Order messages live in `apps/orders/notifications.py`.

### Sensitive data

- **KYC** (`apps/kyc/`): document numbers and bank accounts are encrypted with `common/crypto.py` (only the last 4 digits are readable); files are stored in `PRIVATE_UPLOAD_DIR` and served only through the API to the owner or a reviewing admin (admin views are audited).
- **Images** (`apps/uploads/`): the real type is detected from the bytes, EXIF/GPS metadata is stripped (keeping JPEG orientation), then stored in Cloudinary (when configured) or on local disk.
- **Audit log** (`apps/audit/`): `@audited(action, resource_type, describe)` on admin views that change data records who did what after a successful response. The log is append-only.

## 10. Realtime (WebSocket)

- One endpoint: `ws://<host>/ws/` (`apps/realtime/consumers.py#RealtimeConsumer`).
- The first frame must be `{"type": "auth", "token": "<access token>"}` within 5 seconds (the token never goes in the URL); the socket closes when the token expires.
- **Groups** come only from the server-side identity: `user.<id>`, `restaurant.<id>` (owners), `admins` (with `orders:view`), plus `order.<id>` joined through `track:join` after a permission check.
- **Client → server:** `ping`, `track:join`, `track:leave`, `rider:location` (riders; rate-limited and checked).
- **Server → client:** `ready`, `ack`, `error`, `order:updated` (ids and statuses only; clients re-read over REST), `order:location`, `notification:new`.
- `emit_order_updated()` is called after commit from the order workflow, dispatch, payments and new-order notifications.

## 11. Background jobs (Celery)

`config/celery.py` defines the beat schedule. Run **exactly one** beat.

| Job | Task | Every |
|---|---|---|
| Dispatch sweep (offers, timeouts, payment window) | `dispatch.sweep` | 15 s |
| Notification retries | `notifications.retry` | 60 s |
| Payment reconciliation | `payments.reconcile` | 5 min |
| Coins and rewards sweep | `coins.rewards_sweep` | 2 min |
| Birthday rewards | `coins.birthday_sweep` | every 15 min |
| Purges (notifications, tracking points, sessions/codes) | `*.purge` | daily |

Without Redis in development, tasks run inline (eager). With `DISPATCH_SWEEP_ON_REQUESTS`, API requests can also trigger the sweep.

## 12. Running it locally

From `backend/`:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements/dev.txt
cp .env.example .env                       # then fill in DATABASE_URL etc.
.venv/bin/python manage.py migrate
.venv/bin/uvicorn config.asgi:application --reload --port 8000   # API + /ws/
.venv/bin/celery -A config worker --loglevel INFO               # optional in dev
.venv/bin/celery -A config beat                                 # optional in dev
```

- Swagger UI: `http://localhost:8000/api/docs`.
- With Docker: `docker compose up --build` starts PostGIS, Redis, the API, a worker and beat; run migrations with `docker compose run --rm api migrate` (migrations never run on start).
- **Seed data (optional):** `SEED_PASSWORD='Dev-pass-123' .venv/bin/python manage.py seed` creates fictional `@bitebox.test` accounts, categories, a restaurant with dishes, coupons, an address and a rider. It only creates missing rows and refuses production settings. The data is defined in `common/seed.py`.

## 13. Testing and quality

```bash
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/bitebox_test .venv/bin/pytest
.venv/bin/pytest apps/orders -q                    # one app
.venv/bin/pytest -k "dispatch"                     # matching tests
.venv/bin/ruff format . && .venv/bin/ruff check . && .venv/bin/mypy .
```

- **Database:** tests need a PostgreSQL + PostGIS database whose name ends in `_test`; never point them at your real database.
- **Size:** about 670 test functions in 60 files: per-app tests in `apps/*/tests/`, plus `common/tests/` and the cross-cutting `tests/`.
- **Cross-cutting suites:** `test_access_control.py` (every route × method × role), `test_security.py` (token tampering, IDOR, headers, CSV injection, EXIF, log redaction), `test_input_fuzzing.py`, `test_postgres.py` (PostGIS, indexes, ledger triggers), `test_openapi.py`, `test_schema.py` (no missing migrations).
- **Fixtures:** `conftest.py` provides `api` (an `APIClient`) and blocks real calls to geocoding/routing services. Tests switch features with helpers such as `use_online_provider`, `use_sender`, and settings like `SIGNUP_OTP_REQUIRED`, `OFFER_APPROVAL_REQUIRED`, `RESTAURANT_KYC_REQUIRED`, `RIDER_KYC_REQUIRED`.
- **CI also runs:** `manage.py check`, `makemigrations --check`, `spectacular --validate --fail-on-warn`, `check --deploy` with production settings, and `pip-audit`.

## 14. Deployment

- `backend/Dockerfile`: a slim two-stage Python 3.12 image running as a non-root user, with a health check on `/api/v1/health/live`.
- `docker/entrypoint.sh` takes one argument: `api` (uvicorn), `worker`, `beat` or `migrate`.
- Production uses `config.settings.production`; the full checklist is in [DOCUMENTATION.md §19](DOCUMENTATION.md).

## 15. Adding a feature: checklist

1. **Model:** add it to the right app, inheriting `BaseModel` (or `AppendOnlyModel` for logs); money as integer paise; run `makemigrations`.
2. **Service:** put the logic in `services.py`; raise `ApiError` for client errors; use `transaction.atomic()`; never change `order.status` outside `orders/workflow.py`, wallets outside `coins/wallet.py`, or ledger rows outside `finance/ledger.py`.
3. **Serializer:** validate input; call `validated()` in the view.
4. **View and URL:** set `permission_classes` (`PUBLIC`, `role_required`, or `permission_required` for admin); add `@audited(...)` to admin views that change data; add `@extend_schema` so Swagger stays complete.
5. **Access matrix:** public routes go in the `PUBLIC` list of `tests/test_access_control.py`.
6. **Realtime/notifications:** emit `order:updated` through the existing helpers; send messages with `notify(...)`.
7. **Tests:** add them next to the app; run pytest, ruff and mypy.

## 16. Known documentation gaps

Found while preparing this guide:

- `CLAUDE.md` still describes the Node backend in several places and mentions `backend-django/`; the Django code now lives in `backend/`.
- `.github/workflows/ci.yml` still has a job pointing at `backend-django/` and an npm job for `backend/`.
- `CLAUDE.md` and `backend/README.md` say tests fall back to SQLite; they don't — a `_test` PostgreSQL database is required.
- [DOCUMENTATION.md](DOCUMENTATION.md) §6, §11 and §18 still describe the Node backend (Express, Socket.IO, `node:test`).
