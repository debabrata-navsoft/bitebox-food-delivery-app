# BiteBox — Food Delivery Platform

BiteBox is a full-stack food delivery app with four role-based panels: **Customer**, **Admin**, **Restaurant**, and **Delivery partner**. It runs on web, tablet, and mobile.

| Part     | Stack |
|----------|-------|
| Frontend | Angular 22 (standalone components, Signals, SSR/prerender), Angular Material 22, SCSS |
| Backend  | Node.js + Express 5 (JavaScript ES modules), Mongoose 9, JWT, bcrypt, express-validator, pino, Swagger UI |
| Database | MongoDB (local or Atlas) |

> **Status: Phase 3 complete (cart and checkout).** Phases 1–2 delivered authentication, restaurants and menus. Order handling by restaurants and riders, maps and live tracking, online payments and reports arrive in later phases.

---

## 1. Prerequisites

- Node.js **20.19+** (developed on Node 26) and npm 10+
- MongoDB **7+**: a local `mongod`, Docker (`docker run -d -p 27017:27017 mongo:8`), or a free MongoDB Atlas cluster

## 2. Setup

```bash
# Backend
cd backend
npm install
cp .env.example .env        # then edit .env (see below)

# Frontend
cd ../frontend
npm install
```

### Backend `.env`

| Variable | Purpose |
|----------|---------|
| `MONGO_URI` | MongoDB connection string |
| `CLIENT_URL` | Allowed browser origin(s), comma-separated. The first one is used in password-reset emails. |
| `JWT_SECRET` | 32+ random characters. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `JWT_EXPIRES_IN` | Access-token lifetime. Keep it short (default `15m`); the refresh cookie renews it. |
| `SMTP_*`, `EMAIL_FROM` | Sends password-reset emails. **If left empty in development, the reset link is printed to the backend console.** |
| `SEED_PASSWORD` | Development-only password for the seeded sample accounts |
| `UPLOAD_DIR`, `PUBLIC_BASE_URL` | Where uploaded images are stored (default `uploads/`, git-ignored) and the API origin used in their URLs |

`.env` is git-ignored. Never commit real credentials.

### Frontend environments

- `src/environments/environment.development.ts` sets `apiUrl: 'http://localhost:5000/api/v1'` (used by `ng serve`).
- `src/environments/environment.ts` (production) sets `apiUrl: '/api/v1'`, which assumes a reverse proxy serves the API on the same origin.

These files are bundled into browser code, so **never put secrets in them**.

## 3. Seed development data (optional)

```bash
cd backend
SEED_PASSWORD='Choose-a-dev-pass1' npm run seed
# rerun safely any time; add `-- --reset-passwords` to reset the seed users' passwords
```

| Role | Email | Sign-in page |
|------|-------|--------------|
| Admin | `admin@bitebox.test` | `/admin/login` |
| Customer | `customer@bitebox.test` | `/login` |
| Restaurant | `restaurant@bitebox.test` | `/restaurant/login` |
| Delivery | `rider@bitebox.test` | `/delivery/login` |

All four accounts use your `SEED_PASSWORD`. **They are for development only.** The script refuses to run when `NODE_ENV=production`.

The seed also creates:
- 8 food categories
- one **approved** restaurant, *Spice Route Kitchen*, in Indiranagar, Bengaluru, owned by the restaurant account
- 8 menu items for that restaurant

- coupons `WELCOME50` (50% off up to ₹100, minimum order ₹199, once per customer) and `FLAT75` (₹75 off on ₹399 or more)
- a default delivery address for the customer, about 4 km from the restaurant

All seeded data is fictional. Rerunning the seed never creates duplicates.

## 4. Run (two terminals)

```bash
# Terminal 1: API on http://localhost:5000
cd backend && npm run dev

# Terminal 2: web app on http://localhost:4200
cd frontend && npm start
```

- API docs (Swagger UI): <http://localhost:5000/api/docs> (raw OpenAPI JSON: `/api/docs.json`)
- Health check: <http://localhost:5000/api/v1/health>

## 5. Test, lint, build

