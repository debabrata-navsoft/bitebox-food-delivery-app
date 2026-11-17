import { PERMISSIONS } from "../config/permissions.js";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { Session } from "../models/session.model.js";
import {
  ROLES,
  SELF_REGISTER_ROLES,
  User,
  USER_STATUS,
} from "../models/user.model.js";
import { ApiError } from "../utils/api-error.js";
import { hashToken, randomToken, signAccessToken } from "../utils/tokens.js";
import { sendEmail } from "./email-template.js";
import { notify, notifyAdmins } from "./notification.service.js";
import { CHANNELS } from "../models/notification-delivery.model.js";
import { OTP_PURPOSES } from "../models/otp-challenge.model.js";
import { channelEnabled } from "./notification-channels.js";
import * as otp from "./otp.service.js";
import * as referralService from "./referral.service.js";
import { isUploadedImageUrl } from "./upload.service.js";
import * as rewardEvents from "./reward-events.js";

const ROTATION_GRACE_MS = 15_000;

// Used to keep login timing similar whether or not the email exists.
const DUMMY_HASH = bcrypt.hashSync("bitebox-timing-equaliser", 4);

export const hashPassword = (password) => bcrypt.hash(password, env.bcryptRounds);

async function createSession(user, meta, family = crypto.randomUUID()) {
  const refreshToken = randomToken();
  await Session.create({
    user: user._id,
    tokenHash: hashToken(refreshToken),
    family,
    expiresAt: new Date(Date.now() + env.refreshToken.ttlDays * 86_400_000),
    userAgent: meta.userAgent?.slice(0, 512),
    ip: meta.ip,
  });
  return refreshToken;
}

async function issueTokens(user, meta, family) {
  const refreshToken = await createSession(user, meta, family);
  return {
    user: user.toJSON(),
    accessToken: signAccessToken(user),
    refreshToken,
  };
}

async function revokeAllSessions(userId, reason) {
  await Session.updateMany(
    { user: userId, revokedAt: null },
    { revokedAt: new Date(), revokedReason: reason },
  );
}

/**
 * Saves `user` (with any pending changes) and signs them out everywhere: old access tokens
 * fail (`tokenVersion`, incremented atomically whether or not it was loaded) and refresh
 * tokens are revoked.
 */
export async function endSessions(user, reason) {
  user.$inc("tokenVersion", 1);
  await user.save();
  await revokeAllSessions(user._id, reason);
}

/**
 * Sets an account's status (admin action). Any non-active status signs the person out everywhere
 * at once; the reason is kept until they are reactivated. The caller handles role-specific steps
 * first (riders are taken offline).
 */
export async function applyStatus(user, status, reason) {
  const active = status === USER_STATUS.ACTIVE;
  user.status = status;
  user.statusReason = active ? null : reason;
  user.statusChangedAt = new Date();
  await endSessions(user, active ? "logout" : status);
}

/** Partner sign-ups admins are told about (customers sign up too often to notify). */
const PARTNER_SIGNUP = {
  [ROLES.RESTAURANT]: {
    what: "restaurant partner",
    link: "/admin/users",
    permission: PERMISSIONS.CUSTOMERS_VIEW,
  },
  [ROLES.DELIVERY]: {
    what: "delivery partner",
    link: "/admin/delivery-partners",
    permission: PERMISSIONS.RIDERS_MANAGE,
  },
};

export async function register(
  { name, email, phone, password, role = ROLES.CUSTOMER, referralCode, code },
  meta,
) {
  if (!SELF_REGISTER_ROLES.includes(role)) {
    throw ApiError.forbidden("This role cannot be self-registered");
  }
  // Referral codes are for customers; check the code before creating the account.
  const referral =
    referralCode && role === ROLES.CUSTOMER
      ? await referralService.resolveCode(referralCode)
      : null;

  await checkNewAccount(email, phone);
  let emailVerifiedAt;
  if (signupNeedsCode()) {
    // Step 2: the account is created only with the code emailed to its address.
    if (!code) throw ApiError.badRequest("Enter the code we sent to your email", [{ field: "code", message: "Enter the 6-digit code" }]);
    await otp.checkEmailCode(email, OTP_PURPOSES.REGISTER_EMAIL, code);
    emailVerifiedAt = new Date();
  }

  const user = await User.create({
    name,
    email,
    phone,
    role,
    emailVerifiedAt,
    passwordHash: await hashPassword(password),
  });
  logger.info({ userId: user.id, role }, "User registered");
  // Already verified with the code, so sendEmailVerification sends no link.
  await sendEmailVerification(user).catch((err) =>
    logger.error({ err, userId: user.id }, "Could not send the verification email"),
  );
  const [title, welcomeBody, link] = WELCOME[role] ?? WELCOME.customer;
  await notify(user._id, { type: "account.welcome", title: title(name), body: welcomeBody, link });
  if (role === ROLES.CUSTOMER)
    await rewardEvents.customerRegistered(user, { referral, ip: meta?.ip });
  const signup = PARTNER_SIGNUP[role];
  if (signup)
    await notifyAdmins({
      type: `user.${role}`,
      title: `New ${signup.what}: ${name}`,
      body: email,
      link: signup.link,
    }, signup.permission);
  return issueTokens(user, meta);
}

