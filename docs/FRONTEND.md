# BiteBox Frontend: Developer Guide

This guide explains how the BiteBox web app is built: the stack, how the code is organised, how pages talk to the API and to the live socket, the shared building blocks (tables, dialogs, forms, maps), and how to style, test and extend it.

- **Who it is for:** developers working on `frontend/`.
- **What it does not repeat:** the screen-by-screen list and business rules are in [DOCUMENTATION.md](DOCUMENTATION.md) §15 and §10; the backend is described in [BACKEND.md](BACKEND.md).

## 1. Stack at a glance

| Area | Choice |
|---|---|
| Framework | Angular 22: standalone components, signals, `OnPush`, **zoneless** (no zone.js) |
| Rendering | SSR with `@angular/ssr` on Express 5; home rendered per request, auth pages prerendered, everything else client-only |
| UI libraries | NexPrime (`nexprime`, main inputs, buttons, icons, charts) and Angular Material 22 (M3, a few older screens) |
| Forms | Signal Forms (`@angular/forms/signals`) with schema validation |
| Maps | Leaflet 1.9 + OpenStreetMap tiles (loaded lazily) |
| Realtime | Native WebSocket to the Django API at `/ws/` |
| PWA | `@angular/service-worker` (production builds only), Web Push |
| Tests | Vitest 5 + jsdom through `@angular/build:unit-test` |
| Tooling | TypeScript 6, Prettier (width 100, single quotes), npm 11 |

## 2. Folder layout

```
frontend/
├── angular.json            # build (SSR, budgets, service worker), test builder
├── ngsw-config.json        # service worker caching rules
├── package.json            # scripts (always use these, see §13)
├── Dockerfile              # Node 24 image serving the SSR build on :4000
└── src/
    ├── index.html          # theme script before first paint; CSP_NONCE placeholders
    ├── main.ts, main.server.ts
    ├── server.ts           # Express SSR server: security headers, CSP nonce, static files
    ├── styles.scss         # brand tokens, global rules, NexPrime overrides
    ├── styles/             # _breakpoints.scss, _theme-colors.scss, _delivery-card.scss
    ├── environments/       # environment.ts (dev), environment.prod.ts
    └── app/
        ├── app.ts / app.html / app.config.ts / app.routes.ts / app.routes.server.ts
        ├── core/           # auth, guards, interceptors, models, services (no UI)
        ├── shared/         # reusable components, dialogs, forms, lists, pipes, utils
        ├── layout/         # panel shells for each role + customer/auth layouts
        └── features/       # pages: customer, restaurant, delivery, admin, auth
```

**Size:** 196 components (72 shared, 115 in features), 49 injectable services, about 106 routes, 96 spec files.

## 3. App shell and configuration

- **`app.config.ts`** registers the router (component input binding, scroll restoration, an offline redirect to `/offline` on failed navigation), client hydration with event replay, `HttpClient` with `fetch` and three interceptors (page loader → server API origin → auth), the service worker (production only), and an app initializer that restores the session.
- **`app.ts`** starts the install prompt, push and theme services, and makes Material dialogs ignore outside clicks. `app.html` shows the top page-loader bar, the router outlet, and the deferred `<bb-app-status>`.
- **Environments** (`src/environments/`): `baseUrl` (dev `http://localhost:8000/api/v1`, prod `/api/v1`), `wsUrl` (dev `ws://localhost:8000/ws/`; empty in prod, derived from `baseUrl`), `map`, `links`, `support`.
- **SSR server (`src/server.ts`):** adds security headers to every response, generates a fresh CSP nonce per HTML page and replaces every `CSP_NONCE` placeholder, serves static files with long caching (HTML and service-worker files `no-cache`), and exposes `/healthz`. During server rendering, relative API calls are sent to `API_INTERNAL_URL` when set.

### Routing

