// Coupons and restaurant offers beyond the basic coupon CRUD (routes/coupon.routes.js): admin
// status, copies and analytics, the restaurant-offer approval queue, partners' own offers, and what
// customers see.
const ok = (data, description = "Success") => ({
  description,
  content: { "application/json": { schema: { type: "object", properties: { success: { const: true }, message: { type: "string" }, data } } } },
});
const err = (description) => ({ description });
const bearer = [{ bearerAuth: [] }];
const id = { in: "path", name: "id", required: true, schema: { type: "string" } };
const paging = [
  { in: "query", name: "page", schema: { type: "integer", minimum: 1 } },
  { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } },
];
const listQuery = [
  ...paging,
  { in: "query", name: "search", schema: { type: "string" } },
  { in: "query", name: "status", schema: { enum: ["active", "scheduled", "expired", "paused", "draft", "pending", "rejected"] } },
  { in: "query", name: "owner", schema: { enum: ["platform", "restaurant"] } },
  { in: "query", name: "kind", schema: { enum: ["coupon", "restaurant_offer", "platform_offer", "payment_offer"] } },
  { in: "query", name: "sort", schema: { enum: ["newest", "oldest", "expiring", "most_used", "code"] } },
  { in: "query", name: "from", schema: { type: "string", format: "date-time" } },
  { in: "query", name: "to", schema: { type: "string", format: "date-time" } },
];
const coupon = ok({ type: "object", properties: { coupon: { type: "object" } } });
const offers = ok({ type: "object", properties: { offers: { type: "array", items: { type: "object" } } } });
const page = ok({ type: "object", properties: { items: { type: "array", items: { type: "object" } }, pagination: { type: "object" } } });
const stats = ok({ type: "object", description: "total, active, scheduled, expired, paused, draft, pending, rejected, redemptions, discountGivenPaise, top" });
const active = { content: { "application/json": { schema: { type: "object", required: ["isActive"], properties: { isActive: { type: "boolean" } } } } } };
const offerBody = {
  content: {
    "application/json": {
      schema: {
        type: "object",
        description:
          "As POST /admin/coupons, without restaurant(s), kind or paymentChannels (always a restaurant_offer); `draft: true` saves without submitting for approval",
        properties: { draft: { type: "boolean" } },
      },
    },
  },
};

export const offersTags = [{ name: "Restaurant offers", description: "A restaurant partner's own offers" }];

export const offersPaths = {
  "/coupons/offers": {
    get: {
      tags: ["Checkout"],
      summary: "Every offer the customer can use, best first",
      security: bearer,
      parameters: [{ in: "query", name: "type", schema: { enum: ["percent", "flat", "free_delivery", "first_order", "restaurant", "coupon", "payment", "category"] } }],
      responses: { 200: offers },
    },
  },
  "/restaurants/{slugOrId}/offers": {
    get: {
      tags: ["Catalog"],
      summary: "A restaurant's offers & deals: its own offers, then platform-wide ones",
      parameters: [{ in: "path", name: "slugOrId", required: true, schema: { type: "string" } }],
      responses: { 200: offers, 404: err("Not found") },
    },
  },
  "/admin/coupons/analytics": {
    get: { tags: ["Admin: coupons"], summary: "Coupon counts by status, redemptions and the discount given", security: bearer, responses: { 200: stats } },
  },
  "/admin/coupons/{id}/status": {
    patch: { tags: ["Admin: coupons"], summary: "Activate or deactivate a coupon", security: bearer, parameters: [id], requestBody: active, responses: { 200: coupon, 404: err("Not found") } },
  },
  "/admin/coupons/{id}/duplicate": {
    post: { tags: ["Admin: coupons"], summary: "A switched-off copy with a new code", security: bearer, parameters: [id], responses: { 201: coupon, 404: err("Not found") } },
  },
  "/admin/restaurant-offers/pending": {
    get: { tags: ["Admin: coupons"], summary: "Restaurant offers waiting for review", security: bearer, parameters: paging, responses: { 200: page } },
  },
  "/admin/restaurant-offers/{id}/approve": {
    post: { tags: ["Admin: coupons"], summary: "Approve a restaurant offer (the partner is told)", security: bearer, parameters: [id], responses: { 200: coupon, 409: err("Not waiting for review") } },
  },
  "/admin/restaurant-offers/{id}/reject": {
    post: {
      tags: ["Admin: coupons"],
      summary: "Reject a restaurant offer with a reason (the partner is told)",
      security: bearer,
      parameters: [id],
      requestBody: { content: { "application/json": { schema: { type: "object", properties: { reason: { type: "string", maxLength: 300 } } } } } },
      responses: { 200: coupon, 409: err("Not waiting for review"), 422: err("No reason") },
    },
  },
  "/my/restaurant/offers": {
    get: { tags: ["Restaurant offers"], summary: "My restaurant's offers", security: bearer, parameters: listQuery, responses: { 200: page } },
    post: {
      tags: ["Restaurant offers"],
      summary: "Create an offer (sent for approval when OFFER_APPROVAL_REQUIRED)",
      security: bearer,
      requestBody: offerBody,
      responses: { 201: coupon, 409: err("Code taken"), 422: err("Invalid") },
    },
  },
  "/my/restaurant/offers/analytics": {
    get: { tags: ["Restaurant offers"], summary: "My offers: counts, redemptions and the discount given", security: bearer, responses: { 200: stats } },
  },
  "/my/restaurant/offers/{id}": {
    get: { tags: ["Restaurant offers"], summary: "One of my offers", security: bearer, parameters: [id], responses: { 200: coupon, 404: err("Not mine") } },
    patch: { tags: ["Restaurant offers"], summary: "Edit an offer (sends it for review again)", security: bearer, parameters: [id], requestBody: offerBody, responses: { 200: coupon, 404: err("Not mine") } },
    delete: { tags: ["Restaurant offers"], summary: "Delete an unused offer", security: bearer, parameters: [id], responses: { 200: ok({ type: "null" }), 409: err("Used") } },
  },
  "/my/restaurant/offers/{id}/status": {
    patch: { tags: ["Restaurant offers"], summary: "Pause or resume an offer", security: bearer, parameters: [id], requestBody: active, responses: { 200: coupon, 404: err("Not mine") } },
  },
};