async function checkNewAccount(email, phone) {
  if (await User.exists({ email })) throw ApiError.conflict("An account with this email already exists");
  if (phone && (await User.exists({ phone })))
    throw ApiError.conflict("An account with this phone number already exists");
}

/** What the sign-in and profile pages may offer: SMS codes only when an SMS provider is set up. */
export const authMethods = () => ({ phone: channelEnabled(CHANNELS.SMS) });
/** New accounts confirm their email with an emailed code first (SIGNUP_OTP_REQUIRED). */
export const signupNeedsCode = () => signupOverride ?? env.signupOtpRequired;
let signupOverride = null;
/** Tests: require the sign-up code (true/false), or null for the configured behaviour. */
export const useSignupCode = (value) => (signupOverride = value);

/**
 * Step 1 of sign-up: the email and number are free, so email a code to the address. While codes
 * are off, says so and the client creates the account at once.
 */
export async function requestSignupCode({ email, phone }, ip) {
  await checkNewAccount(email, phone);
  if (!signupNeedsCode()) return { codeRequired: false };
  return { ...(await otp.sendEmailCode(email, OTP_PURPOSES.REGISTER_EMAIL, ip)), codeRequired: true };
}

/** The welcome notification (in-app, and email when allowed) per role. */
const WELCOME = {
  customer: [(n) => `Welcome to BiteBox, ${n}!`, "Find a restaurant near you and order in minutes.", "/"],
  restaurant: [
    (n) => `Welcome to BiteBox, ${n}!`,
    "Add your restaurant details to start receiving orders.",
    "/restaurant/details",
  ],
  delivery: [(n) => `Welcome to BiteBox, ${n}!`, "Add your vehicle, go online and start earning.", "/delivery"],
};

export async function login({ email, password, portal }, meta) {
  const user = await User.findOne({ email }).select(
    "+passwordHash +tokenVersion",
  );
  const passwordOk = await bcrypt.compare(
    password,
    user?.passwordHash ?? DUMMY_HASH,
  );

  if (!user || !passwordOk)
    throw ApiError.unauthorized("Invalid email or password");
  return signedIn(user, portal, meta);
}

// Sign-in refused for a non-active account (same 403 for every status; the message names it).
const STATUS_MESSAGE = {
  [USER_STATUS.INACTIVE]: "This account is inactive",
  [USER_STATUS.SUSPENDED]: "This account has been suspended",
  [USER_STATUS.BLOCKED]: "This account is blocked",
};

async function signedIn(user, portal, meta) {
  if (user.status !== USER_STATUS.ACTIVE)
    throw ApiError.forbidden(STATUS_MESSAGE[user.status] ?? STATUS_MESSAGE.suspended);
  // Each panel has its own sign-in page; prevent e.g. a customer using the admin login.
  if (portal && user.role !== portal) {
    throw ApiError.forbidden("This account cannot sign in to this portal");
  }
  user.lastLoginAt = new Date();
  await user.save();
  return issueTokens(user, meta);
}

/** Sign in with the SMS code sent by otp.requestLoginCode (proves the number, too). */
export async function loginWithCode({ phone, code, portal }, meta) {
  await otp.checkCode(phone, OTP_PURPOSES.LOGIN, code);
  const user = await otp.loginUser(phone);
  if (!user) throw ApiError.unauthorized("That code is not right"); // no code was ever sent
  user.phoneVerifiedAt ??= new Date();
  return signedIn(user, portal, meta);
}

export const requestLoginCode = otp.requestLoginCode;

export async function requestPhoneVerification(user, ip) {
  if (!user.phone) throw ApiError.badRequest("Add a phone number to your profile first");
  if (user.phoneVerifiedAt) throw ApiError.conflict("Your phone number is already verified");
  return otp.sendCode(user.phone, OTP_PURPOSES.VERIFY_PHONE, ip, true);
}

export async function verifyPhone(user, code) {
  if (!user.phone) throw ApiError.badRequest("Add a phone number to your profile first");
  await otp.checkCode(user.phone, OTP_PURPOSES.VERIFY_PHONE, code);
  return User.findByIdAndUpdate(user._id, { phoneVerifiedAt: new Date() }, { returnDocument: "after" });
}

