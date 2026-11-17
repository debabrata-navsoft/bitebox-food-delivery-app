import { dayParams, described, facetsParam, multi, q } from "./openapi.filters.js";

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const ok = (description = "Success", data = { type: "object" }) => ({
  description,
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          success: { const: true },
          message: { type: "string" },
          data,
        },
      },
    },
  },
});
const err = (description) => ({
  description,
  content: { "application/json": { schema: ref("Error") } },
});
const body = (properties, required = []) => ({
  required: true,
  content: {
    "application/json": { schema: { type: "object", required, properties } },
  },
});
const strings = (...names) => Object.fromEntries(names.map((n) => [n, { type: "string" }]));
const bearer = [{ bearerAuth: [] }];
const id = { in: "path", name: "id", required: true, schema: { type: "string" } };
const paging = [
  q("page", { type: "integer", minimum: 1 }),
  q("limit", { type: "integer", minimum: 1, maximum: 100 }),
];
const days = q("days", { type: "integer", minimum: 1, maximum: 365, default: 30 });
const forbidden = { 401: err("Not signed in"), 403: err("Your role lacks this permission") };

/** One operation: tag, summary, who may call it, parameters, body and the success response. */
const op = (tag, summary, { params = [], requestBody, status = 200, who } = {}) => ({
  tags: [tag],
  summary,
  ...(who && { description: `Permission: \`${who}\`.` }),
  security: bearer,
  ...(params.length && { parameters: params }),
  ...(requestBody && { requestBody }),
  responses: { [status]: ok(), ...forbidden },
});

const STAFF_ROLES = ["operations_admin", "finance_admin", "support_admin", "operator"];
const ACCOUNT_STATUS = ["active", "inactive", "suspended", "blocked"];
const statusBody = body(
  {
    status: { type: "string", enum: ACCOUNT_STATUS },
    reason: {
      type: "string",
      minLength: 3,
      maxLength: 500,
      description: "Required (trimmed) for every status but active",
    },
  },
  ["status"],
);
const permissionList = {
  type: "array",
  nullable: true,
  items: { type: "string" },
  description:
    "The person's own permission keys (unknown keys and admins:manage are 422), or null for the role preset. The user JSON's `permissions` is the effective list",
};
const TICKET_STATUS = ["open", "in_progress", "waiting_for_response", "resolved", "closed"];
const TICKET_TYPES = ["order_issue", "delivery", "payment", "refund", "account", "other"];
const PRIORITY = ["low", "medium", "high", "urgent"];

const A = "Admin - Admin management";
const O = "Admin - Operations";
const F = "Admin - Finance";
const S = "Admin - Support";
const H = "Support tickets";
const C = "Admin - Customers";
const R = "Admin - Restaurant accounts";
const D = "Admin - Delivery partner accounts";

export const adminRolesTags = [
  {
    name: A,
    description:
      "Super admin only: create and manage operations, finance and support admins and operators (role presets or per-person permissions); the audit log.",
  },
  { name: O, description: "Operations admins (and the super admin)." },
  { name: F, description: "Finance admins (and the super admin)." },
  { name: S, description: "Support admins (and the super admin)." },
  {
    name: C,
    description:
      "The customer list and account help. A customer's profile tabs use the other admin lists with their customer filters: /admin/orders?customer=, /admin/payments?customer=, /admin/reviews/orders?customer=, /admin/support/tickets?requester=, /admin/rewards/transactions?userId=, /admin/rewards/wallets/{id}, /admin/audit-logs?resourceId= (each under its own permission).",
  },
  {
    name: R,
    description:
      "Restaurant accounts: the list, one restaurant's account view, admin edits, approval and suspension, and closing for orders. A restaurant's tabs use the other admin lists with their restaurant filters: /admin/orders?restaurant=, /admin/foods?restaurant=, /admin/coupons?restaurant=, /admin/finance/payouts?restaurant=, /admin/reviews/orders?restaurantId=, /admin/audit-logs?resourceId=<restaurant id>,<owner id> (each under its own permission).",
  },
  {
    name: D,
    description:
      "Delivery partner accounts (rider user ids): the list, one rider's account view, admin edits, verification, taking a rider offline and the availability history. A rider's tabs use the other admin lists with their rider filters: /admin/orders?rider=, /admin/finance/payouts?rider=, /admin/reviews/orders?rider=, /admin/support/tickets?requester=, /admin/users/{id}/logins, /admin/audit-logs?resourceId= (each under its own permission).",
  },
  { name: H, description: "Customers, restaurants and riders raise and follow their tickets." },
];

