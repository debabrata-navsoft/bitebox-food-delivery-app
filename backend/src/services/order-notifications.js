import { ORDER_STATUS } from "../models/order.model.js";
import { emitOrderUpdated } from "../sockets/events.js";
import { notify, restaurantOwner } from "./notification.service.js";

const S = ORDER_STATUS;

/** The order has just reached the restaurant (cash: when placed; online: once paid). */
export async function notifyNewOrder(order, how) {
  emitOrderUpdated(order); // the restaurant's board lights up
  await notify(await restaurantOwner(order.restaurant), {
    type: "order.new",
    title: `New order ${order.orderNumber}`,
    body: `${order.items.length} dish${order.items.length === 1 ? "" : "es"} · ${how}`,
    link: "/restaurant/orders",
    order: order._id,
  });
}

/**
 * In-app notifications for an order status change: the customer hears about
 * progress, the restaurant about cancellations, the rider about withdrawn jobs.
 * Best-effort (see notify).
 */
export async function notifyStatusChange(order, actor, previous) {
  const ref = `Order ${order.orderNumber}`;
  const customer = (title, body) =>
    notify(order.customer, { type: `order.${order.status}`, title, body, link: `/orders/${order._id}`, order: order._id });
  const reason = order.cancellation?.reason;

  switch (order.status) {
    case S.CONFIRMED:
      return customer(`${ref} accepted`, `${order.restaurantSnapshot.name} is getting your food ready.`);
    case S.REJECTED:
      return customer(`${ref} could not be accepted`, reason || `${order.restaurantSnapshot.name} could not take this order.`);
    case S.ASSIGNED:
      return customer("A rider is on the way to the restaurant", `${ref} has a delivery partner.`);
    case S.PICKED_UP:
      return customer(`${ref} is on its way`, "Track your rider live on the order page.");
    case S.DELIVERED:
      return customer(`${ref} delivered`, "Enjoy your meal!");
    case S.CANCELLED: {
      const tasks = [];
      if (actor !== "customer") tasks.push(customer(`${ref} cancelled`, reason || "This order was cancelled."));
      if (order.submittedAt && actor !== "restaurant") {
        tasks.push(
          notify(await restaurantOwner(order.restaurant), {
            type: "order.cancelled",
            title: `${ref} cancelled`,
            body: actor === "customer" ? "The customer cancelled before you accepted it." : reason,
            link: "/restaurant/orders",
            order: order._id,
          }),
        );
      }
      if (previous?.deliveryPartner) {
        tasks.push(notify(previous.deliveryPartner, { type: "order.cancelled", title: `${ref} cancelled`, body: "You no longer need to deliver it.", link: "/delivery", order: order._id }));
      }
      return Promise.all(tasks);
    }
    default:
      return undefined;
  }
}