/**
 * When `minGapMs` is set, only a link sent at least that long ago (or none) may be replaced: the
 * check and the new token are one atomic write, so two quick requests send one email. Otherwise 429.
 */
async function storeLinkToken(userId, hashField, expiresField, ttlMs, minGapMs) {
  const token = randomToken(32);
  const now = Date.now();
  const filter = { _id: userId };
  if (minGapMs)
    filter.$or = [
      { [expiresField]: null },
      { [expiresField]: { $lte: new Date(now + ttlMs - minGapMs) } },
    ];
  const { matchedCount } = await User.updateOne(filter, {
    [hashField]: hashToken(token),
    [expiresField]: new Date(now + ttlMs),
  });
  if (!matchedCount)
    throw new ApiError(429, "A link was sent a moment ago. Wait a minute before sending another", {
      code: "RATE_LIMITED",
    });
  return token;
}

/**
 * Emails a one-time link (env.emailVerification.ttlHours) that confirms the address.
 * `minGapMs`: refuse (429) when a link went out more recently than that (see storeLinkToken).
 */
export async function sendEmailVerification(user, { minGapMs } = {}) {
  if (user.emailVerifiedAt) return;
  const hours = env.emailVerification.ttlHours;
  const token = await storeLinkToken(
    user._id,
    "emailVerificationTokenHash",
    "emailVerificationExpiresAt",
    hours * 3_600_000,
    minGapMs,
  );
  await sendEmail(user.email, {
    subject: "Confirm your BiteBox email",
    title: "Confirm your email address",
    name: user.name,
    lines: ["Tap the button to confirm this is your email address for BiteBox."],
    actionLabel: "Confirm email",
    actionUrl: `${env.clientUrls[0]}/verify-email?token=${encodeURIComponent(token)}`,
    note: `The link works for ${hours} hours. If you did not create an account, ignore this email.`,
  });
}

/** The update that marks an email verified and drops any pending link. */
const markEmailVerified = () => ({
  $set: { emailVerifiedAt: new Date() },
  $unset: { emailVerificationTokenHash: 1, emailVerificationExpiresAt: 1 },
});

/** Emails a signed-in person a code that confirms their address (the account page). */
export async function requestEmailCode(user, ip) {
  if (user.emailVerifiedAt) throw ApiError.conflict("Your email is already verified");
  return otp.sendEmailCode(user.email, OTP_PURPOSES.VERIFY_EMAIL, ip, user.name);
}

export async function verifyEmailCode(user, code) {
  if (user.emailVerifiedAt) throw ApiError.conflict("Your email is already verified");
  await otp.checkEmailCode(user.email, OTP_PURPOSES.VERIFY_EMAIL, code);
  return User.findByIdAndUpdate(user._id, markEmailVerified(), { returnDocument: "after" });
}

export async function resendEmailVerification(user) {
  if (user.emailVerifiedAt) throw ApiError.conflict("Your email is already verified");
  await sendEmailVerification(user);
}

export async function verifyEmail(token) {
  // Consume the token atomically so it works once.
  const user = await User.findOneAndUpdate(
    { emailVerificationTokenHash: hashToken(token), emailVerificationExpiresAt: { $gt: new Date() } },
    markEmailVerified(),
  );
  if (!user) throw ApiError.badRequest("This link is invalid or has expired. Ask for a new one");
}

/** Rotate a refresh token: the old one is atomically revoked and a new one issued. */
export async function refresh(rawToken, meta) {
  if (!rawToken) throw ApiError.unauthorized("No session");
  const tokenHash = hashToken(rawToken);

  // Atomically rotate valid token.
  let session = await Session.findOneAndUpdate(
    { tokenHash, revokedAt: null, expiresAt: { $gt: new Date() } },
    { revokedAt: new Date(), revokedReason: "rotated" },
  );

  if (!session) {
    const stale = await Session.findOne({ tokenHash });
    if (stale?.revokedReason === "rotated") {
      if (Date.now() - stale.revokedAt.getTime() < ROTATION_GRACE_MS) {
        session = stale; // Grace-period race: continue and reissue tokens for the active family.
      } else {
        await Session.updateMany(
          { family: stale.family, revokedAt: null },
          { revokedAt: new Date(), revokedReason: "reuse" },
        );
        logger.warn(
          { userId: String(stale.user) },
          "Refresh token reuse detected; session family revoked",
        );
      }
    }
    if (!session) throw ApiError.unauthorized("Session expired, please sign in again");
  }

  const user = await User.findById(session.user).select("+tokenVersion");
  if (!user || user.status !== USER_STATUS.ACTIVE) {
    throw ApiError.unauthorized("Session expired, please sign in again");
  }

  return issueTokens(user, meta, session.family);
}

