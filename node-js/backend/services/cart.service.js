import mongoose from "mongoose";
import { PRICING } from "../config/pricing.js";
import { Address } from "../models/address.model.js";
import { Cart, MAX_ITEM_QUANTITY } from "../models/cart.model.js";
import { FoodItem } from "../models/food-item.model.js";
import { RESTAURANT_STATUS, Restaurant } from "../models/restaurant.model.js";
import { ApiError } from "../utils/api-error.js";
import { haversineMeters } from "../utils/geo.js";
import * as coinsService from "./coins.service.js";
import { COUPON_KINDS, kindOf } from "../models/coupon.model.js";
import * as couponService from "./coupon.service.js";
import { Stack, discountLines, summary } from "./discount-stack.js";
import { computePricing } from "./pricing.service.js";

const loadCart = (userId) => Cart.findOne({ user: userId }).exec();

/**
 * Retries a load-modify-save once if a concurrent edit bumped the cart version. `firstLoad` is a
 * cart read already started by the caller (so it runs alongside the caller's own reads).
 */
async function mutateCart(userId, mutate, firstLoad) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const cart =
      (await (attempt === 0 && firstLoad ? firstLoad : loadCart(userId))) ??
      new Cart({ user: userId, items: [] });
    await mutate(cart);
    try {
      if (cart.items.length === 0) {
        cart.restaurant = undefined;
        cart.couponCode = undefined;
        cart.offerCode = undefined;
        cart.coinsToRedeem = 0;
      }
      return await cart.save();
    } catch (error) {
      if (error instanceof mongoose.Error.VersionError && attempt === 0)
        continue;
      if (error?.code === 11000 && attempt === 0) continue; // first cart created concurrently
      throw error;
    }
  }
  throw ApiError.conflict("Your cart was updated elsewhere. Please try again.");
}

/** The dish with its restaurant's status and name, in one round trip ($lookup, not populate). */
async function loadOrderableItem(foodItemId) {
  if (!mongoose.isValidObjectId(foodItemId)) throw ApiError.notFound("This dish is not available");
  const [item] = await FoodItem.aggregate([
    { $match: { _id: new mongoose.Types.ObjectId(String(foodItemId)), deletedAt: null } },
    { $limit: 1 },
    {
      $lookup: {
        from: Restaurant.collection.name,
        localField: "restaurant",
        foreignField: "_id",
        pipeline: [{ $project: { status: 1, name: 1 } }],
        as: "restaurant",
      },
    },
    { $set: { restaurant: { $first: "$restaurant" } } },
    { $project: { name: 1, isAvailable: 1, restaurant: 1 } },
  ]);
  if (
    !item ||
    !item.restaurant ||
    item.restaurant.status !== RESTAURANT_STATUS.APPROVED
  ) {
    throw ApiError.notFound("This dish is not available");
  }
  if (!item.isAvailable)
    throw new ApiError(409, `${item.name} is currently unavailable`, {
      code: "ITEM_UNAVAILABLE",
    });
  return item;
}

export async function addItem(
  userId,
  { foodItemId, quantity = 1, replace = false },
) {
  // The cart and the dish load together (each read is a round trip to the database).
  const cartLoad = loadCart(userId);
  cartLoad.catch(() => {}); // awaited in mutateCart; this only stops an unhandled rejection
  const item = await loadOrderableItem(foodItemId);
  const restaurantId = item.restaurant._id;

  return mutateCart(userId, async (cart) => {
    if (
      cart.restaurant &&
      cart.items.length &&
      !cart.restaurant.equals(restaurantId)
    ) {
      if (!replace) {
        const current = await Restaurant.findById(cart.restaurant).select(
          "name",
        );
        throw new ApiError(
          409,
          `Your cart has dishes from ${current?.name ?? "another restaurant"}. Start a new cart?`,
          {
            code: "CART_RESTAURANT_CONFLICT",
            details: [{ field: "restaurant", message: current?.name ?? "" }],
          },
        );
      }
      cart.items = [];
      cart.couponCode = undefined;
      cart.offerCode = undefined;
    }
    cart.restaurant = restaurantId;
    const line = cart.items.find((l) => l.foodItem.equals(item._id));
    if (line)
      line.quantity = Math.min(MAX_ITEM_QUANTITY, line.quantity + quantity);
    else
      cart.items.push({
        foodItem: item._id,
        quantity: Math.min(MAX_ITEM_QUANTITY, quantity),
      });
  }, cartLoad);
}