| Area | Path | Guard | Layout | Route file |
|---|---|---|---|---|
| Customer site | `/` | `customerSiteGuard` (+ `roleGuard('customer')` on private pages) | `CustomerLayout` | `features/customer/customer.routes.ts` |
| Auth pages | `/login`, `/register`, `/forgot-password`, `/restaurant/register`, `/delivery/register`, `/verify-email`, `/reset-password` | `guestGuard` (sign-in/up) | `AuthLayout` | inline in `app.routes.ts` |
| Restaurant panel | `/restaurant` | `roleGuard('restaurant')` | `RestaurantLayout` | `features/restaurant/restaurant.routes.ts` |
| Delivery panel | `/delivery` | `roleGuard('delivery')` | `DeliveryLayout` | `features/delivery/delivery.routes.ts` |
| Admin panel | `/admin` | `roleGuard(...ADMIN_ROLES)` + `permissionGuard` per page | `AdminLayout` | `features/admin/admin.routes.ts` |

- Every page is lazy-loaded with `loadComponent`.
- Render modes (`app.routes.server.ts`): home = server-rendered per request; `login`, `register`, `forgot-password` = prerendered; everything else = client-only.

## 4. Feature areas

| Area | Main pages (under `features/`) |
|---|---|
| **customer** | home, restaurant list (filters dialog, place search), restaurant detail (menu, cart dock), dish search, offers, checkout (coupons, coins, payment), orders and order detail (live tracking, ratings), account, addresses, payment methods, coins wallet, refer & earn, special rewards, help centre and contact |
| **restaurant** | dashboard, live orders board (accept, nearby riders, track rider), restaurant details, verification (KYC), menu, offers, reviews, earnings |
| **delivery** | dashboard (online/offline, delivery requests), current delivery (delivery code), history, reviews, earnings, verification |
| **admin** | dashboard; accounts (restaurants, riders, customers, staff and permissions); catalogue (categories, coupons, offer review, foods); operations (monitoring, dispatch settings, reports, notification deliveries); orders; restaurants and riders review; finance (refunds, ledger, payouts, commission, payments, reports); support desk; reviews moderation; coins and rewards; audit log |
| **auth** | login (password or phone code), register (customer, restaurant, rider), forgot/reset password, verify email |

Shared pages used by several panels live in `shared/components` (profile, notifications, support tickets, earnings).

## 5. `core/`: services without UI

### Authentication (`core/auth/auth.service.ts`)

- The **access token is kept only in memory** (a signal). The refresh token is an HttpOnly cookie the browser sends to `/api/v1/auth/*`.
- `restoreSession()` runs at start-up: it calls `refresh()` and sets `initialised` when done. Guards wait for `initialised` before deciding.
- `refresh()` is single-flight (parallel callers share one request) and retries transient errors (network, 5xx, refresh race) up to 3 times; only a real rejection signs the user out.
- `displayUser` is a display-only hint stored in localStorage to avoid a flicker on reload. **Never use it for access decisions.**
- Other methods cover sign-in/up (password or code), phone and email verification, password reset and change, profile update, `hasRole`, `homeFor`.

### Interceptors

- **`authInterceptor`:** for API URLs it adds `X-Requested-With: BiteBox`, adds the bearer token (unless the request is marked `publicRequest()`), sends cookies only to `/auth/*`, and on a 401 refreshes once and retries. If the refresh is rejected, it sends the user to their login page with `reason=expired`.
- **`serverApiInterceptor`:** during SSR, prefixes relative API URLs with the internal API origin.
- **`pageLoaderInterceptor`:** feeds the top loading bar (see §6).
- Mark public catalogue calls with `context: publicRequest()` so the SSR transfer cache can reuse them.

### Permissions

- `auth.can('perm', …)` is true if the user holds **any** of the given permissions.
- `permissionGuard('perm')` protects each admin page; a user without it is sent to their home (or `/forbidden`).
- `core/auth/admin-pages.ts#pagePermission(link)` maps admin paths to permissions. The admin menu and the data table use it to hide links a person can't open.
- Admin menus come from `layout/admin-layout`. Use `auth.can(...)` to hide buttons for actions a role can't perform.

### Services

`core/services/` holds one service per API area, for example `CatalogService`, `CartService`, `OrderService`, `PaymentService`, `ReviewService`, `RewardsService`, `SupportService`, `KycService`, `UploadService`, `InboxService` (header bell) and the `admin/` services (catalogue, accounts, finance, operations, rewards, staff). Cross-cutting ones:

