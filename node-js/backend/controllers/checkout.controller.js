import { Cart } from "../models/cart.model.js";
import * as addressService from "../services/address.service.js";
import * as cartService from "../services/cart.service.js";
import * as orderService from "../services/order.service.js";
import * as payments from "../services/payments/payment.service.js";
import { respond, sendSuccess } from "../utils/api-response.js";
import { parsePagination } from "../utils/pagination.js";

const quoteFor = (req, cart) =>
  cartService.buildQuote(req.user._id, {
    addressId: req.validatedQuery?.addressId,
    payment: req.validatedQuery?.payment,
    cart,
  });
/** Cart mutations answer with the freshly priced cart (reusing the cart they just saved). */
const thenQuote = (change, message) =>
  respond(async (req) => {
    const result = await change(req);
    return quoteFor(req, result instanceof Cart ? result : undefined);
  }, message);

// Cart
export const getCart = respond(quoteFor);
export const addItem = thenQuote((req) => cartService.addItem(req.user._id, req.body), "Added to cart");
export const setQuantity = thenQuote((req) => cartService.setQuantity(req.user._id, req.params.foodItemId, req.body.quantity), "Cart updated");
export const removeItem = thenQuote((req) => cartService.removeItem(req.user._id, req.params.foodItemId), "Removed from cart");
export const clearCart = thenQuote((req) => cartService.clear(req.user._id), "Cart cleared");
export const applyCoupon = thenQuote((req) => cartService.applyCoupon(req.user._id, req.body.code), "Coupon applied");
export const removeCoupon = thenQuote((req) => cartService.removeCoupon(req.user._id), "Coupon removed");
export const setCoins = thenQuote((req) => cartService.setCoins(req.user._id, req.body.coins), "Coins applied");
export const removeCoins = thenQuote((req) => cartService.removeCoins(req.user._id), "Coins removed");

// Addresses
export const listAddresses = respond(async (req) => ({ addresses: await addressService.list(req.user._id) }));
export const createAddress = respond(async (req) => ({ address: await addressService.create(req.user._id, req.body) }), "Address saved", 201);
export const updateAddress = respond(async (req) => ({ address: await addressService.update(req.user._id, req.params.id, req.body) }), "Address updated");
export const setDefaultAddress = respond(async (req) => ({ address: await addressService.setDefault(req.user._id, req.params.id) }), "Default address updated");
export const deleteAddress = respond(async (req) => {
  await addressService.remove(req.user._id, req.params.id);
  return null;
}, "Address deleted");

// Orders
export async function placeOrder(req, res) {
  const { order, created } = await orderService.placeOrder(req.user._id, req.body, req.get("idempotency-key"));
  // Online: hand back the gateway checkout details right away (the order page can retry with "Pay now").
  const checkout =
    order.paymentMethod === "online" && order.paymentStatus !== "paid"
      ? await payments.startPayment(req.user._id, order._id).catch(() => null)
      : null;
  sendSuccess(res, { statusCode: created ? 201 : 200, message: created ? "Order placed" : "Order already placed", data: { order, checkout } });
}
export const listMyOrders = respond((req) => orderService.listMine(req.user._id, parsePagination(req.validatedQuery, { defaultLimit: 10 })));