/** Sets an exact quantity; 0 removes the line. */
export async function setQuantity(userId, foodItemId, quantity) {
  return mutateCart(userId, async (cart) => {
    const index = cart.items.findIndex((l) => l.foodItem.equals(foodItemId));
    if (index === -1) throw ApiError.notFound("This dish is not in your cart");
    if (quantity === 0) cart.items.splice(index, 1);
    else {
      // Increasing quantity requires the dish to still be orderable.
      if (quantity > cart.items[index].quantity)
        await loadOrderableItem(foodItemId);
      cart.items[index].quantity = quantity;
    }
  });
}

export const removeItem = (userId, foodItemId) =>
  setQuantity(userId, foodItemId, 0);

export async function clear(userId) {
  await Cart.deleteOne({ user: userId });
}

export async function applyCoupon(userId, code) {
  const quote = await buildQuote(userId);
  if (!quote.cart) throw ApiError.badRequest("Add dishes to your cart first");
  // A coupon code, or one of the restaurant's offers chosen instead of the best one: validated
  // against the current cart (with each line's dish and category) before it is saved.
  const found = await couponService.assertEligible(
    code,
    {
      userId,
      restaurantId: quote.cart.restaurant.id,
      subtotalPaise: quote.pricing.subtotalPaise,
      lines: quote.engineLines,
    },
    null,
    [COUPON_KINDS.COUPON, COUPON_KINDS.RESTAURANT_OFFER],
  );
  return mutateCart(userId, async (cart) => {
    if (kindOf(found) === COUPON_KINDS.RESTAURANT_OFFER) cart.offerCode = found.code;
    else cart.couponCode = found.code;
  });
}

export async function removeCoupon(userId) {
  return mutateCart(userId, async (cart) => {
    cart.couponCode = undefined;
  });
}

/**
 * Asks to pay part of the order with coins. The amount must be usable on the current cart
 * (minimum, caps); it is stored clamped to what can apply now and re-checked on every quote.
 */
export async function setCoins(userId, coins) {
  if (coins === 0) return removeCoins(userId);
  const quote = await buildQuote(userId);
  if (!quote.cart) throw ApiError.badRequest("Add dishes to your cart first");
  coinsService.assertRedeemable(quote.coins, coins);
  return mutateCart(userId, async (cart) => {
    cart.coinsToRedeem = Math.min(coins, quote.coins.maxRedeemable);
  });
}

export async function removeCoins(userId) {
  return mutateCart(userId, async (cart) => {
    cart.coinsToRedeem = 0;
  });
}

/**
 * Prices the customer's cart from current database values and reports
 * anything that blocks checkout. This is the single source of truth used by
 * both the cart page and order placement. `payment` is the online channel the customer picked
 * (upi, card, ...; null for cash): the payment offer for it joins the stack (discount-stack.js).
 */