| Service | Role |
|---|---|
| `realtime.service.ts`, `realtime-transport.ts` | The live socket (§7) |
| `poll.ts` | `pollWhileVisible`, `liveRefresh` (§7) |
| `page-loader.ts` | Loading bar and `inBackground()` |
| `restaurant-order-board.ts` | Shared, ref-counted order board for the restaurant panel |
| `rider-session.service.ts`, `rider-gps.service.ts` | Rider dashboard state, delivery requests, device GPS |
| `delivery-location.service.ts`, `geolocation.service.ts`, `routing.service.ts` | Delivery point, browser location, road routes and ETAs |
| `payment.service.ts` | `pay(orderId, session)`: Razorpay checkout or the mock gateway |
| `theme.service.ts` | Light/dark/system theme |
| `push-notification.service.ts`, `app-update.service.ts`, `install-prompt.service.ts`, `connection-status.service.ts` | PWA features |
| `notification.service.ts` | Snackbar messages (not the inbox) |

## 6. `shared/`: reusable building blocks

### Lists and tables

- **`pagedList(fetch, opts)`** (`shared/list/paged-list.ts`): data, loading, skeleton, empty and error state; live refresh (`pollMs`, `when`); resets to page 1 when `filterKey` changes; `goTo(page, rows)`.
- **`filteredList(...)`** (`shared/list/filtered-list.ts`): search, filter panel and sort on top of `pagedList`, used by most admin lists with `list-toolbar` and `filter-panel`.
- **`<bb-data-table>`** (`shared/components/data-table`): a table described entirely by data. `TableColumn` (value, money, date, link or button, sub-lines, badges, avatar, custom cell via `<ng-template bbCell="key">`) and `TableAction` (icon or text button, link, run, menu, `show`, `disabled`, `danger`). It also remembers row order for previous/next on details pages.
- **`<bb-detail-nav>`** + `DetailOrder`: previous/next/Back buttons on details pages, kept across reloads in sessionStorage.
- Paginated lists use `<np-pagination variant="compact">`.

### Dialogs

- **New dialogs use `BbDialog`** (`shared/dialog/bb-dialog.ts`, CDK-based, not `MatDialog`): `inject(BB_DIALOG_DATA)`, `inject(BbDialogRef)`, a `bbDialogTitle` heading, and the `.bb-dialog__content` / `.bb-dialog__actions` blocks. `.bb-dialog__head` + `.bb-dialog__close` give a header with a round ×. `result()` emits only when the dialog closes with a value.
- **Closing rules** (`shared/dialog/outside-click.ts`): dialogs close only through their own buttons or Escape, never an outside click, unless opened with `closeOnOutsideClick: true` (used by the restaurant Filters dialog). `lockDialog(ref)` blocks Escape during critical steps (e.g. payment processing). Older `MatDialog` dialogs get the same rule through `keepMaterialDialogsOpenOnOutsideClick()`.
- **Confirm-then-act:** `confirmed(bbDialog, { title, message, confirmLabel, danger, reasonLabel })` emits `true` (or the typed reason).

### Forms

- Build forms with `form(model, schema, { submission: { action } })`, bind `<form [formRoot]>` and `[formField]`.
- Import **`NP_FORM_FIELDS`** (`shared/forms/np-form-fields.ts`): `FormField`, the NexPrime inputs, a touched-on-blur directive, `NpInputAttrs` (forwards `autocomplete`, `inputmode`), `<bb-field-error>` and `<bb-code-input>`.
- Rules in `shared/validators/form-rules.ts` (`requiredText`, `emailRules`, `passwordRules`, `phoneRules`, `numberRange`…) and `code-rules.ts`.
- `shownError(field)` shows an error once the field is touched; `serverErrors(form, details)` maps the API's 422 field errors (`a.b.c` paths) onto fields.
- `np-text-input` takes `[error]`; other NexPrime controls go in a `.bb-field` wrapper with `<bb-field-error>`.

### Other shared pieces

