import {
  adminRolesPaths,
  adminRolesSchemas,
  adminRolesTags,
} from "./openapi.admin-roles.js";
import {
  catalogPaths,
  catalogSchemas,
  catalogTags,
} from "./openapi.catalog.js";
import {
  checkoutPaths,
  checkoutSchemas,
  checkoutTags,
} from "./openapi.checkout.js";
import { ordersPaths, ordersSchemas, ordersTags } from "./openapi.orders.js";
import {
  paymentsPaths,
  paymentsSchemas,
  paymentsTags,
} from "./openapi.payments.js";
import {
  rewardsPaths,
  rewardsSchemas,
  rewardsTags,
} from "./openapi.rewards.js";
import { kycPaths, kycTags } from "./openapi.kyc.js";
import { offersPaths, offersTags } from "./openapi.offers.js";
import { pushPaths, pushSchemas, pushTags } from "./openapi.push.js";
import {
  reviewsPaths,
  reviewsSchemas,
  reviewsTags,
} from "./openapi.reviews.js";

const ok = (dataSchema, description = "Success") => ({
  description,
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["success", "message", "data"],
        properties: {
          success: { const: true },
          message: { type: "string" },
          data: dataSchema,
        },
      },
    },
  },
});

const err = (description) => ({
  description,
  content: {
    "application/json": { schema: { $ref: "#/components/schemas/Error" } },
  },
});

const jsonBody = (schemaRef) => ({
  required: true,
  content: { "application/json": { schema: { $ref: schemaRef } } },
});

const sessionData = {
  type: "object",
  properties: {
    user: { $ref: "#/components/schemas/User" },
    accessToken: { type: "string" },
  },
};

const password = {
  type: "string",
  minLength: 8,
  description: "8+ chars (max 72 bytes), at least one letter and one number",
};