export async function buildQuote(userId, { addressId, payment = null, cart: saved } = {}) {
  // A cart the caller just saved needs no second read.
  const cart = saved ?? (await loadCart(userId));
  const empty = {
    cart: null,
    coupon: null,
    couponError: null,
    bestCoupon: null,
    discounts: [],
    paymentOffers: [],
    restaurantOffers: [],
    paymentChannel: null,
    coins: null,
    address: null,
    delivery: null,
    pricing: computePricing({ subtotalPaise: 0 }),
    issues: [],
    canCheckout: false,
  };
  if (!cart || cart.items.length === 0) return empty;

  // Independent reads run together (each sequential read is a round trip to the database).
  // Without an explicit address, quote against the customer's default one.
  const [restaurant, foods, address, coinsBase] = await Promise.all([
    Restaurant.findById(cart.restaurant),
    FoodItem.find({ _id: { $in: cart.items.map((l) => l.foodItem) } }),
    Address.findOne(addressId ? { _id: addressId, user: userId } : { user: userId, isDefault: true }),
    coinsService.loadCartCoins(userId),
  ]);
  if (addressId && !address) throw ApiError.notFound("Address not found");
  const foodById = new Map(foods.map((f) => [String(f._id), f]));
  const issues = [];

  const lines = cart.items.map((line) => {
    const food = foodById.get(String(line.foodItem));
    const orderable = Boolean(
      food &&
      !food.deletedAt &&
      food.isAvailable &&
      food.restaurant.equals(cart.restaurant),
    );
    return {
      foodItemId: String(line.foodItem),
      name: food?.name ?? "Removed dish",
      isVeg: food?.isVeg ?? false,
      imageUrl: food?.imageUrl,
      unitPricePaise: food?.pricePaise ?? 0,
      quantity: line.quantity,
      lineTotalPaise: orderable ? food.pricePaise * line.quantity : 0,
      isAvailable: orderable,
    };
  });

  if (lines.some((l) => !l.isAvailable)) {
    issues.push({
      code: "ITEMS_UNAVAILABLE",
      message: "Some dishes are no longer available. Remove them to continue.",
    });
  }
  if (!restaurant || restaurant.status !== RESTAURANT_STATUS.APPROVED) {
    issues.push({
      code: "RESTAURANT_UNAVAILABLE",
      message: "This restaurant is not taking orders on BiteBox right now.",
    });
  } else if (!restaurant.isOpenNow) {
    issues.push({
      code: "RESTAURANT_CLOSED",
      message: restaurant.isAcceptingOrders
        ? `${restaurant.name} is closed now. It opens at ${restaurant.openingTime}.`
        : `${restaurant.name} has paused orders for now.`,
    });
  }

  const subtotalPaise = lines.reduce((sum, l) => sum + l.lineTotalPaise, 0);
  if (restaurant && subtotalPaise < restaurant.minOrderPaise) {
    issues.push({
      code: "BELOW_MINIMUM",
      message: `Minimum order is ₹${restaurant.minOrderPaise / 100}. Add ₹${((restaurant.minOrderPaise - subtotalPaise) / 100).toFixed(0)} more.`,
    });
  }

  // What the coupon engine sees: each orderable line's dish, category and total.
  const engineLines = lines
    .filter((l) => l.isAvailable)
    .map((l) => ({
      foodItemId: l.foodItemId,
      categoryId: String(foodById.get(l.foodItemId)?.category ?? ""),
      totalPaise: l.lineTotalPaise,
    }));

  // Coupon: re-validated on every read; an invalid coupon is reported, not silently applied.
  let coupon = null;
  let couponError = null;
  if (cart.couponCode) {
    try {
      coupon = await couponService.assertEligible(cart.couponCode, {
        userId,
        restaurantId: cart.restaurant,
        subtotalPaise,
        lines: engineLines,
      });
    } catch (error) {
      couponError = { code: cart.couponCode, message: error.message };
    }
  }

  // Delivery distance
  let distanceMeters = null;
  if (!address) {
    issues.push({ code: "NO_ADDRESS", message: "Add a delivery address." });
  } else if (restaurant) {
    distanceMeters = haversineMeters(
      restaurant.location.coordinates,
      address.location.coordinates,
    );
    if (distanceMeters > PRICING.maxDeliveryDistanceKm * 1000) {
      issues.push({
        code: "OUT_OF_RANGE",
        message: `This address is ${(distanceMeters / 1000).toFixed(1)} km away. ${restaurant.name} delivers within ${PRICING.maxDeliveryDistanceKm} km.`,
      });
    }
  }

  // The discounts: the best automatic offers, the coupon, then the payment offer.
  const stack = await Stack.load({
    userId,
    restaurantId: cart.restaurant,
    subtotalPaise,
    lines: engineLines,
    distanceMeters,
  });
  // The restaurant offer the customer picked (while it still applies), else the best one.
  const picked = stack.coupons.find(
    (c) => c.code === cart.offerCode && kindOf(c) === COUPON_KINDS.RESTAURANT_OFFER,
  );
  const restaurantOffer =
    picked && (await stack.usable(picked)) ? picked : (await stack.best(COUPON_KINDS.RESTAURANT_OFFER, []))?.c;
  const chosen = restaurantOffer ? [restaurantOffer] : [];
  const platformOffer = (await stack.best(COUPON_KINDS.PLATFORM_OFFER, chosen))?.c;
  if (platformOffer) chosen.push(platformOffer);
  if (coupon) chosen.push(coupon);
  const beforePayment = [...chosen];
  const paymentOffer = payment && (await stack.best(COUPON_KINDS.PAYMENT_OFFER, chosen, payment))?.c;
  if (paymentOffer) chosen.push(paymentOffer);
  // The best coupon code the customer could add (what it saves next to the automatic offers).
  const others = chosen.filter((c) => kindOf(c) !== COUPON_KINDS.COUPON);
  const bestCode = await stack.best(COUPON_KINDS.COUPON, others);

  // Coins: worked out on the food value after every discount, then taken off the payable total.
  const coins = coinsService.redemptionQuote({
    ...coinsBase,
    requested: cart.coinsToRedeem ?? 0,
    foodPaise: subtotalPaise - stack.price(chosen).pricing.discountPaise,
  });
  const { pricing, parts } = stack.price(chosen, coins.discountPaise);
  const discountRows = discountLines(chosen, parts);
  const applied = discountRows.find((d) => d.kind === COUPON_KINDS.COUPON);

  const quote = {
    cart: {
      id: String(cart._id),
      version: cart.__v,
      restaurant: restaurant
        ? {
            id: String(restaurant._id),
            name: restaurant.name,
            slug: restaurant.slug,
            imageUrl: restaurant.imageUrl,
            isOpenNow: restaurant.isOpenNow,
            minOrderPaise: restaurant.minOrderPaise,
            avgPrepTimeMinutes: restaurant.avgPrepTimeMinutes,
          }
        : null,
      items: lines,
      itemCount: lines.reduce((n, l) => n + l.quantity, 0),
    },
    coupon: applied
      ? {
          code: applied.code,
          description: applied.description,
          discountType: applied.discountType,
          // What the coupon saves: food discount plus any delivery fee it waived.
          discountPaise: applied.savingPaise,
        }
      : null,
    couponError,
    // Every discount on the bill, in the order it applied.
    discounts: discountRows,
    // The best coupon code for this cart, so checkout can suggest it (null when none saves).
    bestCoupon: bestCode ? { ...summary(bestCode.c), savingPaise: bestCode.savingPaise } : null,
    // The best payment offer for each online channel, for the payment step.
    paymentOffers: await stack.paymentOffers(beforePayment),
    // Every restaurant offer this cart can use (only one applies), best first.
    restaurantOffers: await stack.restaurantOffers(chosen),
    paymentChannel: payment ?? null,
    coins,
    address: address?.toJSON() ?? null,
    delivery:
      distanceMeters === null
        ? null
        : {
            distanceMeters,
            distanceKind: "straight_line",
            freeDelivery: pricing.deliveryFeePaise === 0,
            freeDeliveryThresholdPaise: PRICING.freeDeliveryThresholdPaise,
          },
    pricing,
    issues,
    canCheckout: issues.length === 0 && !couponError,
  };
  // For applyCoupon only; non-enumerable, so it is never sent to clients.
  Object.defineProperty(quote, "engineLines", { value: engineLines, enumerable: false });
  return quote;
}
