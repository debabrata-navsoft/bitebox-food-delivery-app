/** `operator` has no preset: only the permissions the super admin ticks for that person. */
export type StaffAdminRole = 'operations_admin' | 'finance_admin' | 'support_admin' | 'operator';
/** `admin` is the super admin; the staff admin roles each get a slice of the admin panel. */
export type AdminRole = 'admin' | StaffAdminRole;
export type Role = 'customer' | 'restaurant' | 'delivery' | AdminRole;
export type SelfRegisterRole = 'customer' | 'restaurant' | 'delivery';

export const STAFF_ADMIN_ROLES: readonly StaffAdminRole[] = [
  'operations_admin',
  'finance_admin',
  'support_admin',
  'operator',
];
export const ADMIN_ROLES: readonly AdminRole[] = ['admin', ...STAFF_ADMIN_ROLES];
export const isAdminRole = (role: Role | null | undefined): role is AdminRole =>
  !!role && (ADMIN_ROLES as readonly Role[]).includes(role);

/** Mirrors backend config/permissions.js. The API enforces them; the app only shapes menus. */
export type Permission =
  | 'admins:manage'
  | 'customers:view'
  | 'customers:edit'
  | 'customers:status'
  | 'restaurants:view'
  | 'restaurants:edit'
  | 'restaurants:status'
  | 'restaurants:approve'
  | 'restaurants:kyc'
  | 'riders:view'
  | 'riders:edit'
  | 'riders:status'
  | 'riders:approve'
  | 'riders:kyc'
  | 'accounts:suspend'
  | 'audit:view'
  | 'catalog:manage'
  | 'operations:view'
  | 'orders:view'
  | 'orders:manage'
  | 'restaurants:manage'
  | 'riders:manage'
  | 'finance:view'
  | 'refunds:manage'
  | 'payouts:manage'
  | 'support:manage'
  | 'reviews:moderate'
  | 'rewards:manage'
  | 'rewards:view'
  | 'promotions:send';
/** Any status but `active` signs the person out and keeps them out. */
export type UserStatus = 'active' | 'inactive' | 'suspended' | 'blocked';
export const USER_STATUS_META: Record<UserStatus, { label: string; tone: string; hint: string }> = {
  active: { label: 'Active', tone: 'tone-good', hint: 'Can sign in and use BiteBox.' },
  inactive: { label: 'Inactive', tone: 'tone-muted', hint: 'Switched off, e.g. closed on request.' },
  suspended: { label: 'Suspended', tone: 'tone-warn', hint: 'Temporarily locked out.' },
  blocked: { label: 'Blocked', tone: 'tone-bad', hint: 'Permanently banned.' },
};

export type Gender = 'female' | 'male' | 'other' | 'prefer_not_to_say';
export const GENDER_LABEL: Record<Gender, string> = {
  female: 'Female',
  male: 'Male',
  other: 'Other',
  prefer_not_to_say: 'Prefer not to say',
};

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: Role;
  status: UserStatus;
  /** Admin roles only: what they can do (the role's preset, or their own list). */
  permissions?: Permission[];
  /** Admin roles only: their own list; null/absent = the role's preset. */
  customPermissions?: Permission[] | null;
  /** Why the account is not active (admins see it). */
  statusReason?: string;
  statusChangedAt?: string;
  gender?: Gender;
  lastLoginAt?: string;
  /** Set once the person confirmed the address (link) or the number (SMS code). */
  emailVerified?: boolean;
  phoneVerified?: boolean;
  avatarUrl?: string;
  /** "1995-11-05" (customers who saved it). */
  birthDate?: string;
  referralCode?: string;
  createdAt: string;
  updatedAt: string;
}

/** POST /auth/otp/request and /auth/phone/verification. */
export interface CodeSent {
  message: string;
  resendInSeconds: number;
  expiresInSeconds: number;
  /** Sign-up only: false when the API creates accounts without a code (no code was sent). */
  codeRequired?: boolean;
}

export interface AuthSession {
  user: User;
  accessToken: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  portal?: Role;
}

export interface RegisterRequest {
  name: string;
  email: string;
  phone?: string;
  password: string;
  role: SelfRegisterRole;
  /** A friend's referral code (customers only). */
  referralCode?: string;
  /** The SMS code from POST /auth/register/code. */
  code?: string;
}

export interface UpdateProfileRequest {
  name?: string;
  phone?: string;
  /** null removes the photo. */
  avatarUrl?: string | null;
  /** null clears it. */
  gender?: Gender | null;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export const ROLE_META: Record<
  Role,
  { label: string; home: string; login: string; register?: string }
> = {
  customer: { label: 'Customer', home: '/', login: '/login', register: '/register' },
  admin: { label: 'Super admin', home: '/admin', login: '/login' },
  operations_admin: { label: 'Operations admin', home: '/admin/operations', login: '/login' },
  finance_admin: { label: 'Finance admin', home: '/admin/finance', login: '/login' },
  support_admin: { label: 'Support admin', home: '/admin/support', login: '/login' },
  operator: { label: 'Operator', home: '/admin/profile', login: '/login' },
  restaurant: {
    label: 'Restaurant partner',
    home: '/restaurant',
    login: '/login',
    register: '/restaurant/register',
  },
  delivery: {
    label: 'Delivery partner',
    home: '/delivery',
    login: '/login',
    register: '/delivery/register',
  },
};

/** The permission family of each member role (customers:edit, riders:status...). */
export const MEMBER_KIND = { customer: 'customers', restaurant: 'restaurants', delivery: 'riders' } as const;

export const initialsOf = (name = ''): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
