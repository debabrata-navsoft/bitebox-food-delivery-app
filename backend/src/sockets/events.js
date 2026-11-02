import { logger } from "../config/logger.js";

/** Room names, always built on the server from verified ids. */
export const rooms = Object.freeze({
  user: (id) => `user:${id}`,
  restaurant: (id) => `restaurant:${id}`,
  admins: "admins",
});

let io = null;

/** Set once at startup (null in tests that do not start Socket.IO, which makes emits no-ops). */
export function setRealtimeServer(server) {
  io = server;
}

/**
 * Tells everyone involved that an order changed: its customer, its restaurant,
 * the rider carrying it or being offered it, and admins.
 * Payload: { id, orderNumber, status, updatedAt } (details are re-read over REST).
 */
export function emitOrderUpdated(order, { alsoNotify = [] } = {}) {
  if (!io || !order) return;
  try {
    const payload = {
      id: String(order._id),
      orderNumber: order.orderNumber,
      status: order.status,
      updatedAt: order.updatedAt,
    };
    const targets = new Set([rooms.user(order.customer), rooms.restaurant(order.restaurant), rooms.admins]);
    // Riders carrying or being offered it, plus any who just lost it (declined, unassigned, expired).
    for (const rider of [order.deliveryPartner, order.offer?.partner, ...alsoNotify]) {
      if (rider) targets.add(rooms.user(rider));
    }
    io.to([...targets]).emit("order:updated", payload);
  } catch (error) {
    // Live updates are best-effort; clients also refresh on their own.
    logger.error({ err: error }, "Realtime emit failed");
  }
}
