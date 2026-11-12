# BiteBox API (Django)

The Django + DRF + Channels + Celery backend that replaces the Node API in `../backend`, phase by phase. The plan, decisions and data model are in [`docs/django-migration/`](../docs/django-migration/README.md). Until the switch-over, the Node API remains the one the web app uses.

**Status: Phase 5 (sign-in and permissions).**
- **Built:** settings per environment, the response envelope and error contract, pagination, role and permission classes, health endpoints, OpenAPI, the WebSocket endpoint (with no sign-in yet), Celery, Docker files and CI. Also the full parity schema (45 tables in 17 apps, see [03 §3.5](../docs/django-migration/03-data-model.md#35-phase-4-implementation-notes-what-changed-from-the-plan-above)) and `manage.py seed`.
- **Not yet:** business endpoints, which start with sign-in in Phase 5.

## Quick start (without Docker)

Requires Python 3.12+.

```bash
cd backend-django
python3 -m venv .venv && .venv/bin/pip install -r requirements/dev.txt
cp .env.example .env

.venv/bin/pytest                    # tests (in-memory SQLite unless TEST_DATABASE_URL is set)
.venv/bin/ruff format . && .venv/bin/ruff check . && .venv/bin/mypy .

# Run the API on :8000 (a PostgreSQL and Redis are expected; see below)
.venv/bin/uvicorn config.asgi:application --reload --port 8000
```

Without PostgreSQL or Redis, the API still starts:
- `/api/v1/health` reports what is missing and returns 503.
- For local WebSocket work without Redis, set `CHANNEL_LAYER_IN_MEMORY=true` (single process, development only).
- `DATABASE_URL=sqlite:///dev.sqlite3` works for the skeleton. From Phase 4 (PostGIS models), a real PostgreSQL with PostGIS is required.

## Local PostgreSQL (Ubuntu 24.04, without Docker)

```bash
sudo apt install -y postgresql postgresql-16-postgis-3
sudo -u postgres psql <<'SQL'
CREATE ROLE bitebox LOGIN CREATEDB PASSWORD 'choose-a-password';
CREATE DATABASE bitebox OWNER bitebox;
SQL
# PostGIS needs a superuser once; template1 makes every new (test) database inherit it
for db in template1 bitebox; do
  sudo -u postgres psql -d "$db" -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pg_trgm;"
done
```

Then set both URLs in `.env`. Use a password of letters and digits, or URL-encode it.

```
DATABASE_URL=postgres://bitebox:choose-a-password@localhost:5432/bitebox
TEST_DATABASE_URL=postgres://bitebox:choose-a-password@localhost:5432/bitebox_test
```

- **Test database:** pytest creates `bitebox_test` at the start of each run and drops it at the end, which is why the role needs `CREATEDB`. To keep it between runs (faster), use `pytest --reuse-db`, and add `--create-db` after changing migrations.
- **PostgreSQL-only tests:** `tests/test_postgres.py` covers PostGIS, the indexes and the ledger trigger. It runs only against PostgreSQL.

## Quick start (Docker)

```bash
cd backend-django && cp .env.example .env
docker compose up --build           # db (PostGIS), redis, api (:8000, reload), worker, beat
docker compose run --rm api migrate
```

## Development data

```bash
.venv/bin/python manage.py migrate
SEED_PASSWORD='Dev-pass-123' .venv/bin/python manage.py seed      # idempotent; --reset-passwords to reset
```

This creates the same fictional accounts as the Node seed (`admin@`, `customer@`, `restaurant@`, `rider@`, `operations@`, `finance@` and `support@bitebox.test`). It also creates *Spice Route Kitchen* with 8 dishes, the coupons `WELCOME50` and `FLAT75`, a customer address and a rider vehicle. It refuses staging and production settings.

## Schema conventions

- **Base fields:** every table has a UUIDv7 `id`, `created_at`/`updated_at` (UTC), and a `legacy_id` holding the MongoDB id for imported rows (`common/models.py`).
- **Money:** integer paise (`*_paise`, `BigIntegerField`), with CHECK constraints. An order's total must add up exactly as the pricing service computes it.
- **Points:** use `common.geo.PointField`, with values as `GeoPoint(lat, lng)`. It's PostGIS `geography(Point,4326)` on PostgreSQL. No GDAL is needed.
- **Enums:** `TextChoices` with the same strings as Node, and the database refuses unknown values (`one_of(...)`).
- **Coin ledger:** rows are immutable. The model and queryset refuse edits and deletes, and on PostgreSQL a trigger enforces the same rule.
- **PostgreSQL-only DDL** (indexes, extensions, triggers) goes through `common/migration_ops.py`, so local SQLite test runs skip it.

## Endpoints so far

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/health` | Database, Redis and Celery workers. 503 if the database or Redis is down. |
| GET | `/api/v1/health/live` | Process is up (no dependencies) |
| GET | `/api/v1/health/ready` | Database and Redis reachable |
| GET | `/api/docs`, `/api/docs.json` | Swagger UI and the OpenAPI document |
| POST | `/api/v1/auth/register`, `/login`, `/refresh`, `/logout`, `/forgot-password`, `/reset-password`, `/change-password` | Sign-in and sessions (same contract as Node; refresh/logout need the `bb_refresh` cookie, `X-Requested-With: BiteBox` and a trusted Origin) |
| GET, PATCH | `/api/v1/auth/me` | Current user / update name and phone |
| GET | `/api/v1/admin/users` · PATCH `/admin/users/{id}/status` | Members (`users:manage`) |
| GET, POST | `/api/v1/admin/admins` · GET, PATCH `/admin/admins/{id}` · PATCH `/admin/admins/{id}/status` | Staff admins (`admins:manage`) |
| GET | `/api/v1/admin/audit-logs` | Audit log (`audit:view`) |
| WS | `/ws/` | Realtime socket. The first frame must be `{"type":"auth","token":"<access token>"}` within 5 s, otherwise it closes with 4401. `{"type":"ping"}` gets a pong. |

## Conventions (same contract as the Node API)

- **Envelope:** views return `common.api.ok(data, message=…, status=…)`.
- **Errors:** client-visible errors raise `common.api.ApiError` (or a DRF exception). The handler in `common/exceptions.py` turns everything into `{ success: false, message, error: { code, details? } }` with `Cache-Control: no-store`. Unknown errors become a generic 500 with no internal details.
- **Validation:** failures return 422 `VALIDATION_ERROR` with `details: [{ field, message }]`. One message per field, with paths like `deliveryAddress.postalCode` and `items[1].quantity`.
- **camelCase:** JSON is camelCase on the wire and snake_case in Python. This applies to bodies, responses and query parameters.
- **Paging:** `?page=&limit=` (clamped, maximum 100). Lists use `common.pagination.paginate()` and return `{ items, pagination: { page, limit, total, totalPages } }`.
- **Access:**
  - Roles use `role_required(Role.X)` and admin endpoints use `permission_required(Permission.X)` (`common/permissions.py`).
  - Roles and permissions live in `apps/rbac/roles.py`, and a test keeps them identical to `backend/config/*.js`.
- **Layout:**
  - Views stay thin. Business logic goes in each app's `services.py`, and reads in `selectors.py`.
  - Each app lives in `apps/<name>/`. Shared code is in `common/` and external providers in `integrations/`.

## Tests and databases

- `pytest` uses `config.settings.test`, which never touches a real database.
- With `TEST_DATABASE_URL` set, the database name **must end in `_test`**, or the run refuses to start. Without it, tests use in-memory SQLite.
- Redis, Celery (eager) and Channels (in-memory layer) run in-process.
- CI runs the suite against real PostGIS and Redis service containers (`.github/workflows/ci.yml`, job `backend-django`).

## Deployment

One image (`Dockerfile`) runs every process. The entrypoint selects it:

| Command | Process |
|---|---|
| `api` | uvicorn ASGI, `WEB_CONCURRENCY` workers |
| `worker` | Celery worker |
| `beat` | Celery beat (exactly one) |
| `migrate` | Database migrations, run as a separate release step and never on API start |

`config.settings.production` refuses to start without `DJANGO_SECRET_KEY` (32+ characters) and `DJANGO_ALLOWED_HOSTS`. CI runs `manage.py check --deploy` against it.