const adminUserParams = [
  { in: "path", name: "id", required: true, schema: { type: "string" } },
  { in: "path", name: "addressId", required: true, schema: { type: "string" } },
];
const adminAddressBody = {
  required: true,
  content: {
    "application/json": {
      schema: {
        type: "object",
        description: "The same fields and rules as the customer's own /addresses endpoints",
        properties: {
          label: { type: "string", enum: ["home", "work", "other"] },
          recipientName: { type: "string" },
          phone: { type: "string" },
          line1: { type: "string" },
          line2: { type: "string" },
          area: { type: "string" },
          landmark: { type: "string" },
          city: { type: "string" },
          state: { type: "string" },
          postalCode: { type: "string" },
          location: {
            type: "object",
            properties: {
              latitude: { type: "number" },
              longitude: { type: "number" },
            },
          },
          isDefault: { type: "boolean" },
        },
      },
    },
  },
};
const adminAddressResponse = ok({
  type: "object",
  properties: { address: { $ref: "#/components/schemas/DeliveryAddress" } },
});

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "BiteBox API",
    version: "1.0.0",
    description:
      "BiteBox food delivery REST API. Authenticate with `POST /auth/login`, then send the returned access token as `Authorization: Bearer <token>`. The refresh token is set as an HttpOnly cookie scoped to `/api/v1/auth`. Every response uses the envelope `{ success, message, data }`; errors add `error.code` and, for validation, `error.details[{ field, message }]`. Money is always in integer paise. Live updates are pushed over Socket.IO (`order:updated`, `notification:new`, `order:location`).",
  },
  servers: [{ url: "/api/v1" }],
  tags: [
    { name: "Health" },
    { name: "Auth" },
    { name: "Admin - Users" },
    ...catalogTags,
    ...checkoutTags,
    ...ordersTags,
    ...paymentsTags,
    ...adminRolesTags,
    ...reviewsTags,
    ...rewardsTags,
    ...pushTags,
    ...kycTags,
    ...offersTags,
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {
      ...catalogSchemas,
      ...checkoutSchemas,
      ...ordersSchemas,
      ...paymentsSchemas,
      ...adminRolesSchemas,
      ...reviewsSchemas,
      ...rewardsSchemas,
      ...pushSchemas,
      Role: {
        type: "string",
        enum: [
          "customer",
          "admin",
          "restaurant",
          "delivery",
          "operations_admin",
          "finance_admin",
          "support_admin",
          "operator",
        ],
      },
      AccountStatus: {
        type: "string",
        enum: ["active", "inactive", "suspended", "blocked"],
        description:
          "Only active accounts sign in. inactive: switched off (e.g. closed on request); suspended: temporary sanction; blocked: permanent ban",
      },
      AccountStatusRequest: {
        type: "object",
        required: ["status"],
        properties: {
          status: { $ref: "#/components/schemas/AccountStatus" },
          reason: {
            type: "string",
            minLength: 3,
            maxLength: 500,
            description: "Required (trimmed) for every status but active",
          },
        },
      },
      User: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          email: { type: "string", format: "email" },
          phone: { type: "string" },
          role: { $ref: "#/components/schemas/Role" },
          status: { $ref: "#/components/schemas/AccountStatus" },
          statusReason: { type: "string", maxLength: 500, description: "Why the status was last changed (omitted when active)" },
          statusChangedAt: { type: "string", format: "date-time" },
          gender: { type: "string", enum: ["female", "male", "other", "prefer_not_to_say"] },
          avatarUrl: { type: "string" },
          birthDate: { type: "string", format: "date-time" },
          permissions: {
            type: "array",
            items: { type: "string" },
            description:
              "Admin-panel roles only: the effective permissions (super admin: all; else the custom list, or the role preset)",
          },
          customPermissions: {
            type: ["array", "null"],
            items: { type: "string" },
            description: "Admin-panel roles only: the person's own list, or null for the role preset",
          },
          lastLoginAt: { type: "string", format: "date-time" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      Error: {
        type: "object",
        properties: {
          success: { const: false },
          message: { type: "string" },
          error: {
            type: "object",
            properties: {
              code: { type: "string" },
              details: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    field: { type: "string" },
                    message: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
      RegisterRequest: {
        type: "object",
        required: ["name", "email", "password"],
        properties: {
          name: { type: "string", minLength: 2, maxLength: 80 },
          email: { type: "string", format: "email" },
          phone: { type: "string", pattern: "^\\+?[0-9]{10,15}$" },
          password,
          role: {
            type: "string",
            enum: ["customer", "restaurant", "delivery"],
            default: "customer",
          },
          referralCode: {
            type: "string",
            description: "A friend's referral code (customers only), e.g. BITEBOX-RIYA7K2Q",
          },
        },
      },
      LoginRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string" },
          portal: {
            $ref: "#/components/schemas/Role",
            description:
              "When set, sign-in fails unless the account has this role",
          },
        },
      },
      ForgotPasswordRequest: {
        type: "object",
        required: ["email"],
        properties: { email: { type: "string", format: "email" } },
      },
      ResetPasswordRequest: {
        type: "object",
        required: ["token", "password"],
        properties: { token: { type: "string" }, password },
      },
      ChangePasswordRequest: {
        type: "object",
        required: ["currentPassword", "newPassword"],
        properties: {
          currentPassword: { type: "string" },
          newPassword: password,
        },
      },
      UpdateProfileRequest: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 2, maxLength: 80 },
          phone: {
            type: "string",
            description: "Empty string removes the phone number",
          },
          avatarUrl: { type: "string", nullable: true, description: "An uploaded photo URL; null or empty removes it" },
          gender: {
            type: "string",
            nullable: true,
            enum: ["female", "male", "other", "prefer_not_to_say", null],
            description: "null clears it",
          },
        },
      },
      Pagination: {
        type: "object",
        properties: {
          page: { type: "integer" },
          limit: { type: "integer" },
          total: { type: "integer" },
          totalPages: { type: "integer" },
        },
      },
    },
  },
  paths: {
    ...catalogPaths,
    ...checkoutPaths,
    ...ordersPaths,
    ...paymentsPaths,
    ...adminRolesPaths,
    ...reviewsPaths,
    ...rewardsPaths,
    ...pushPaths,
    ...kycPaths,
    ...offersPaths,
    "/health": {
      get: {
        tags: ["Health"],
        summary: "API and database health",
        responses: {
          200: ok({
            type: "object",
            properties: {
              status: { type: "string" },
              database: { type: "string" },
            },
          }),
          503: { description: "Database unreachable" },
        },
      },
    },
    "/health/live": {
      get: {
        tags: ["Health"],
        summary: "Liveness probe: the process is running",
        responses: { 200: ok({ type: "object", properties: { status: { type: "string" } } }) },
      },
    },
    "/health/ready": {
      get: {
        tags: ["Health"],
        summary: "Readiness probe: the database answers",
        responses: {
          200: ok({ type: "object", properties: { status: { type: "string" } } }),
          503: { description: "Not ready" },
        },
      },
    },
    "/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Register a customer, restaurant or delivery partner account",
        requestBody: jsonBody("#/components/schemas/RegisterRequest"),
        responses: {
          201: ok(sessionData, "Account created; refresh cookie set"),
          409: err("Email or phone in use"),
          422: err("Validation failed"),
          429: err("Rate limited"),
        },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Sign in",
        requestBody: jsonBody("#/components/schemas/LoginRequest"),
        responses: {
          200: ok(sessionData, "Signed in; refresh cookie set"),
          401: err("Invalid credentials"),
          403: err("Suspended or wrong portal"),
          429: err("Rate limited"),
        },
      },
    },
    "/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Rotate the refresh cookie and get a new access token",
        description:
          "Requires the `bb_refresh` cookie and header `X-Requested-With: BiteBox`.",
        parameters: [
          {
            in: "header",
            name: "X-Requested-With",
            required: true,
            schema: { const: "BiteBox" },
          },
        ],
        responses: {
          200: ok(sessionData),
          401: err("No/expired session"),
          403: err("Untrusted origin or missing CSRF header"),
        },
      },
    },
    "/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Revoke the current refresh session",
        parameters: [
          {
            in: "header",
            name: "X-Requested-With",
            required: true,
            schema: { const: "BiteBox" },
          },
        ],
        responses: { 200: ok({ type: "null" }) },
      },
    },
    "/auth/forgot-password": {
      post: {
        tags: ["Auth"],
        summary: "Email a single-use password reset link",
        description:
          "Always returns 200 so the response does not reveal whether the email is registered.",
        requestBody: jsonBody("#/components/schemas/ForgotPasswordRequest"),
        responses: {
          200: ok({ type: "null" }),
          422: err("Validation failed"),
          429: err("Rate limited"),
        },
      },
    },
    "/auth/reset-password": {
      post: {
        tags: ["Auth"],
        summary: "Reset password with a token from the email link",
        requestBody: jsonBody("#/components/schemas/ResetPasswordRequest"),
        responses: {
          200: ok({ type: "null" }),
          400: err("Invalid or expired token"),
          422: err("Validation failed"),
        },
      },
    },
    "/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "Current user",
        security: [{ bearerAuth: [] }],
        responses: {
          200: ok({
            type: "object",
            properties: { user: { $ref: "#/components/schemas/User" } },
          }),
          401: err("Unauthenticated"),
        },
      },
      patch: {
        tags: ["Auth"],
        summary: "Update own profile",
        security: [{ bearerAuth: [] }],
        requestBody: jsonBody("#/components/schemas/UpdateProfileRequest"),
        responses: {
          200: ok({
            type: "object",
            properties: { user: { $ref: "#/components/schemas/User" } },
          }),
          409: err("Phone in use"),
          422: err("Validation failed"),
        },
      },
    },
    "/auth/change-password": {
      post: {
        tags: ["Auth"],
        summary: "Change password (signs out all sessions)",
        security: [{ bearerAuth: [] }],
        requestBody: jsonBody("#/components/schemas/ChangePasswordRequest"),
        responses: {
          200: ok({ type: "null" }),
          400: err("Current password incorrect"),
          422: err("Validation failed"),
        },
      },
    },
    "/auth/methods": {
      get: {
        tags: ["Auth"],
        security: [],
        summary: "Which sign-in options are on (phone: SMS codes, only when an SMS provider is set up)",
        responses: { 200: ok({ type: "object", properties: { phone: { type: "boolean" } } }) },
      },
    },
    "/auth/register/code": {
      post: {
        tags: ["Auth"],
        summary: "Sign-up step 1: email a code to the new address (then POST /auth/register with code)",
        requestBody: { content: { "application/json": { schema: { type: "object", required: ["email", "phone"], properties: { email: { type: "string" }, phone: { type: "string" } } } } } },
        responses: {
          200: ok({ type: "object", properties: { codeRequired: { type: "boolean", description: "false while SIGNUP_OTP_REQUIRED is off (no code sent; sign up in one step)" }, resendInSeconds: { type: "integer" }, expiresInSeconds: { type: "integer" } } }),
          409: err("Email or phone already registered"),
          429: err("Wait before asking again"),
          503: err("The email could not be sent (EMAIL_UNAVAILABLE)"),
        },
      },
    },
    "/auth/otp/request": {
      post: {
        tags: ["Auth"],
        summary: "Text a sign-in code (same answer whether or not the number has an account)",
        requestBody: { content: { "application/json": { schema: { type: "object", required: ["phone"], properties: { phone: { type: "string" } } } } } },
        responses: {
          200: ok({ type: "object", properties: { resendInSeconds: { type: "integer" }, expiresInSeconds: { type: "integer" } } }),
          422: err("Validation failed"),
          429: err("Wait before asking again, or hourly limit reached"),
          503: err("SMS is off"),
        },
      },
    },
    "/auth/otp/login": {
      post: {
        tags: ["Auth"],
        summary: "Sign in with the SMS code (5 tries, 5 minutes)",
        requestBody: { content: { "application/json": { schema: { type: "object", required: ["phone", "code"], properties: { phone: { type: "string" }, code: { type: "string", pattern: "^\\d{6}$" }, portal: { type: "string" } } } } } },
        responses: {
          200: ok({ type: "object", properties: { user: { $ref: "#/components/schemas/User" }, accessToken: { type: "string" } } }),
          400: err("Wrong or expired code"),
          403: err("Suspended, or wrong portal"),
          429: err("Too many wrong codes"),
        },
      },
    },
    "/auth/phone/verification": {
      post: {
        tags: ["Auth"],
        summary: "Text a code to confirm your phone number",
        security: [{ bearerAuth: [] }],
        responses: { 200: ok({ type: "object" }), 400: err("No phone number"), 409: err("Already verified"), 429: err("Too many codes") },
      },
    },
    "/auth/phone/verify": {
      post: {
        tags: ["Auth"],
        summary: "Confirm your phone number with the code",
        security: [{ bearerAuth: [] }],
        requestBody: { content: { "application/json": { schema: { type: "object", required: ["code"], properties: { code: { type: "string" } } } } } },
        responses: { 200: ok({ type: "object", properties: { user: { $ref: "#/components/schemas/User" } } }), 400: err("Wrong or expired code") },
      },
    },
    "/auth/email/verification": {
      post: {
        tags: ["Auth"],
        summary: "Send a new email verification link",
        security: [{ bearerAuth: [] }],
        responses: { 200: ok({ type: "null" }), 409: err("Already verified"), 429: err("Too many requests") },
      },
    },
    "/auth/email/code": {
      post: {
        tags: ["Auth"],
        summary: "Email a 6-digit code that confirms your address",
        security: [{ bearerAuth: [] }],
        responses: {
          200: ok({ type: "object", properties: { resendInSeconds: { type: "integer" }, expiresInSeconds: { type: "integer" } } }),
          409: err("Already verified"),
          429: err("Wait before asking again"),
          503: err("The email could not be sent"),
        },
      },
    },
    "/auth/email/code/verify": {
      post: {
        tags: ["Auth"],
        summary: "Confirm your email address with the emailed code",
        security: [{ bearerAuth: [] }],
        requestBody: { content: { "application/json": { schema: { type: "object", required: ["code"], properties: { code: { type: "string" } } } } } },
        responses: { 200: ok({ type: "object", properties: { user: { $ref: "#/components/schemas/User" } } }), 400: err("Wrong or expired code"), 409: err("Already verified") },
      },
    },
    "/auth/email/verify": {
      post: {
        tags: ["Auth"],
        summary: "Confirm an email address with the token from the link",
        requestBody: { content: { "application/json": { schema: { type: "object", required: ["token"], properties: { token: { type: "string" } } } } } },
        responses: { 200: ok({ type: "null" }), 400: err("Invalid or expired link") },
      },
    },
    "/uploads/avatars": {
      post: {
        tags: ["Auth"],
        summary: "Upload a profile photo (JPEG, PNG or WebP, 2 MB; metadata removed)",
        security: [{ bearerAuth: [] }],
        requestBody: { content: { "multipart/form-data": { schema: { type: "object", properties: { image: { type: "string", format: "binary" } } } } } },
        responses: { 201: ok({ type: "object", properties: { url: { type: "string" } } }), 413: err("Too large"), 415: err("Not an image") },
      },
    },
    "/admin/users": {
      get: {
        tags: ["Admin - Users"],
        summary:
          "List customers, partners and riders: only the kinds the caller may view (customers:view, restaurants:view, riders:view); a role filter for another kind is 403",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            in: "query",
            name: "role",
            schema: { $ref: "#/components/schemas/Role" },
          },
          {
            in: "query",
            name: "status",
            schema: { $ref: "#/components/schemas/AccountStatus" },
          },
          {
            in: "query",
            name: "search",
            schema: { type: "string", maxLength: 100 },
          },
          {
            in: "query",
            name: "page",
            schema: { type: "integer", minimum: 1 },
          },
          {
            in: "query",
            name: "limit",
            schema: { type: "integer", minimum: 1, maximum: 100 },
          },
        ],
        responses: {
          200: ok({
            type: "object",
            properties: {
              items: {
                type: "array",
                items: { $ref: "#/components/schemas/User" },
              },
              pagination: { $ref: "#/components/schemas/Pagination" },
            },
          }),
          401: err("Unauthenticated"),
          403: err("Not an admin"),
        },
      },
    },
    "/admin/users/{id}/status": {
      patch: {
        tags: ["Admin - Users"],
        summary:
          "Change an account's status. active/inactive need <kind>:status, suspended/blocked accounts:suspend (plus <kind>:view); kind = customers, restaurants or riders. Any non-active status ends every session (riders go offline). The current status is a no-op. Audited with changes and reason",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            in: "path",
            name: "id",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AccountStatusRequest" },
            },
          },
        },
        responses: {
          200: ok({
            type: "object",
            properties: {
              user: { $ref: "#/components/schemas/User" },
            },
          }),
          400: err("Cannot suspend own account, or an admin account"),
          401: err("Unauthenticated"),
          403: err("No permission for this kind of account or status"),
          404: err("User not found"),
          409: err("Rider is carrying an order"),
          422: err("Validation failed"),
        },
      },
    },
    "/admin/users/{id}": {
      get: {
        tags: ["Admin - Users"],
        summary:
          "One customer, partner or rider: account, saved addresses, order figures and owned restaurant (<kind>:view)",
        security: [{ bearerAuth: [] }],
        parameters: [adminUserParams[0]],
        responses: {
          200: ok({
            type: "object",
            properties: {
              user: { $ref: "#/components/schemas/User" },
              addresses: {
                type: "array",
                items: { $ref: "#/components/schemas/DeliveryAddress" },
              },
              stats: {
                type: "object",
                properties: {
                  orders: { type: "integer" },
                  delivered: { type: "integer" },
                  cancelled: {
                    type: "integer",
                    description: "Cancelled or rejected",
                  },
                  spentPaise: {
                    type: "integer",
                    description: "Total of delivered orders",
                  },
                  lastOrderAt: {
                    type: "string",
                    format: "date-time",
                    nullable: true,
                  },
                },
              },
              restaurant: {
                type: "object",
                nullable: true,
                description: "The restaurant a partner owns; null for others",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  slug: { type: "string" },
                  status: { type: "string" },
                },
              },
            },
          }),
          401: err("Unauthenticated"),
          403: err("Not an admin"),
          404: err("User not found (or an admin account)"),
        },
      },
      patch: {
        tags: ["Admin - Users"],
        summary:
          "Edit a customer, partner or rider's name, date of birth, gender or photo (<kind>:view and <kind>:edit). Email and phone are changed only by the person (dropped if sent). Audited with the changes",
        security: [{ bearerAuth: [] }],
        parameters: [adminUserParams[0]],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string", minLength: 2, maxLength: 80 },
                  birthDate: {
                    type: "string",
                    format: "date",
                    nullable: true,
                    description: "YYYY-MM-DD (age 13-120); null clears it",
                  },
                  gender: {
                    type: "string",
                    nullable: true,
                    enum: ["female", "male", "other", "prefer_not_to_say", null],
                    description: "null clears it",
                  },
                  avatarUrl: {
                    type: "string",
                    nullable: true,
                    description: "An uploaded image URL (as on the own profile); null removes it",
                  },
                },
              },
            },
          },
        },
        responses: {
          200: ok({
            type: "object",
            properties: { user: { $ref: "#/components/schemas/User" } },
          }),
          401: err("Unauthenticated"),
          403: err("Not an admin"),
          404: err("User not found"),
          409: err("Email or phone number already used by another account"),
          422: err("Validation failed"),
        },
      },
    },
    "/admin/users/{id}/addresses": {
      post: {
        tags: ["Admin - Users"],
        summary: "Save an address for a customer, as POST /addresses (customers:edit)",
        security: [{ bearerAuth: [] }],
        parameters: [adminUserParams[0]],
        requestBody: adminAddressBody,
        responses: {
          201: adminAddressResponse,
          400: err("Only customers have saved addresses"),
          404: err("User not found"),
          409: err("Address limit reached"),
          422: err("Validation failed"),
        },
      },
    },
    "/admin/users/{id}/addresses/{addressId}": {
      patch: {
        tags: ["Admin - Users"],
        summary: "Update a customer's address, as PATCH /addresses/{id} (customers:edit)",
        security: [{ bearerAuth: [] }],
        parameters: adminUserParams,
        requestBody: adminAddressBody,
        responses: {
          200: adminAddressResponse,
          400: err("Only customers have saved addresses"),
          404: err("User or address not found"),
          422: err("Validation failed"),
        },
      },
      delete: {
        tags: ["Admin - Users"],
        summary:
          "Delete a customer's address; deleting the default promotes another (customers:edit)",
        security: [{ bearerAuth: [] }],
        parameters: adminUserParams,
        responses: {
          200: ok({ type: "object", nullable: true }),
          400: err("Only customers have saved addresses"),
          404: err("User or address not found"),
        },
      },
    },
    "/admin/users/{id}/addresses/{addressId}/default": {
      patch: {
        tags: ["Admin - Users"],
        summary: "Make an address the customer's default (customers:edit)",
        security: [{ bearerAuth: [] }],
        parameters: adminUserParams,
        responses: {
          200: adminAddressResponse,
          400: err("Only customers have saved addresses"),
          404: err("User or address not found"),
        },
      },
    },
  },
};