- **Components:** page header, empty state, stat tile, daily chart (with "Show as table"), info rows, tab strip, order status chip, bill summary, quantity stepper, veg badge, restaurant card, coupon ticket, offers strip, reviews (cards, stars, summary, replies), image and photo upload, photo viewer, phone input, place search, KYC (documents, bank account, admin review), profile, support tickets, earnings, notification bell, app status, install banner, push and channel settings, site footer, error pages.
- **Pipes:** `inr` (paise → ₹), `distance`, `npIcon` (Material names → NexPrime icons), `itemCount`, `clockTime`.
- **Directives:** `img[bbSrc]` (broken-image fallback), table cell labels for phone layout.
- **Utils:** `errorMessage`/`errorCode` for API errors, idempotency keys, safe URLs, storage that never throws, dates, countdowns, media queries.
- **Coupons:** `shared/coupons/` holds labels (`discountLabel`, `scopeLabel`, `usesLabel`…), the coupon form and list helpers shared by admin coupons and restaurant offers.

## 7. Live data

- **Socket** (`core/services/realtime.service.ts`): connects while someone is signed in. `DjangoSocketTransport` opens `/ws/`, sends `{type: 'auth', token}` as the first frame, pings every 25 s, and reconnects with back-off (capped at 30 s). A rejected token (close code 4401) triggers a token refresh and reconnect.
- **Exposed streams:** `connected`, `orderUpdates$` (`order:updated`), `notifications$` (`notification:new`), `track(orderId)` (joins the order's tracking room, emits `order:location`), `sendRiderLocation(point)`.
- **Events carry ids and statuses only** — screens re-read details over REST.
- **Fallback polling:** `liveRefresh(request, { pollMs, when })` combines socket events with a slow poll that pauses while the tab is hidden (`pollWhileVisible`). Requests passed to either must catch their own errors.
- **Loading bar:** shows for any request slower than 200 ms. Wrap background requests in `inBackground(request$)`; repeat polls and live refreshes already do this.

## 8. Maps and tracking

- Leaflet is imported **dynamically inside `afterNextRender`** (never at module load), keeping it out of SSR and the initial bundle.
- `shared/components/map-picker`: pin picker for addresses and restaurant locations.
- `shared/components/tracking-map`: read-only delivery map; `delivery-tracking.ts#deliveryTracking(order)` provides rider position, staleness (90 s), trail, routes and ETA, loading `GET /tracking/orders/{id}` at start and after every socket reconnect. Used by the customer order page, the admin order page and the restaurant's track-rider dialog.
- Distances are labelled as straight-line (fees, dispatch), road estimate (routing) or live GPS — keep those distinctions in the UI.

## 9. Payments

- `PaymentService.pay(orderId, session)` opens Razorpay checkout.js (loaded on demand) or, when the API returns the mock provider, the `MockPaymentDialog`; it confirms with the API and returns the outcome (or `null` if the customer closed it).
- Use `awaitingPayment()` and `customerStatusLabel()` from `core/models/checkout.models.ts` to show unpaid online orders correctly.
- Never compute prices or discounts on the client: the cart quote from the API is the source of truth.

## 10. Styling and UI rules

- **Tokens:** brand and status colours, spacing and radii are CSS variables in `src/styles.scss` (`--bb-*`); NexPrime's `--ui-*` variables are mapped onto them. **Never hard-code colours** in component SCSS.
- **Dark theme:** `<html data-theme="dark">`, set by `ThemeService` (and by an inline script before first paint). `--bb-plum` turns lavender in dark mode; fills that must stay plum use `--bb-brand` with `--bb-on-brand` text; status tints use `--bb-{success,danger,warning,info,teal}-bg`.
- **Breakpoints** (`@use 'breakpoints' as bp;`): `tablet-up` (600 px), `desktop-up` (1024 px), `wide-up` (1440 px), `phone-only`, `below-desktop`.
- **Buttons:** `np-button` for actions — always set `severity`, and for icon-only buttons `label=""` plus `ariaLabel`. Submit buttons and links styled as buttons use the global `.bb-btn` classes (`--outlined`, `--text`, `--soft`, `--accent`, `--danger`, `--small`, `--icon`).
- **Icons:** `<np-icon name="…" class="mat-icon" />` only (Lucide names such as `chef-hat`). The `mat-icon` class is what makes `--bb-icon-size` apply; without it the icon stays at NexPrime's 20 px. Material names stored in data go through the `npIcon` pipe.
- **Toggles:** bind `np-toggle [checked]` to the source state and update it optimistically, restoring on failure; never call `toggle.checked.set()`.
- **Component files:** always separate `.ts`, `.html` and `.scss` (no inline templates or styles), `ChangeDetectionStrategy.OnPush`, `bb-` selectors, no `.component` suffix in file names.

## 11. SSR and browser-only code

- Never touch `window`, `navigator`, `localStorage` or `document` APIs outside `isPlatformBrowser(...)` or `afterNextRender(...)`. `shared/utils/browser-storage.ts` wraps storage safely.
- A new inline script in `index.html` needs `nonce="CSP_NONCE"`.
- Keep Angular Material and NexPrime out of the eagerly loaded code (`app.ts`, eager routes, root services): NexPrime doesn't tree-shake and adds about 270 kB. That is why `<bb-app-status>` is `@defer`red and Material dialogs are hooked in after first render.

## 12. PWA

- `ngsw-config.json` (production builds only) caches the app shell, icons, fonts, catalogue images and the **public catalogue API** (`/api/v1/restaurants`, `/categories`, `/foods`). Never add private endpoints (auth, cart, orders, payments) to a data group.
- Services: `connection-status` (online/offline), `app-update` (new version available), `install-prompt`, `push-notification` (Web Push; needs the server's VAPID keys and HTTPS in production).
- UI: `shared/components/{app-status, install-banner, install-dialog, push-settings, app-qr}`. Floating UI must not shift the layout.

## 13. Running, building and testing

From `frontend/` (the scripts set `NG_BUILD_SASS_EMBEDDED=0`, because the embedded Sass process gets killed on some machines; always use the npm scripts):

```bash
npm install
npm start                          # dev server, http://localhost:4200 (API expected on :8000)
npm run build                      # production build with SSR (dist/frontend)
npm run serve:ssr:frontend         # run the built SSR server
npm test -- --watch=false          # all unit tests
npm test -- --watch=false --include src/app/core/services/rider-gps.service.spec.ts
npx ng build --configuration development    # quick type/template check
```

- **Unit tests:** 96 spec files (core services, guards, interceptors, shared components, feature pages). Helpers: `shared/list/list-page.testing.ts`, `TrackingMapStub` for maps, and a swappable socket transport in `RealtimeService`.
- **No e2e suite:** UI changes are checked with headless Chrome (playwright-core) against a mocked or throwaway API; never write test data to the real database.
- **Budgets** (production): initial bundle warns at 700 kB, fails at 1.2 MB; component styles warn at 12 kB.

## 14. Adding a page: checklist

1. Create the component under the right `features/<area>/` folder with separate `.ts`, `.html`, `.scss`; `OnPush`; `bb-` selector.
2. Add a lazy route in the area's `*.routes.ts`. Admin pages get `canActivate: [permissionGuard('perm')]`, an entry in `core/auth/admin-pages.ts`, and a menu item in `layout/admin-layout` if needed.
3. Put API calls in a service under `core/services/`; mark public calls `publicRequest()`.
4. Lists: `pagedList`/`filteredList` + `<bb-data-table>`. Dialogs: `BbDialog`. Confirmations: `confirmed()`. Forms: Signal Forms + `NP_FORM_FIELDS`.
5. Live data: `liveRefresh(...)` with a slow poll; wrap background requests in `inBackground`.
6. Style with tokens and breakpoint mixins; check light and dark themes and a phone width.
7. Add or update specs; run `npm test -- --watch=false` and a production build.

## 15. Known gaps

Found while preparing this guide:

- `core/auth/admin-pages.ts` has no entry for `/admin/users/…`, so `pagePermission()` returns `null` and links to those pages are shown to every admin, although the routes themselves are permission-guarded (an admin without access is sent away on click).
- 17 screens still open dialogs with `MatDialog`; new and migrated dialogs should use `BbDialog`.
- `frontend/README.md` is still the default Angular CLI README.