```bash
cd backend
npm test        # Node test runner + supertest against an in-memory MongoDB (downloads mongod on first run)
npm run lint

cd ../frontend
npm test -- --watch=false   # Vitest unit tests
npm run build               # production build (SSR + prerendered public pages) into dist/frontend
npm run serve:ssr:frontend  # serve the production build on :4000
```

To run the backend tests against a real MongoDB instead of the in-memory one, set `TEST_MONGO_URI`. The database name **must end in `_test`**, because the tests wipe its collections:

```bash
TEST_MONGO_URI='mongodb://127.0.0.1:27017/bitebox_test' npm test
```

---

## Architecture

### Authentication

- **Access token:** a JWT (HS256, 15 min) returned in the JSON response and kept **only in memory** in the Angular `AuthService`. It is never written to localStorage.
- **Refresh token:** a random opaque token in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` in production) scoped to `/api/v1/auth`. The database stores only its SHA-256 hash.
  - It **rotates** on every refresh. Replaying an already-rotated token revokes the whole session family (theft detection). A 15-second grace window absorbs two tabs refreshing at the same time.
  - On page load the app calls `/auth/refresh` to restore the session.
- **CSRF protection** on the cookie endpoints (`/refresh`, `/logout`): these require the `X-Requested-With: BiteBox` header (which forces a CORS preflight) and an allow-listed `Origin`.
- **Passwords:** hashed with bcrypt (12 rounds). Policy: 8–72 bytes, at least one letter and one number.
- **Password reset:** a single-use token valid for 30 minutes, stored hashed and consumed atomically. A reset also revokes all sessions and outstanding access tokens (`tokenVersion`). The forgot-password response is identical whether or not the email exists.
- **Roles:** `customer`, `admin`, `restaurant`, `delivery`. Admins cannot self-register.
  - Each panel has its own sign-in page, and the API rejects sign-ins from the wrong portal.
  - The backend enforces every permission (`authorize(...roles)`). The Angular route guards exist only for UX.
- **Other protections:** rate limits on auth endpoints, Helmet security headers, a CORS allow-list, 100 kB body limit, NoSQL-operator stripping, strict validation (unknown body fields are dropped), and redaction of secrets in logs.

> If the frontend and API are deployed on **different sites**, set `COOKIE_SAMESITE=none` (HTTPS required) and add the frontend origin to `CLIENT_URL`. Serving both under one domain behind a reverse proxy is the simpler setup.

### API response format

```json
{ "success": true,  "message": "Signed in successfully", "data": { } }
{ "success": false, "message": "Validation failed", "error": { "code": "VALIDATION_ERROR", "details": [{ "field": "email", "message": "..." }] } }
```

### Phase 1 endpoints (`/api/v1`)

| Method | Path | Auth |
|--------|------|------|
| GET | `/health` | none |
| POST | `/auth/register`, `/auth/login`, `/auth/forgot-password`, `/auth/reset-password` | none (rate-limited) |
| POST | `/auth/refresh`, `/auth/logout` | refresh cookie + CSRF header |
| GET/PATCH | `/auth/me` | bearer |
| POST | `/auth/change-password` | bearer |
| GET | `/admin/users?role=&status=&search=&page=&limit=` | bearer, admin |

### Phase 2 endpoints (`/api/v1`)

All money values are **integer paise** (₹1 = 100), for example `pricePaise: 32900` is ₹329. The full contract is in Swagger at `/api/docs`.

| Area | Endpoints | Access |
|------|-----------|--------|
| Discovery | `GET /restaurants` (search, cuisine, category, veg, sort, `lat`/`lng`/`radiusKm`, paging), `GET /restaurants/cuisines`, `GET /restaurants/{slugOrId}`, `GET /restaurants/{slugOrId}/menu`, `GET /categories`, `GET /foods` (dish search), `GET /foods/{id}` | public, approved restaurants only |
| My restaurant | `GET/POST/PATCH /my/restaurant`, `PATCH /my/restaurant/accepting-orders`, `GET/POST /my/restaurant/foods`, `PATCH/DELETE /my/restaurant/foods/{id}`, `PATCH /my/restaurant/foods/{id}/availability` | restaurant partner (own data only) |
| Admin | `GET /admin/restaurants`, `GET /admin/restaurants/counts`, `GET /admin/restaurants/{id}`, `PATCH /admin/restaurants/{id}/status`, `GET/POST /admin/categories`, `PATCH/DELETE /admin/categories/{id}`, `GET /admin/foods`, `PATCH /admin/foods/{id}/availability`, `DELETE /admin/foods/{id}` | admin |
| Uploads | `POST /uploads/images` (multipart field `image`) | restaurant partner, admin |

**Restaurant approval workflow.**
- A partner creates their restaurant, which starts as `pending` and is invisible to customers.
- An admin moves it along the allowed transitions:
  - pending → approved or rejected
  - approved → suspended
  - suspended → approved
  - rejected → approved
- Rejecting or suspending requires a reason, which the owner sees.
- If the owner edits a rejected restaurant, it is re-submitted as `pending`.
- Status changes are conditional updates, so two admins acting at the same time cannot both succeed.

### Phase 3 endpoints (`/api/v1`, customers unless noted)

| Area | Endpoints |
|------|-----------|
| Cart | `GET /cart`, `DELETE /cart`, `POST /cart/items`, `PATCH /cart/items/{foodItemId}` (quantity 0 removes), `DELETE /cart/items/{foodItemId}`, `POST /cart/coupon`, `DELETE /cart/coupon`. Every response is the full **server-priced quote**; add `?addressId=` to quote delivery to a specific address. |
| Addresses | `GET/POST /addresses`, `PATCH/DELETE /addresses/{id}`, `PATCH /addresses/{id}/default` (max 10 per customer) |
| Orders | `POST /orders` (header `Idempotency-Key`), `GET /orders`, `GET /orders/{id}` |
| Coupons | `GET /coupons/available`; admin: `GET/POST /admin/coupons`, `PATCH/DELETE /admin/coupons/{id}` |

**How an order is priced.** The server recomputes everything; the browser never sends prices. The rules live in `backend/src/config/pricing.js`:

| Line | Rule |
|------|------|
| Item total | current menu price × quantity |
| Coupon | percentage (optionally capped) or a flat amount; never more than the item total |
| Delivery fee | ₹25 for the first 2 km, then ₹8 per extra km (rounded up), capped at ₹99. Free when the item total after the coupon is ₹499 or more. |
| Delivery range | straight-line distance up to 15 km |
| Platform fee | ₹5 |
| GST | 5% of the item total after the coupon |

The cart page shows anything that blocks checkout: unavailable dishes, a closed or paused restaurant, a total below the restaurant's minimum, no address, or an address out of range.

**How placing an order is protected.**
- **Price changes:** the client sends `expectedTotalPaise`, the total the customer saw. If the server's total differs, it returns `409 PRICE_CHANGED` and nothing is charged or created.
- **Retries:** the `Idempotency-Key` header makes a retried request (double click, flaky network) return the original order instead of creating a second one.
- **Double checkout:** the cart is claimed with a version-checked delete, so the same cart can never become two orders, even when submitted twice at once.
- **Coupon limits:** coupon use is reserved with an atomic conditional increment, which enforces the total usage limit. A redemption record enforces the per-customer limit.
- **All-or-nothing writes:** everything runs in a MongoDB transaction when the server supports it (Atlas, replica sets). On a single local `mongod`, each completed step is undone if a later step fails. Both paths are covered by tests.
- **Snapshots:** orders store copies of item names and prices, the delivery address, and the restaurant details, so later menu edits never change a past order.
- **Payment:** Cash on Delivery creates a `Payment` record with status `pending`. Online payment arrives in Phase 6.

**Delivery location.**
- The header has a **location picker**: use your current GPS location, search for a place, or pick a saved address.
- The home page and restaurant list then show only restaurants within 15 km of that point (the list has "Show all restaurants" to override).
- The choice is remembered in this browser (localStorage).

**Place search** goes through `GET /api/v1/geo/search` and `/geo/reverse`. These call OpenStreetMap Nominatim from the backend, which caches results for 24 hours and allows at most one upstream request per second.
- Set `GEOCODER_USER_AGENT` with your contact email, as Nominatim's usage policy requires.
- For production traffic, point `GEOCODER_URL` at a self-hosted or commercial geocoder.

**Nearby search.** Nearby results use MongoDB `$geoNear` on a 2dsphere index. The `distanceMeters` value is **straight-line** distance, not road distance; road routing arrives in Phase 5.

**Image uploads.**
- Only JPEG, PNG and WebP up to 2 MB are accepted.
- The file type is detected from the file's bytes, not its name or the browser-supplied type.
- Files are stored under random names and served with `nosniff` and `Cross-Origin-Resource-Policy: cross-origin`.
- Storage is local disk. Hosts with ephemeral disks need a cloud storage provider (see `src/services/upload.service.js`).

### Folder layout

```
backend/src
  app.js            Express app factory (middleware, routes, error handling)
  server.js         HTTP server, DB connection, graceful shutdown
  config/           env validation, logger, MongoDB connection
  controllers/      HTTP layer
  services/         business logic (auth, mail)
  models/           Mongoose models (User, Session)
  routes/ validators/ middleware/ utils/ docs/ scripts/