export const adminRolesSchemas = {};

const VERIFICATION = ["email_verified", "email_unverified", "phone_verified", "phone_unverified"];
const search = (description) => described(q("search", { type: "string", maxLength: 100 }), description);
/** joinedFrom and joinedTo: inclusive days in the report time zone; `what`: e.g. "day created". */
const joinedDays = (what) => dayParams("joinedFrom", "joinedTo", what);
const sortParam = (values, description) =>
  described(q("sort", { type: "string", enum: values, default: "newest" }), description);
/** An operation of `tag` needing permission `who`; `extra.note` is added to the description. */
const permOp = (tag) => (summary, who, extra = {}) => ({
  ...op(tag, summary, extra),
  description: `Permission: \`${who}\`.${extra.note ? ` ${extra.note}` : ""}`,
});
const help = (summary, action) => ({
  ...op(C, summary, { params: [id] }),
  description: `Permission: \`customers:edit\`. Customers only (any other id is 404). At most one per customer per minute (429). Audited as \`${action}\`.`,
});

const RESTAURANT_STATUS = ["pending", "approved", "rejected", "suspended", "resubmission_requested"];
const KYC_STATES = ["verified", "pending", "incomplete", "rejected"];
const restaurantOp = permOp(R);
const reason = (when) => ({
  type: "string",
  minLength: 3,
  maxLength: 500,
  description: `Required (trimmed) ${when}`,
});

const RIDER_VERIFICATION = ["pending", "approved", "rejected", "resubmission_requested"];
const VEHICLE_TYPES = ["bicycle", "scooter", "motorbike", "car"];
const riderOp = permOp(D);
const RIDER_DETAIL =
  "One rider: { user (user JSON), rider (as GET /admin/delivery-partners/{id} profile, with emergencyContact { name, phone, relation } | null and zone), stats { deliveries (delivered), cancelled (assigned, then cancelled), earningsPaise (rider share of delivered orders), lastDeliveryAt, rating { average, count } }, kyc { status, missing: [kind] } }";