export async function logout(rawToken) {
  if (!rawToken) return;
  await Session.updateOne(
    { tokenHash: hashToken(rawToken), revokedAt: null },
    { revokedAt: new Date(), revokedReason: "logout" },
  );
}

export async function forgotPassword(email) {
  const user = await User.findOne({ email, status: USER_STATUS.ACTIVE });
  // Always behave the same to avoid revealing which emails are registered.
  if (!user) return;
  await sendPasswordReset(user);
}

/**
 * Emails `user` a one-time password reset link (env.passwordReset.ttlMinutes): the forgot-password
 * email, also sent by admins on request (with `minGapMs`, see storeLinkToken).
 */
export async function sendPasswordReset(user, { minGapMs } = {}) {
  const token = await storeLinkToken(
    user._id,
    "passwordResetTokenHash",
    "passwordResetExpiresAt",
    env.passwordReset.ttlMinutes * 60_000,
    minGapMs,
  );
  await sendEmail(user.email, {
    subject: "Reset your BiteBox password",
    title: "Reset your password",
    name: user.name,
    lines: ["We got a request to reset your BiteBox password. Tap the button to choose a new one."],
    actionLabel: "Reset password",
    actionUrl: `${env.clientUrls[0]}/reset-password?token=${encodeURIComponent(token)}`,
    note: `The link expires in ${env.passwordReset.ttlMinutes} minutes and works once. If you did not ask for this, you can ignore this email; your password stays the same.`,
  });
}

/** A new password must differ from the one it replaces (reset and change). */
async function refuseCurrentPassword(passwordHash, newPassword, field) {
  if (passwordHash && (await bcrypt.compare(newPassword, passwordHash))) {
    const message = "Your new password must be different from your current password";
    throw ApiError.badRequest(message, [{ field, message }]);
  }
}

export async function resetPassword(token, newPassword) {
  const match = { passwordResetTokenHash: hashToken(token), passwordResetExpiresAt: { $gt: new Date() } };
  const current = await User.findOne(match).select("+passwordHash");
  if (!current) throw ApiError.badRequest("This reset link is invalid or has expired");
  // Refused before the link is used, so it still works with a different password.
  await refuseCurrentPassword(current.passwordHash, newPassword, "password");
  const passwordHash = await hashPassword(newPassword);
  // Atomically consume the token so it can only be used once.
  const user = await User.findOneAndUpdate(
    match,
    {
      $set: { passwordHash },
      $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 },
      $inc: { tokenVersion: 1 },
    },
  );
  if (!user)
    throw ApiError.badRequest("This reset link is invalid or has expired");
  await revokeAllSessions(user._id, "password-change");
}

export async function changePassword(userId, currentPassword, newPassword) {
  const user = await User.findById(userId).select(
    "+passwordHash +tokenVersion",
  );
  if (!user) throw ApiError.notFound("User not found");
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw ApiError.badRequest("Current password is incorrect");
  }
  await refuseCurrentPassword(user.passwordHash, newPassword, "newPassword");
  user.passwordHash = await hashPassword(newPassword);
  await endSessions(user, "password-change");
}

export async function updateProfile(userId, { name, phone, avatarUrl, gender }) {
  if (phone && (await User.exists({ phone, _id: { $ne: userId } }))) {
    throw ApiError.conflict("An account with this phone number already exists");
  }
  if (avatarUrl && !isUploadedImageUrl(avatarUrl)) throw ApiError.badRequest("Upload the photo first");
  const current = await User.findById(userId).select("phone");
  const set = {};
  const unset = {};
  if (name !== undefined) set.name = name;
  if (phone === "" || phone === null) unset.phone = 1;
  else if (phone !== undefined) set.phone = phone;
  // A new number must be verified again.
  if (phone !== undefined && (phone || null) !== (current?.phone ?? null)) unset.phoneVerifiedAt = 1;
  if (avatarUrl === "" || avatarUrl === null) unset.avatarUrl = 1;
  else if (avatarUrl !== undefined) set.avatarUrl = avatarUrl;
  if (gender === null) unset.gender = 1;
  else if (gender !== undefined) set.gender = gender;

  const user = await User.findByIdAndUpdate(
    userId,
    {
      ...(Object.keys(set).length && { $set: set }),
      ...(Object.keys(unset).length && { $unset: unset }),
    },
    { returnDocument: "after", runValidators: true },
  );
  if (!user) throw ApiError.notFound("User not found");
  return user;
}

export { revokeAllSessions };

