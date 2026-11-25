# BiteBox: Food Delivery Platform

BiteBox is a full-stack food delivery app with four role-based panels: **Customer**, **Restaurant**, **Delivery partner** and **Admin**. It runs on web, tablet and mobile, and can be installed as a Progressive Web App.

| Part | Stack |
|---|---|
| Frontend | Angular 22 (standalone, signals, zoneless, SSR/prerender, Signal Forms), Angular Material, NexPrime, Leaflet + OpenStreetMap, service worker |
| Backend | Django 5 + Django REST framework, Channels (WebSockets), Celery, uvicorn (ASGI), drf-spectacular |
| Database | PostgreSQL 16 + PostGIS, Redis 7 |
| Integrations | Razorpay, Cloudinary, SMTP, Nominatim (place search), OSRM (road routing) |

> **Status: production ready.** All seven phases are complete: authentication; restaurants and menus; cart and checkout; orders and delivery; maps and live tracking; payments, notifications and reports; and quality and deployment. Admin staff roles, reviews, coins and referrals, support tickets, and PWA install, offline mode and push notifications were added on top.

## Documentation

| Document | What's in it |
|---|---|
| **[docs/DOCUMENTATION.md](docs/DOCUMENTATION.md)** | **The complete reference:** architecture, configuration, roles and permissions, data model, business rules, realtime events, push and PWA, every API endpoint, every screen, security, testing, deployment |
| [docs/BLUEPRINT.md](docs/BLUEPRINT.md) ([PDF](docs/BiteBox-Blueprint.pdf)) | System blueprint: context, architecture and layer diagrams, API map, user journey, data model, order/payment/dispatch/sign-in flows, access model, deployment, measured codebase health, risks and roadmap |
| [docs/FRONTEND.md](docs/FRONTEND.md) ([PDF](docs/BiteBox-FRONTEND-Guide.pdf)) | Frontend developer guide: Angular app structure, building blocks, live data, styling, testing, how to add a page |
| [docs/BACKEND.md](docs/BACKEND.md) ([PDF](docs/BiteBox-BACKEND-Guide.pdf)) | Backend developer guide: Django apps, request flow, auth and permissions, order workflow, dispatch, payments, ledgers, realtime, Celery, testing |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Symptoms, causes and fixes |
| [docs/SECURITY.md](docs/SECURITY.md) | Security audit: findings, fixes, accepted risks and how to rerun the checks |
| [docs/COINS_REWARDS_PLAN.md](docs/COINS_REWARDS_PLAN.md) | Design notes for coins, referrals and campaigns |
| Swagger UI, `http://localhost:8000/api/docs` | The live API contract (raw JSON at `/api/docs.json`) |

## Features

- **Customers:**
  - Find restaurants within 15 km of a delivery point, search dishes, and order with cash or online payment.
  - Track the rider live on a map.
  - Rate the restaurant, the dishes and the delivery.
  - Earn and spend coins, refer friends, and get help through support tickets.
- **Restaurants:** onboarding with admin approval, menu management, a live order board with a new-order chime, review replies and earnings.
- **Riders:** go online, get offers one at a time from nearest-first dispatch, share live GPS, use route maps, and see earnings and ratings.
- **Admins:**
  - **Super admin:** staff admin management, users, catalogue, coupons, rewards, push promotions and the audit log.
  - **Operations:** orders, restaurants, riders and live monitoring.
  - **Finance:** transactions, refunds, payouts, commission and reports.
  - **Support:** tickets and review moderation.
- **Everywhere:**
  - Live updates over Django Channels WebSocket (`/ws/`), an in-app notification inbox, and opt-in browser push notifications.
  - Installable PWA that works offline for pages already seen.
  - Responsive layouts and accessibility to WCAG 2.1 AA.

## Quick start

**Prerequisites:** Python 3.12+, PostgreSQL 16+ (with PostGIS), Redis 7+, Node.js 22+, npm 10+.