backend/tests       API integration tests

frontend/src/app
  core/             auth service, guards, HTTP interceptor, API services
  shared/           models, validators, reusable components
  layout/           auth, customer, and panel shell (admin/restaurant/delivery) layouts
  features/         auth pages, customer, admin, restaurant-panel, delivery-panel, profile, errors
frontend/src/styles design tokens, breakpoints, generated Material palette
```

### Responsive design

The layouts are built mobile-first, with breakpoints at **600px** (tablet) and **1024px** (desktop):
- **Partner panels:** the sidebar is persistent on desktop and becomes a slide-over drawer on tablets and phones.
- **Customer site:** phones get a bottom tab bar.
- **Admin users list:** a table on wide screens and stacked cards on narrow ones.
- **Restaurant grids:** 1, 2, 3 or 4 columns depending on screen width.
- **Restaurant menu:** category jump-links scroll horizontally on phones and become a sticky sidebar on desktop.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Missing required environment variable` / `JWT_SECRET must be at least 32 characters` | Fill in `backend/.env` from `.env.example`. |
| `Could not connect to MongoDB` | Check `MONGO_URI`. On Atlas, add your IP under *Network Access*. |
| The browser shows CORS errors | Add the exact origin (scheme, host, and port) to `CLIENT_URL` and restart the API. |
| You are signed out after every reload | The refresh cookie isn't being stored. Use `http://localhost:4200` rather than `127.0.0.1` (the API and app must be same-site). For different sites, see `COOKIE_SAMESITE` above. |
| No password-reset email arrives | Without SMTP settings, the link is printed in the API console (development only). |
| `npm test` (backend) fails with `Instance closed unexpectedly` | The in-memory `mongod` could not start (some sandboxes or containers block it). Use `TEST_MONGO_URI` with a `*_test` database. |
| `ng serve` / `ng s` stays on **"Building..."** forever (or fails with `Tried writing to closed dispatcher`) | On some machines the native Dart Sass compiler is killed by the system after its first compile, and Angular then waits forever. The npm scripts already set `NG_BUILD_SASS_EMBEDDED=0` to use the pure-JS Sass compiler, so **use `npm start` / `npm run build` instead of `ng s` / `ng build`**. To make plain `ng` commands work too, add `export NG_BUILD_SASS_EMBEDDED=0` to your `~/.bashrc`. |
| The SSR server returns `400 Header "host" ... is not allowed` | Angular's SSRF protection only allows `localhost` (`angular.json` → `security.allowedHosts`). For a real domain, add it there or set `NG_ALLOWED_HOSTS=bitebox.example.com` when running the server. |
| The map shows no pin or zoom buttons, or tiles fill only part of the box | Leaflet's stylesheet isn't loaded. The dev server reads `angular.json` only at start-up, so stop it and run `npm start` again after pulling changes. |
| "Current location" is kilometres off (or the warning mentions hundreds of km) | Laptops and desktops have no GPS; the browser guesses from Wi-Fi or IP. On Linux this guess can be country-level. Search for your area or drag the pin; nothing is saved until you confirm it. |
| `429 Too many attempts` | Auth endpoints are rate-limited (20 per 15 min per IP). Wait, or restart the API in development. |