export const adminRolesPaths = {
  "/admin/restaurant-accounts": {
    get: restaurantOp(
      "Restaurant accounts. Item: { id, name, slug, imageUrl, city, status, statusReason, isAcceptingOrders, createdAt, owner: { id, name, email, phone, status, avatarUrl } | null, stats: { orders, rating: { average, count } }, commissionPercent, kycStatus }",
      "restaurants:view",
      {
        params: [
          ...paging,
          search(
            "Restaurant name or slug, owner name, email or phone (any stored form), or the restaurant id: the full id or its last 6+ characters (a leading # is ignored)",
          ),
          multi("status", RESTAURANT_STATUS),
          multi("accountStatus", ACCOUNT_STATUS, "The owner's account status"),
          multi(
            "kyc",
            KYC_STATES,
            "rejected: a required document was rejected; incomplete: a required document or the bank account is missing; pending: a document awaits review; verified: everything approved",
          ),
          multi("city", null, "Exact city, any letter case"),
          ...joinedDays("day created"),
          facetsParam(["status", "accountStatus", "kyc", "city"], ["city"]),
          sortParam(
            ["newest", "oldest", "name", "orders", "rating"],
            "orders: most first; rating: highest average, then most ratings. Ties: newest first",
          ),
        ],
      },
    ),
  },
  "/admin/restaurant-accounts/cities": {
    get: restaurantOp("Distinct restaurant cities, A to Z: { cities }", "restaurants:view"),
  },
  "/admin/restaurant-accounts/{id}": {
    get: {
      ...restaurantOp(
        "One restaurant: { restaurant (as GET /my/restaurant, plus status, statusReason, reviewedAt), owner (user JSON) | null, stats { orders, delivered, cancelled (cancelled + rejected), grossPaise (delivered), lastOrderAt, rating { average, count } }, commission { percent, source: default | restaurant }, kyc { status, missing: [kind] } }",
        "restaurants:view",
        { params: [id] },
      ),
      responses: { 200: ok(), ...forbidden, 404: err("Restaurant not found"), 422: err("Invalid id") },
    },
    patch: restaurantOp(
      "Edit the restaurant's details: any field PATCH /my/restaurant takes (same rules), including ownerName, gstRegistered, gstin, fssaiNumber and fssaiValidUntil. Status, commission, bank details and the owner's sign-in details are dropped; the approval status never changes. A new GSTIN or FSSAI number sends that approved document back for review. Responds { restaurant }",
      "restaurants:edit",
      {
        params: [id],
        requestBody: body({}),
        note: "Audited as `restaurant.update` with changes (and `reverified` kinds); no changes, no audit row.",
      },
    ),
  },
  "/admin/restaurant-accounts/{id}/status": {
    patch: restaurantOp(
      "Approve, reject, ask for resubmission or suspend (the admin review: same transitions, KYC check and owner notice). The same status again changes nothing. Responds { restaurant }",
      "restaurants:approve",
      {
        params: [id],
        requestBody: body(
          {
            status: { type: "string", enum: ["approved", "rejected", "resubmission_requested", "suspended"] },
            reason: reason("for rejected, resubmission_requested and suspended"),
          },
          ["status"],
        ),
        note: "Suspending, and approving a suspended restaurant (lifting the suspension), need `restaurants:status` instead. Audited as `restaurant.status`.",
      },
    ),
  },
  "/admin/restaurant-accounts/{id}/accepting-orders": {
    patch: restaurantOp(
      "Close the restaurant for new orders (false) or reopen it (true); the partner's own switch. Responds { restaurant }",
      "restaurants:status",
      {
        params: [id],
        requestBody: body(
          { isAcceptingOrders: { type: "boolean" }, reason: reason("when closing") },
          ["isAcceptingOrders"],
        ),
        note: "Audited as `restaurant.accepting_orders`.",
      },
    ),
  },
  "/admin/delivery-partner-accounts": {
    get: riderOp(
      "Delivery partner accounts. Item: { id, name, email, phone, avatarUrl, status, statusReason, createdAt, verificationStatus, isOnline, busy, vehicleType, vehicleNumber, zone, completedDeliveries, rating: { average, count }, kycStatus }",
      "riders:view",
      {
        params: [
          ...paging,
          search(
            "Name, email, phone (any stored form), vehicle number (any letter case, spaces ignored), or the rider id: the full id or its last 6+ characters (a leading # is ignored)",
          ),
          multi("accountStatus", ACCOUNT_STATUS, "The rider's account status"),
          multi("verification", RIDER_VERIFICATION),
          multi(
            "availability",
            ["online", "offline", "busy"],
            "online: online and free; busy: online and carrying an order; offline",
          ),
          multi(
            "kyc",
            KYC_STATES,
            "The rider checklist (driving licence, vehicle RC, identity proof) and bank account: rejected, incomplete (a document or the bank account missing), pending, verified",
          ),
          multi("zone", null, "Exact zone, any letter case"),
          multi("vehicleType", VEHICLE_TYPES),
          ...joinedDays("day joined"),
          facetsParam(["verification", "availability", "kyc", "accountStatus", "zone", "vehicleType"], ["zone"]),
          sortParam(
            ["newest", "oldest", "name", "deliveries", "rating"],
            "deliveries: most completed first; rating: highest average, then most ratings. Ties: newest first",
          ),
        ],
      },
    ),
  },
  "/admin/delivery-partner-accounts/zones": {
    get: riderOp("Distinct delivery zones, A to Z: { zones }", "riders:view"),
  },
  "/admin/delivery-partner-accounts/{id}": {
    get: {
      ...riderOp(RIDER_DETAIL, "riders:view", { params: [id] }),
      responses: { 200: ok(), ...forbidden, 404: err("Delivery partner not found"), 422: err("Invalid id") },
    },
    patch: riderOp(
      "Edit the rider: name, gender, birthDate, avatarUrl (the admin member edit rules), address (the rider's PATCH /delivery/me/details rules), vehicleType and vehicleNumber (PUT /delivery/me/vehicle rules), emergencyContact { name, phone, relation } or null, zone or null. Email, phone, password, status and role are dropped; the verification status never changes. A new vehicle number sends an approved vehicle RC back for review. Responds with the account view",
      "riders:edit",
      {
        params: [id],
        requestBody: body({
          name: { type: "string", minLength: 2, maxLength: 80 },
          gender: { type: "string", nullable: true },
          birthDate: { type: "string", format: "date", nullable: true },
          avatarUrl: { type: "string", nullable: true },
          address: {
            type: "object",
            properties: {
              line1: { type: "string" },
              line2: { type: "string" },
              area: { type: "string" },
              city: { type: "string" },
              state: { type: "string" },
              postalCode: { type: "string" },
            },
          },
          emergencyContact: {
            type: "object",
            nullable: true,
            properties: {
              name: { type: "string", minLength: 2, maxLength: 80 },
              phone: { type: "string", description: "10-15 digits, optional +" },
              relation: { type: "string", maxLength: 40, nullable: true },
            },
          },
          vehicleType: { type: "string", enum: VEHICLE_TYPES },
          vehicleNumber: { type: "string" },
          zone: { type: "string", maxLength: 60, nullable: true },
        }),
        note: "Audited as `rider.update` with changes (address per line, and `reverified` kinds); no changes, no audit row.",
      },
    ),
  },
  "/admin/delivery-partner-accounts/{id}/verification": {
    patch: riderOp(
      "Approve, reject or ask for documents (the rider verification service: same transitions, KYC check and notice; a rider no longer approved goes offline). The same status again changes nothing. Responds with the account view",
      "riders:approve",
      {
        params: [id],
        requestBody: body(
          {
            status: { type: "string", enum: ["approved", "rejected", "resubmission_requested"] },
            reason: reason("for rejected and resubmission_requested"),
          },
          ["status"],
        ),
        note: "Audited as `rider.verification`.",
      },
    ),
  },
  "/admin/delivery-partner-accounts/{id}/availability": {
    get: riderOp(
      "Availability history, newest first: { items: [{ isOnline, at, source: rider | admin | system, reason }], pagination }",
      "riders:view",
      { params: [id, ...paging] },
    ),
    patch: {
      ...riderOp(
        "Take the rider offline (isOnline: false; true is 422, only the rider goes online). An open offer is passed on; already offline changes nothing. Responds with the account view",
        "riders:status",
        {
          params: [id],
          requestBody: body(
            { isOnline: { type: "boolean", enum: [false] }, reason: reason("always") },
            ["isOnline", "reason"],
          ),
          note: "Recorded in the availability history (source admin). Audited as `rider.availability`.",
        },
      ),
      responses: { 200: ok(), ...forbidden, 409: err("The rider is on a delivery"), 422: err("Validation failed") },
    },
  },
  "/admin/customers": {
    get: op(
      C,
      "Customers with order figures: each item is the user JSON plus stats { orders (every order placed), spentPaise (delivered orders), lastOrderAt }",
      {
        who: "customers:view",
        params: [
          ...paging,
          search(
            "Name, email or phone (any stored form), or the customer id: the full id or its last 6+ characters (a leading # is ignored)",
          ),
          multi("status", ACCOUNT_STATUS),
          multi("verification", VERIFICATION, "Several values: customers matching any of them"),
          ...joinedDays("sign-up day"),
          facetsParam(["status", "verification"]),
          sortParam(["newest", "oldest", "name", "orders", "spent"], "orders and spent: most first. Ties: newest first"),
        ],
      },
    ),
  },
  "/admin/customers/{id}/password-reset": {
    post: help(
      "Email the customer the standard password reset link (the forgot-password email); 409 when the account is not active",
      "customer.password_reset",
    ),
  },
  "/admin/customers/{id}/email-verification": {
    post: help(
      "Send the customer a new email verification link; 409 when the email is already verified",
      "customer.email_verification",
    ),
  },
  "/admin/admins": {
    get: op(A, "List admin accounts", {
      who: "admins:manage",
      params: [
        ...paging,
        multi("role", ["admin", ...STAFF_ROLES]),
        multi("status", ACCOUNT_STATUS),
        q("search", { type: "string" }),
        facetsParam(["role", "status"]),
      ],
    }),
    post: op(A, "Create an operations, finance or support admin, or an operator", {
      who: "admins:manage",
      status: 201,
      requestBody: body(
        {
          name: { type: "string" },
          email: { type: "string", format: "email" },
          phone: { type: "string" },
          password: { type: "string", minLength: 8 },
          role: { type: "string", enum: STAFF_ROLES },
          permissions: permissionList,
        },
        ["name", "email", "password", "role"],
      ),
    }),
  },
  "/admin/admins/permissions": {
    get: {
      ...op(A, "The permission editor's catalogue: every key (label, group) and starting presets", {
        who: "admins:manage",
      }),
      responses: {
        200: ok("Success", {
          type: "object",
          properties: {
            permissions: {
              type: "array",
              items: { type: "object", properties: strings("key", "label", "group") },
            },
            presets: {
              type: "array",
              items: {
                type: "object",
                properties: { ...strings("key", "label"), permissions: { type: "array", items: { type: "string" } } },
              },
            },
          },
        }),
        ...forbidden,
      },
    },
  },
  "/admin/admins/{id}": {
    get: op(A, "One admin account", { who: "admins:manage", params: [id] }),
    patch: op(
      A,
      "Edit an admin (name, phone, role, permissions); a role change signs them out, a permission change applies on their next request. Audited with the role/permission changes",
      {
        who: "admins:manage",
        params: [id],
        requestBody: body({
          name: { type: "string" },
          phone: { type: "string" },
          role: { type: "string", enum: STAFF_ROLES },
          permissions: permissionList,
        }),
      },
    ),
  },
  "/admin/admins/{id}/status": {
    patch: op(A, "Change an admin's status (any non-active status ends their sessions)", {
      who: "admins:manage",
      params: [id],
      requestBody: statusBody,
    }),
  },
  "/admin/audit-logs": {
    get: op(
      A,
      "Audit log of important admin actions. Each item also has accountType (target user's kind), changes ({ field: { from, to } }) and reason",
      {
      who: "audit:view",
      params: [
        ...paging,
        multi("action", null, "Exact action, e.g. order.cancel"),
        multi("role", ["admin", ...STAFF_ROLES], "The acting admin's role"),
        multi("accountType", ["customer", "restaurant", "delivery", "admin"]),
        {
          ...q("resourceId", { type: "string" }),
          description: "One resource id, or up to 5 separated by commas (e.g. a restaurant and its owner)",
        },
        q("search", { type: "string" }),
        q("from", { type: "string", format: "date-time" }),
        q("to", { type: "string", format: "date-time" }),
        facetsParam(["action", "role", "accountType"], ["action"]),
      ],
      },
    ),
  },

  "/admin/operations/dashboard": {
    get: op(O, "Order, restaurant and rider counts", { who: "operations:view", params: [days] }),
  },
  "/admin/operations/monitoring": {
    get: op(O, "Live orders with time in status; late ones first", { who: "operations:view" }),
  },
  "/admin/operations/restaurants": {
    get: op(O, "Restaurant availability and live order load", { who: "operations:view" }),
  },
  "/admin/operations/performance": {
    get: op(O, "Delivery times, stage averages and top riders", {
      who: "operations:view",
      params: [days],
    }),
  },

  "/admin/finance/dashboard": {
    get: op(F, "Revenue, payments, refunds, commission and money owed", {
      who: "finance:view",
      params: [days],
    }),
  },
  "/admin/finance/transactions/{id}": {
    get: op(F, "One payment with its order, customer and settlement", {
      who: "finance:view",
      params: [id],
    }),
  },
  "/admin/finance/commission": {
    get: op(F, "Commission rates and earnings per restaurant", {
      who: "finance:view",
      params: [days],
    }),
  },
  "/admin/finance/refunds": {
    get: op(F, "Refunded payments and refunds still needed", {
      who: "finance:view",
      params: [...paging, q("state", { type: "string", enum: ["needed", "refunded"] })],
    }),
  },
  "/admin/finance/payouts/due": {
    get: op(F, "What each restaurant or rider is owed", {
      who: "payouts:manage",
      params: [{ ...q("type", { type: "string", enum: ["restaurant", "rider"] }), required: true }],
    }),
  },
  "/admin/finance/payouts": {
    get: op(F, "Payout history", {
      who: "payouts:manage",
      params: [
        ...paging,
        q("type", { type: "string", enum: ["restaurant", "rider"] }),
        q("status", { type: "string", enum: ["pending", "paid", "cancelled"] }),
        { ...q("restaurant", { type: "string" }), description: "One restaurant's payouts (restaurant id)" },
        { ...q("rider", { type: "string" }), description: "One rider's payouts (the rider's user id)" },
      ],
    }),
    post: op(F, "Create a payout for everything a payee is owed", {
      who: "payouts:manage",
      status: 201,
      requestBody: body(
        {
          type: { type: "string", enum: ["restaurant", "rider"] },
          payeeId: { type: "string", description: "Restaurant id or rider user id" },
          note: { type: "string" },
        },
        ["type", "payeeId"],
      ),
    }),
  },
  "/admin/finance/payouts/{id}/paid": {
    post: op(F, "Mark a pending payout as paid", {
      who: "payouts:manage",
      params: [id],
      requestBody: body({ reference: { type: "string" } }, ["reference"]),
    }),
  },
  "/admin/finance/payouts/{id}/cancel": {
    post: op(F, "Cancel a pending payout (its orders become due again)", {
      who: "payouts:manage",
      params: [id],
      requestBody: body({ note: { type: "string" } }),
    }),
  },
  "/admin/finance/payouts/{id}/statement": {
    get: op(F, "Payout statement (PDF)", { who: "finance:view", params: [id] }),
  },
  "/admin/finance/commission/rules": {
    get: op(F, "Global commission, per-restaurant overrides and history", { who: "finance:view" }),
    put: op(F, "Set the global rate, or a restaurant's own (restaurantId), in basis points", {
      who: "payouts:manage",
      requestBody: body(
        { restaurantId: { type: "string" }, basisPoints: { type: "integer", minimum: 0, maximum: 5000 }, note: { type: "string" } },
        ["basisPoints"],
      ),
    }),
  },
  "/admin/finance/commission/rules/{id}": {
    delete: op(F, "Remove a restaurant's own commission (the global rate applies)", { who: "payouts:manage", params: [id] }),
  },
  "/admin/finance/ledger": {
    get: op(F, "Ledger balances per account, balance check and entries", { who: "finance:view", params: [days, ...paging] }),
  },
  "/admin/finance/settlements.csv": {
    get: op(F, "Settlement report as CSV (one row per delivered order)", {
      who: "finance:view",
      params: [q("from", { type: "string", format: "date-time" }), q("to", { type: "string", format: "date-time" })],
    }),
  },
  "/admin/orders/{id}/invoice": {
    get: op(F, "An order's invoice (PDF)", { who: "finance:view", params: [id] }),
  },
  "/orders/{id}/invoice": {
    get: { tags: ["Orders"], summary: "My delivered order's invoice (PDF)", security: bearer, parameters: [id], responses: { 200: ok("PDF"), 404: err("Not found"), 409: err("Not delivered yet") } },
  },
  "/my/restaurant/payouts": { get: { tags: ["Restaurant - Orders"], summary: "My payouts", security: bearer, parameters: paging, responses: { 200: ok() } } },
  "/my/restaurant/payouts/{id}/statement": { get: { tags: ["Restaurant - Orders"], summary: "A payout statement (PDF)", security: bearer, parameters: [id], responses: { 200: ok("PDF") } } },
  "/my/restaurant/settlements": { get: { tags: ["Restaurant - Orders"], summary: "Per-order settlements with payout status", security: bearer, parameters: paging, responses: { 200: ok() } } },
  "/delivery/payouts": { get: { tags: ["Delivery"], summary: "My payouts", security: bearer, parameters: paging, responses: { 200: ok() } } },
  "/delivery/payouts/{id}/statement": { get: { tags: ["Delivery"], summary: "A payout statement (PDF)", security: bearer, parameters: [id], responses: { 200: ok("PDF") } } },
  "/delivery/settlements": { get: { tags: ["Delivery"], summary: "Per-delivery pay with payout status", security: bearer, parameters: paging, responses: { 200: ok() } } },

  "/admin/support/dashboard": {
    get: op(S, "Ticket counts", { who: "support:manage" }),
  },
  "/admin/support/staff": {
    get: op(S, "Admins a ticket can be assigned to", { who: "support:manage" }),
  },
  "/admin/support/tickets": {
    get: op(S, "The ticket queue", {
      who: "support:manage",
      params: [
        ...paging,
        q("status", { type: "string", enum: [...TICKET_STATUS, "active"] }),
        q("priority", { type: "string", enum: PRIORITY }),
        q("requesterRole", { type: "string", enum: ["customer", "restaurant", "delivery"] }),
        q("type", { type: "string", enum: TICKET_TYPES }),
        q("assignee", { type: "string", enum: ["me", "unassigned"] }),
        q("search", { type: "string" }),
        { ...q("requester", { type: "string" }), description: "Tickets raised by this user id" },
      ],
    }),
  },
  "/admin/support/tickets/{id}": {
    get: op(S, "One ticket with conversation, notes and history", {
      who: "support:manage",
      params: [id],
    }),
    patch: op(S, "Change status, priority or assignee", {
      who: "support:manage",
      params: [id],
      requestBody: body({
        status: { type: "string", enum: TICKET_STATUS },
        priority: { type: "string", enum: PRIORITY },
        assigneeId: { type: "string", nullable: true },
        note: { type: "string" },
      }),
    }),
  },
  "/admin/support/tickets/{id}/messages": {
    post: op(S, "Reply to the requester, or add an internal note", {
      who: "support:manage",
      params: [id],
      requestBody: body({ body: { type: "string" }, internal: { type: "boolean" } }, ["body"]),
    }),
  },
  "/admin/support/tickets/{id}/escalate": {
    post: op(S, "Send a refund or payment issue to finance", {
      who: "support:manage",
      params: [id],
      requestBody: body({ note: { type: "string" } }, ["note"]),
    }),
  },

  "/support/tickets": {
    get: op(H, "My tickets", {
      params: [...paging, q("status", { type: "string", enum: ["open", "closed"] })],
    }),
    post: op(H, "Raise a ticket", {
      status: 201,
      requestBody: body(
        {
          type: { type: "string", enum: TICKET_TYPES },
          subject: { type: "string" },
          message: { type: "string" },
          orderNumber: { type: "string", example: "BB-261105-ABC123" },
        },
        ["type", "subject", "message"],
      ),
    }),
  },
  "/support/tickets/{id}": {
    get: op(H, "One of my tickets (no internal notes)", { params: [id] }),
  },
  "/support/tickets/{id}/messages": {
    post: op(H, "Reply on my ticket", {
      params: [id],
      requestBody: body({ body: { type: "string" } }, ["body"]),
    }),
  },
};