```bash
# 1. Backend (Django)
cd backend
python -m venv .venv && .venv/Scripts/pip install -r requirements/dev.txt  # Windows
# (Linux/macOS: python3 -m venv .venv && .venv/bin/pip install -r requirements/dev.txt)
cp .env.example .env
.venv/Scripts/python manage.py migrate
SEED_PASSWORD='Choose-a-dev-pass1' .venv/Scripts/python manage.py seed
.venv/Scripts/uvicorn config.asgi:application --reload --port 8000

# 2. Frontend (Angular 22) - in another terminal
cd frontend
npm install
npm start      # web  http://localhost:4200
```

Generate a JWT secret with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Every other variable is optional; see [Configuration reference](docs/DOCUMENTATION.md#5-configuration-reference).

- **Without SMTP:** password-reset links are printed in the API console.
- **Without Razorpay:** checkout offers a clearly labelled simulated payment (development only).
- **Without Cloudinary:** images are stored on local disk.
- **Without VAPID keys:** push notifications are off.

**Seeded accounts** (all use your `SEED_PASSWORD`; development only):

| Role | Email |
|---|---|
| Super admin | `admin@bitebox.test` |
| Operations / Finance / Support admin | `operations@bitebox.test`, `finance@bitebox.test`, `support@bitebox.test` |
| Customer | `customer@bitebox.test` |
| Restaurant | `restaurant@bitebox.test` (owns *Spice Route Kitchen*) |
| Rider | `rider@bitebox.test` |

The seed also creates the following fictional data:
- Food categories and 8 dishes.
- The coupons `WELCOME50` and `FLAT75`.
- A customer address.
- A rider vehicle.

**Signing in and up:**
- Every role signs in at **`/login`** and lands in its own panel (`/admin`, `/restaurant`, `/delivery`, or the customer site).
- Sign-up pages: `/register` (customers), `/restaurant/register` and `/delivery/register`.

To try a full order across all four roles, follow [Try the whole order flow](docs/DOCUMENTATION.md#try-the-whole-order-flow).

## Commands

```bash
# Backend (cd backend)
.venv/Scripts/uvicorn config.asgi:application --reload --port 8000   # API on :8000
.venv/Scripts/pytest                                                # unit & integration tests
.venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .   # linter & formatter

# Frontend (cd frontend). Always use the npm scripts: they set NG_BUILD_SASS_EMBEDDED=0.
npm start                    # dev server
npm test -- --watch=false    # unit tests (Vitest)
npm run build                # production build (SSR + prerender + service worker) into dist/frontend
npm run serve:ssr:frontend   # serve the production build on :4000 (needed to test the PWA)
```

CI (`.github/workflows/ci.yml`) runs lint, both test suites and the production build on every push to `master` and every pull request.

## Deployment

The production setup is one HTTPS origin. nginx sends `/api`, `/ws` and `/uploads` to the Django API, and everything else to the Angular SSR server.

```bash
cp deploy/.env.example deploy/.env      # JWT_SECRET, PUBLIC_URL, PUBLIC_HOST (+ optional keys)
docker compose --env-file deploy/.env up -d --build
# open http://localhost:8080
```

This starts four services:
- MongoDB 8 as a replica set, so transactions are used.
- The API.
- The SSR web server.
- nginx.

Deployment without Docker, static hosting on Vercel or Netlify, and the full production checklist are in [Deployment](docs/DOCUMENTATION.md#19-deployment).

## Project layout

```
backend/            Express API: server.js, app.js, config/, routes/, validators/, controllers/,
                    services/, models/, sockets/, middleware/, utils/, docs/ (OpenAPI), scripts/seed.js, tests/
frontend/           Angular app: src/app/{core,shared,layout,features}, src/server.ts (SSR), public/, ngsw-config.json
deploy/             nginx.conf and the docker-compose .env template
docker-compose.yml  production-like stack
docs/               documentation, troubleshooting, rewards design
```

## Most common problems

- **`ng serve` stuck on "Building..."**: use `npm start`, which sets `NG_BUILD_SASS_EMBEDDED=0`.
- **Signed out after every reload**:
  - Use `http://localhost:4200`, not `127.0.0.1`.
  - In production, use HTTPS and set `CLIENT_URL` to the exact frontend URL.
- **Backend tests can't start MongoDB**: run them with `TEST_MONGO_URI` pointing at a `*_test` database.
- **No "Install" option or service worker**: the PWA works only in production builds, served over HTTPS or on `localhost`.

More fixes are in [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).
