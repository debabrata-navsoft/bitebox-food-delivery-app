import crypto from "node:crypto";
import { env } from "../config/env.js";
import { OTP_PURPOSES, OtpChallenge } from "../models/otp-challenge.model.js";
import { User, USER_STATUS } from "../models/user.model.js";
import { ApiError } from "../utils/api-error.js";
import { CHANNELS } from "../models/notification-delivery.model.js";
import { channelEnabled, deliverSms } from "./notification-channels.js";
import { logger } from "../config/logger.js";
import { sendMail } from "./mail.service.js";
import { escapeHtml } from "../utils/html.js";

/**
 * One-time codes (same rules as backend/apps/accounts/otp.py, Django): by SMS to sign in with a
 * phone number or confirm a signed-in person's number, and by email to confirm the address at
 * sign-up or later.
 *
 * - 6 digits from crypto.randomInt; only an HMAC (keyed with the JWT secret) is stored.
 * - A code lives env.otp.ttlSeconds and allows env.otp.maxAttempts tries; a new one can be asked
 *   for after env.otp.resendSeconds, at most perPhonePerHour per number or email address and perIpPerHour per IP.
 * - Sign-in requests get the same answer whether or not the number has an account (a code is only
 *   sent when it does), so the endpoint cannot be used to find out who is registered.
 */
const hash = (target, code) =>
  crypto.createHmac("sha256", env.jwt.secret).update(`${target}:${code}`).digest("hex");
const limit = (message) => new ApiError(429, message, { code: "OTP_RATE_LIMITED" });
const { otp } = env;

const normaliseEmail = (email) => email.trim().toLowerCase();
const sent = () => ({ resendInSeconds: otp.resendSeconds, expiresInSeconds: otp.ttlSeconds });

/**
 * Checks the resend wait and hourly limits for the number or address in `field` ("phone" or
 * "email"), then stores a new challenge; returns it and its code.
 */
async function createChallenge(field, target, purpose, ip) {
  const lookup = { [field]: target };
  const now = Date.now();
  const last = await OtpChallenge.findOne({ ...lookup, purpose }).sort({ createdAt: -1 });
  const wait = last ? otp.resendSeconds - (now - last.createdAt.getTime()) / 1000 : 0;
  if (wait > 0) throw limit(`Wait ${Math.floor(wait) + 1} seconds before asking for a new code`);
  const hourAgo = new Date(now - 60 * 60_000);
  if ((await OtpChallenge.countDocuments({ ...lookup, purpose, createdAt: { $gte: hourAgo } })) >= otp.perPhonePerHour)
    throw limit(`Too many codes for this ${field === "phone" ? "number" : "email address"}. Try again in an hour`);
  if (ip && (await OtpChallenge.countDocuments({ ip, createdAt: { $gte: hourAgo } })) >= otp.perIpPerHour)
    throw limit("Too many codes requested. Try again in an hour");

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const challenge = await OtpChallenge.create({
    ...lookup,
    purpose,
    codeHash: hash(target, code),
    expiresAt: new Date(now + otp.ttlSeconds * 1000),
    ip: ip ?? null,
  });
  return { challenge, code };
}

/** Creates a challenge (always) and texts the code when `send` (e.g. the number has an account). */
export async function sendCode(phone, purpose, ip, send) {
  if (!channelEnabled(CHANNELS.SMS))
    throw new ApiError(503, "We can't send text messages right now. Please try again later", {
      code: "SMS_UNAVAILABLE",
    });
  const { code } = await createChallenge("phone", phone, purpose, ip);
  if (send)
    await deliverSms(
      phone,
      `${code} is your BiteBox code. It expires in ${Math.floor(otp.ttlSeconds / 60)} minutes. Never share it.`,
      env.notifications.msg91OtpTemplateId,
    );
  return sent();
}

/** Emails a 6-digit code that proves the address (sign-up, or verifying it later). */
export async function sendEmailCode(email, purpose, ip, name = "") {
  const to = normaliseEmail(email);
  const { challenge, code } = await createChallenge("email", to, purpose, ip);
  const minutes = Math.floor(otp.ttlSeconds / 60);
  const greeting = name ? `Hi ${name},` : "Hi,";
  try {
    await sendMail({
      to,
      subject: `${code} is your BiteBox verification code`,
      text: `${greeting}\n\nYour BiteBox verification code is ${code}\n\nIt expires in ${minutes} minutes. Never share it with anyone. If you did not ask for it, ignore this email.`,
      html: `<p>${escapeHtml(greeting)}</p><p>Your BiteBox verification code is</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>It expires in ${minutes} minutes. Never share it with anyone. If you did not ask for it, ignore this email.</p>`,
    });
  } catch (err) {
    await OtpChallenge.deleteOne({ _id: challenge._id }); // not sent, so it should not count against the limits
    logger.error({ err }, "Verification code email failed");
    throw new ApiError(503, "We can't send emails right now. Please try again later", {
      code: "EMAIL_UNAVAILABLE",
    });
  }
  return sent();
}

/** Uses up the latest live code for this number, or throws 400/429. Each try counts. */
export const checkCode = (phone, purpose, code) => check("phone", phone, purpose, code);

/** Uses up the latest live code emailed to this address, or throws 400/429. */
export const checkEmailCode = (email, purpose, code) => check("email", normaliseEmail(email), purpose, code);

async function check(field, target, purpose, code) {
  const challenge = await OtpChallenge.findOne({
    [field]: target,
    purpose,
    consumedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });
  if (!challenge) throw ApiError.badRequest("This code has expired. Ask for a new one");
  if (challenge.attempts >= otp.maxAttempts)
    throw new ApiError(429, "Too many wrong codes. Ask for a new one", { code: "OTP_LOCKED" });
  await OtpChallenge.updateOne({ _id: challenge._id }, { $inc: { attempts: 1 } });
  const expected = Buffer.from(challenge.codeHash);
  const given = Buffer.from(hash(target, code));
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    const left = otp.maxAttempts - challenge.attempts - 1;
    throw ApiError.badRequest(
      left
        ? `That code is not right. ${left} ${left === 1 ? "try" : "tries"} left`
        : "That code is not right. Ask for a new one",
    );
  }
  // Exactly once, even if two requests carry the right code at the same moment.
  const used = await OtpChallenge.updateOne(
    { _id: challenge._id, consumedAt: null },
    { consumedAt: new Date() },
  );
  if (!used.modifiedCount) throw ApiError.badRequest("This code has already been used. Ask for a new one");
}

/** The ways one Indian mobile number may be stored: as typed, 10 digits, +91 and 91 prefixed. */
export function phoneForms(phone) {
  const digits = phone.replace(/\D/g, "");
  const forms = new Set([phone, digits, `+${digits}`]);
  if (digits.length >= 10) {
    const last10 = digits.slice(-10);
    for (const f of [last10, `+91${last10}`, `91${last10}`]) forms.add(f);
  }
  return [...forms];
}

export const loginUser = (phone) =>
  User.findOne({ phone: { $in: phoneForms(phone) }, status: USER_STATUS.ACTIVE }).select("+tokenVersion");

export async function requestLoginCode(phone, ip) {
  return sendCode(phone, OTP_PURPOSES.LOGIN, ip, Boolean(await loginUser(phone)));
}
