import { dayParams, facetsParam, multi, searchParam } from "./openapi.filters.js";

const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "rejected",
  "preparing",
  "ready_for_pickup",
  "assigned",
  "arrived_at_restaurant",
  "picked_up",
  "on_the_way",
  "delivered",
  "cancelled",
];

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const ok = (data, description = "Success") => ({
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
const body = (schema) => ({
  required: true,
  content: { "application/json": { schema } },
});
const bearer = [{ bearerAuth: [] }];
const idParam = {
  in: "path",
  name: "id",
  required: true,
  schema: { type: "string" },
};
const paging = [
  { in: "query", name: "page", schema: { type: "integer", minimum: 1 } },
  {
    in: "query",
    name: "limit",
    schema: { type: "integer", minimum: 1, maximum: 100 },
  },
];
const T = {
  orders: ["Orders"],
  restaurant: ["Restaurant - Orders"],
  rider: ["Delivery"],
  admin: ["Admin - Orders"],
  adminRiders: ["Admin - Delivery partners"],
};
const order = ok({ type: "object", properties: { order: ref("Order") } });
const conflict = err(
  "Not allowed in the order's current status (INVALID_TRANSITION) or changed concurrently (ORDER_CHANGED)",
);
const reason = (required) => ({
  type: "object",
  ...(required ? { required: ["reason"] } : {}),
  properties: { reason: { type: "string", maxLength: 300 } },
});
const riderDashboard = ok(ref("RiderDashboard"));

export const ordersTags = [
  {
    name: "Restaurant - Orders",
    description:
      "A partner's incoming orders: accept/reject, preparing, ready for pickup.",
  },
  {
    name: "Delivery",
    description:
      "The signed-in rider: availability, location, offers and their deliveries.",
  },
  { name: "Admin - Orders" },
  { name: "Admin - Delivery partners" },
];

export const ordersSchemas = {
  RiderProfile: {
    type: "object",
    properties: {
      id: { type: "string" },
      vehicleType: {
        type: "string",
        enum: ["bicycle", "scooter", "motorbike", "car"],
      },
      vehicleNumber: { type: "string" },
      isOnline: { type: "boolean" },
      locationUpdatedAt: { type: "string", format: "date-time" },
      completedDeliveries: { type: "integer" },
    },
  },
  RiderDashboard: {
    type: "object",
    properties: {
      profile: ref("RiderProfile"),
      offer: {
        description:
          "Delivery currently offered to this rider (with offerExpiresAt), or null",
        oneOf: [ref("Order"), { type: "null" }],
      },
      activeOrder: {
        description: "The order this rider is carrying, or null",
        oneOf: [ref("Order"), { type: "null" }],
      },
    },
  },
};

export const ordersPaths = {
  "/orders/{id}/cancel": {
    post: {
      tags: T.orders,
      summary:
        "Cancel my order (only while the restaurant has not accepted it)",
      security: bearer,
      parameters: [idParam],
      requestBody: body(reason(false)),
      responses: { 200: order, 404: err("Not found"), 409: conflict },
    },
  },

  "/my/restaurant/orders": {
    get: {
      tags: T.restaurant,
      summary: "My restaurant's orders",
      description:
        "view=active (default): in-progress orders, oldest first, plus counts per status. view=history: finished orders, paginated, filterable (status, paymentMethod, placed days, search). Several values in one filter: any of them; filters combine with AND. Only this restaurant's orders, rows and counts.",
      security: bearer,
      parameters: [
        {
          in: "query",
          name: "view",
          schema: { type: "string", enum: ["active", "history"] },
        },
        multi("status", ORDER_STATUSES, "Statuses outside the view are ignored"),
        multi("paymentMethod", ["cod", "online"]),
        ...dayParams("placedFrom", "placedTo", "day placed"),
        searchParam("History: order number, or the recipient's name"),
        facetsParam(["status", "paymentMethod"]),
        ...paging,
      ],
      responses: {
        200: ok({ type: "object" }),
        403: err("Not a restaurant partner"),
        422: err("Invalid filter value"),
      },
    },
  },
  "/my/restaurant/orders/{id}": {
    get: {
      tags: T.restaurant,
      summary: "One order (customer phone and exact address hidden)",
      security: bearer,
      parameters: [idParam],
      responses: { 200: order, 404: err("Not found") },
    },
  },
  "/my/restaurant/orders/{id}/status": {
    patch: {
      tags: T.restaurant,
      summary: "Accept, reject, start preparing or mark ready for pickup",
      description:
        "pending -> confirmed | rejected (reason required); confirmed -> preparing; preparing -> ready_for_pickup (starts rider dispatch). Repeating the current status is a no-op.",
      security: bearer,
      parameters: [idParam],
      requestBody: body({
        type: "object",
        required: ["status"],
        properties: {
          status: {
            type: "string",
            enum: ["confirmed", "rejected", "preparing", "ready_for_pickup"],
          },
          reason: { type: "string" },
          prepMinutes: {
            type: "integer",
            minimum: 5,
            maximum: 120,
            description: "With confirmed: preparation time (default: the restaurant's usual time)",
          },
        },
      }),
      responses: {
        200: order,
        400: err("Reason missing"),
        404: err("Not found"),
        409: conflict,
      },
    },
  },

  "/delivery/me": {
    get: {
      tags: T.rider,
      summary: "My profile, current offer and active delivery",
      security: bearer,
      responses: { 200: riderDashboard, 403: err("Not a delivery partner") },
    },
  },
  "/delivery/me/vehicle": {
    put: {
      tags: T.rider,
      summary: "Set my vehicle (required before going online)",
      security: bearer,
      requestBody: body({
        type: "object",
        required: ["vehicleType"],
        properties: {
          vehicleType: {
            type: "string",
            enum: ["bicycle", "scooter", "motorbike", "car"],
          },
          vehicleNumber: { type: "string" },
        },
      }),
      responses: {
        200: ok({
          type: "object",
          properties: { profile: ref("RiderProfile") },
        }),
        422: err("Validation failed"),
      },
    },
  },
  "/delivery/me/availability": {
    patch: {
      tags: T.rider,
      summary: "Go online (with current location) or offline",
      security: bearer,
      requestBody: body({
        type: "object",
        required: ["isOnline"],
        properties: {
          isOnline: { type: "boolean" },
          latitude: { type: "number" },
          longitude: { type: "number" },
        },
      }),
      responses: {
        200: riderDashboard,
        400: err("Vehicle or location missing"),
        409: err("Cannot go offline mid-delivery"),
      },
    },
  },
  "/delivery/me/location": {
    put: {
      tags: T.rider,
      summary: "Report my position (online riders only; rate limited)",
      security: bearer,
      requestBody: body({
        type: "object",
        required: ["latitude", "longitude"],
        properties: {
          latitude: { type: "number" },
          longitude: { type: "number" },
        },
      }),
      responses: {
        200: ok({ type: "object" }),
        409: err("Offline"),
        429: err("Too frequent"),
      },
    },
  },
  "/delivery/offers/{id}/accept": {
    post: {
      tags: T.rider,
      summary: "Accept the delivery offered to me",
      security: bearer,
      parameters: [idParam],
      responses: {
        200: riderDashboard,
        409: err("Offer expired, withdrawn or not mine (OFFER_UNAVAILABLE)"),
      },
    },
  },
  "/delivery/offers/{id}/decline": {
    post: {
      tags: T.rider,
      summary: "Decline the delivery offered to me (it goes to the next rider)",
      security: bearer,
      parameters: [idParam],
      responses: { 200: riderDashboard, 409: err("No such offer") },
    },
  },
  "/delivery/orders/{id}/status": {
    patch: {
      tags: T.rider,
      summary:
        "Arrived at the restaurant -> picked up -> on the way -> delivered (my delivery only)",
      description:
        "Delivered needs the customer's 4-digit code (otp) when DELIVERY_OTP_REQUIRED is on: 422 for a wrong code, 409 OTP_LOCKED after too many.",
      security: bearer,
      parameters: [idParam],
      requestBody: body({
        type: "object",
        required: ["status"],
        properties: {
          status: {
            type: "string",
            enum: ["arrived_at_restaurant", "picked_up", "on_the_way", "delivered"],
          },
          otp: { type: "string", pattern: "^\\d{4}$" },
        },
      }),
      responses: {
        200: riderDashboard,
        404: err("Not my delivery"),
        409: conflict,
      },
    },
  },
  "/delivery/orders/history": {
    get: {
      tags: T.rider,
      summary: "My finished deliveries",
      description:
        "Delivered and cancelled orders, newest first. Several values in one filter: any of them; filters combine with AND. Only this rider's orders, rows and counts.",
      security: bearer,
      parameters: [
        multi("status", ["delivered", "cancelled"]),
        multi("restaurant", "id", "Restaurant ids"),
        ...dayParams("placedFrom", "placedTo", "day placed"),
        searchParam("Order number"),
        facetsParam(["status", "restaurant"], [], ["restaurant"]),
        ...paging,
      ],
      responses: { 200: ok({ type: "object" }), 422: err("Invalid filter value") },
    },
  },

  "/admin/orders": {
    get: {
      tags: T.admin,
      summary: "All orders, with counts per status",
      security: bearer,
      description:
        "Items, pagination and counts (orders per status, following only the customer, restaurant and rider filters). Several values in one filter: any of them; filters combine with AND.",
      parameters: [
        multi("status", [...ORDER_STATUSES, "active"], "Order statuses; active = every in-progress status"),
        multi("paymentMethod", ["cod", "online"]),
        multi("paymentStatus", ["pending", "paid", "failed", "refunded", "partially_refunded", "cancelled"]),
        ...dayParams("placedFrom", "placedTo", "day placed"),
        {
          in: "query",
          name: "search",
          schema: { type: "string" },
          description: "Order number",
        },
        {
          in: "query",
          name: "customer",
          schema: { type: "string" },
          description: "Only orders placed by this user id (the status counts follow it too)",
        },
        multi("restaurant", "id", "Only orders placed with these restaurant ids (the status counts follow it too)"),
        {
          in: "query",
          name: "rider",
          schema: { type: "string" },
          description: "Only orders assigned to this rider (user id; the status counts follow it too)",
        },
        facetsParam(["status", "paymentMethod", "paymentStatus", "restaurant"], [], ["restaurant"]),
        ...paging,
      ],
      responses: { 200: ok({ type: "object" }), 403: err("Not an admin"), 422: err("Invalid filter value") },
    },
  },
  "/admin/orders/{id}": {
    get: {
      tags: T.admin,
      summary: "One order, with rider and current offer",
      security: bearer,
      parameters: [idParam],
      responses: { 200: order, 404: err("Not found") },
    },
  },
  "/admin/orders/{id}/cancel": {
    post: {
      tags: T.admin,
      summary: "Cancel an order (not once picked up)",
      security: bearer,
      parameters: [idParam],
      requestBody: body(reason(true)),
      responses: { 200: order, 409: conflict, 422: err("Reason required") },
    },
  },
  "/admin/orders/{id}/unassign": {
    post: {
      tags: T.admin,
      summary: "Take an assigned order back from its rider and re-dispatch it",
      security: bearer,
      parameters: [idParam],
      requestBody: body(reason(false)),
      responses: { 200: order, 409: conflict },
    },
  },
  "/admin/orders/{id}/assign": {
    post: {
      tags: T.admin,
      summary: "Give a ready order to a chosen online rider (withdraws an open offer)",
      security: bearer,
      parameters: [idParam],
      requestBody: body({
        type: "object",
        required: ["riderId"],
        properties: { riderId: { type: "string" } },
      }),
      responses: {
        200: order,
        404: err("Order or rider not found"),
        409: err("Not waiting for a rider (INVALID_TRANSITION) or rider busy (RIDER_UNAVAILABLE)"),
      },
    },
  },
  "/admin/orders/{id}/delivery-code": {
    post: {
      tags: T.admin,
      summary: "Send the customer a new delivery code (after too many wrong tries)",
      security: bearer,
      parameters: [idParam],
      responses: { 200: order, 409: err("No delivery code to reset") },
    },
  },
  "/admin/orders/{id}/timeline": {
    get: {
      tags: T.admin,
      summary: "The order's status changes with labels and who made them",
      security: bearer,
      parameters: [idParam],
      responses: { 200: ok({ type: "object" }), 404: err("Not found") },
    },
  },
  "/orders/{id}/timeline": {
    get: {
      tags: T.orders,
      summary: "My order's status changes with labels and who made them",
      security: bearer,
      parameters: [idParam],
      responses: { 200: ok({ type: "object" }), 404: err("Not found") },
    },
  },
  "/my/restaurant/stats": {
    get: {
      tags: T.restaurant,
      summary: "Dashboard figures: orders by state, today's orders, sales, average order, rating",
      security: bearer,
      responses: { 200: ok({ type: "object" }), 404: err("No restaurant yet") },
    },
  },
  "/admin/dashboard": {
    get: {
      tags: T.admin,
      summary: "Platform figures for the admin home; money figures need finance:view",
      security: bearer,
      responses: { 200: ok({ type: "object" }), 403: err("Not an admin") },
    },
  },
  "/admin/users/{id}/logins": {
    get: {
      tags: T.admin,
      summary: "Sign-in history of a customer, partner or rider (<kind>:view)",
      security: bearer,
      parameters: [idParam, ...paging],
      responses: { 200: ok({ type: "object" }), 404: err("Not found") },
    },
  },
  "/admin/admins/{id}/logins": {
    get: {
      tags: T.admin,
      summary: "Sign-in history of a staff admin (admins:manage)",
      security: bearer,
      parameters: [idParam, ...paging],
      responses: { 200: ok({ type: "object" }), 404: err("Not found") },
    },
  },
  "/tracking/orders/{id}": {
    get: {
      tags: T.orders,
      summary: "Rider's last position, staleness and recent path of a delivery",
      description:
        "For the order's customer, its rider, or staff with orders:view. The path is sent only while the order is assigned, at the restaurant, picked up or on the way.",
      security: bearer,
      parameters: [idParam],
      responses: { 200: ok({ type: "object" }), 404: err("Not found") },
    },
  },
  "/admin/delivery-partners": {
    get: {
      tags: T.adminRiders,
      summary: "Delivery partners with availability and current delivery",
      description:
        "Several values in one filter: any of them; filters combine with AND. verification: pending = sent everything, waiting for review; not_submitted = pending with something still to send.",
      security: bearer,
      parameters: [
        { in: "query", name: "search", schema: { type: "string" } },
        { in: "query", name: "online", schema: { type: "boolean" }, description: "true: online riders only" },
        multi("verification", ["pending", "approved", "rejected", "resubmission_requested", "not_submitted"]),
        multi(
          "availability",
          ["online", "offline", "busy"],
          "online: online and free; offline; busy: online carrying an order",
        ),
        multi("vehicleType", ["bicycle", "scooter", "motorbike", "car"]),
        multi("zone", null, "Exact zone, any letter case"),
        facetsParam(["verification", "availability", "vehicleType", "zone"], ["zone"]),
        ...paging,
      ],
      responses: { 200: ok({ type: "object" }), 422: err("Invalid filter value") },
    },
  },
  "/admin/delivery-partners/{id}/status": {
    patch: {
      tags: T.adminRiders,
      summary:
        "Change a rider's status (riders:manage). Any non-active status takes them offline and passes on their offer (not while carrying an order); the current status is a no-op",
      security: bearer,
      parameters: [idParam],
      requestBody: body({
        type: "object",
        required: ["status"],
        properties: {
          status: { type: "string", enum: ["active", "inactive", "suspended", "blocked"] },
          reason: {
            type: "string",
            minLength: 3,
            maxLength: 500,
            description: "Required (trimmed) for every status but active",
          },
        },
      }),
      responses: {
        200: ok({ type: "object" }),
        404: err("Not found"),
        409: err("Rider is mid-delivery"),
      },
    },
  },
};
