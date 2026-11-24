import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { ApiResponse, Paginated } from '../../models/api.models';
import { LoginEntry } from '../../models/admin-roles.models';
import { toParams } from '../../../shared/utils/http-params';
import { Faceted, ListQuery } from '../../../shared/list/filtered-list';
import { AddressInput, DeliveryAddress } from '../../models/checkout.models';
import { Gender, Role, User, UserStatus } from '../../models/user.models';

/** GET /admin/users/:id: the account with its addresses, order totals and restaurant. */
export interface AdminUserDetail {
  user: User;
  addresses: DeliveryAddress[];
  stats: {
    orders: number;
    delivered: number;
    cancelled: number;
    spentPaise: number;
    lastOrderAt: string | null;
  };
  /** Restaurant partners: the restaurant they own. */
  restaurant: { id: string; name: string; slug: string; status: string } | null;
}

/** A customer in the Account management list. */
export interface CustomerRow extends User {
  stats: { orders: number; spentPaise: number; lastOrderAt: string | null };
}

/** PATCH /admin/users/:id. Email and phone are changed only by the person themselves. */
export interface UserProfilePatch {
  name?: string;
  gender?: Gender | null;
  avatarUrl?: string | null;
  birthDate?: string | null;
}

@Injectable({ providedIn: 'root' })
export class AdminUsersService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.baseUrl}/admin/users`;
  private readonly customersUrl = `${environment.baseUrl}/admin/customers`;

  /** A reason is required for anything but `active`. */
  setStatus(id: string, status: UserStatus, reason?: string): Observable<User> {
    return this.http
      .patch<ApiResponse<{ user: User }>>(`${this.url}/${id}/status`, { status, reason: reason || undefined })
      .pipe(map((res) => res.data.user));
  }

  get(id: string): Observable<AdminUserDetail> {
    return this.http.get<ApiResponse<AdminUserDetail>>(`${this.url}/${id}`).pipe(map((res) => res.data));
  }

  update(id: string, patch: UserProfilePatch): Observable<User> {
    return this.http
      .patch<ApiResponse<{ user: User }>>(`${this.url}/${id}`, patch)
      .pipe(map((res) => res.data.user));
  }

  // A customer's saved addresses (same bodies as their own /addresses).
  createAddress = (id: string, input: AddressInput) => this.address('POST', `${id}/addresses`, input);
  updateAddress = (id: string, addressId: string, input: Partial<AddressInput>) =>
    this.address('PATCH', `${id}/addresses/${addressId}`, input);
  setDefaultAddress = (id: string, addressId: string) =>
    this.address('PATCH', `${id}/addresses/${addressId}/default`, {});

  private address(method: 'POST' | 'PATCH', path: string, body: object): Observable<DeliveryAddress> {
    return this.http
      .request<ApiResponse<{ address: DeliveryAddress }>>(method, `${this.url}/${path}`, { body })
      .pipe(map((res) => res.data.address));
  }

  removeAddress(id: string, addressId: string): Observable<void> {
    return this.http
      .delete<ApiResponse<null>>(`${this.url}/${id}/addresses/${addressId}`)
      .pipe(map(() => undefined));
  }

  /** The person's sign-ins (newest first). */
  logins(id: string, page = 1, limit = 10): Observable<Paginated<LoginEntry>> {
    return this.http
      .get<ApiResponse<Paginated<LoginEntry>>>(`${this.url}/${id}/logins`, { params: toParams({ page, limit }) })
      .pipe(map((res) => res.data));
  }

  /** Account management: customers with their order totals. */
  /** Filters: search, status, verification (several values each), joinedFrom/To, sort; `facets: 1` adds counts. */
  customers(query: ListQuery): Observable<Faceted<CustomerRow>> {
    return this.http
      .get<ApiResponse<Faceted<CustomerRow>>>(this.customersUrl, { params: toParams(query) })
      .pipe(map((res) => res.data));
  }

  /** Emails the customer the usual password reset link (admins never see or set passwords). */
  sendPasswordReset = (id: string) => this.help(id, 'password-reset');
  /** Emails the customer a new verification link. */
  sendEmailVerification = (id: string) => this.help(id, 'email-verification');

  private help(id: string, action: string): Observable<string> {
    return this.http
      .post<ApiResponse<null>>(`${this.customersUrl}/${id}/${action}`, {})
      .pipe(map((res) => res.message));
  }

  /** Total number of accounts for a role (uses the pagination total). */
  /** How many accounts have this role (the admin dashboard's totals). */
  countByRole(role: Role): Observable<number> {
    return this.http
      .get<ApiResponse<Paginated<User>>>(this.url, { params: toParams({ role, limit: 1 }) })
      .pipe(map((res) => res.data.pagination.total));
  }
}
