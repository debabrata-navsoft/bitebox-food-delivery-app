import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { ApiResponse, Paginated } from '../../models/api.models';
import { VehicleType } from '../../models/checkout.models';
import {
  RiderAddress,
  RiderProfile,
  RiderVerificationStatus,
} from '../../models/order-management.models';
import { Gender, User, UserStatus } from '../../models/user.models';
import { toParams } from '../../../shared/utils/http-params';
import { Faceted, ListQuery } from '../../../shared/list/filtered-list';
import { KycState } from './admin-restaurant-accounts.service';
import { refreshesReviews } from './review-changes';

export interface EmergencyContact {
  name: string;
  phone: string;
  relation?: string | null;
}

export interface RiderAccountRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  status: UserStatus;
  statusReason: string | null;
  createdAt: string;
  verificationStatus: RiderVerificationStatus;
  isOnline: boolean;
  /** Online and carrying an order. */
  busy: boolean;
  vehicleType: VehicleType | null;
  vehicleNumber: string | null;
  zone: string | null;
  completedDeliveries: number;
  rating: { average: number; count: number };
  kycStatus: KycState;
}

/** GET /admin/delivery-partner-accounts/:id */
export interface RiderAccount {
  user: User;
  rider: RiderProfile & { emergencyContact: EmergencyContact | null; zone: string | null };
  stats: {
    deliveries: number;
    cancelled: number;
    earningsPaise: number;
    lastDeliveryAt: string | null;
    rating: { average: number; count: number };
  };
  kyc: { status: KycState; missing: string[] };
}

/** PATCH /admin/delivery-partner-accounts/:id (email and phone are the rider's own to change). */
export interface RiderAccountPatch {
  name?: string;
  gender?: Gender | null;
  birthDate?: string | null;
  avatarUrl?: string | null;
  address?: RiderAddress;
  emergencyContact?: EmergencyContact | null;
  vehicleType?: VehicleType;
  vehicleNumber?: string;
  zone?: string | null;
}

export interface AvailabilityChange {
  isOnline: boolean;
  at: string;
  source: 'rider' | 'admin' | 'system';
  reason: string | null;
}

/** Account management → Delivery partner accounts (the API checks riders:* permissions). */
@Injectable({ providedIn: 'root' })
export class AdminRiderAccountsService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.baseUrl}/admin/delivery-partner-accounts`;

  /** Filters: search, verification, availability, kyc, accountStatus, zone, vehicleType (several values each), joinedFrom/To, sort; `facets: 1` adds counts. */
  list = (query: ListQuery): Observable<Faceted<RiderAccountRow>> =>
    this.http
      .get<ApiResponse<Faceted<RiderAccountRow>>>(this.url, { params: toParams(query) })
      .pipe(map((r) => r.data));
  get = (id: string): Observable<RiderAccount> =>
    this.http.get<ApiResponse<RiderAccount>>(`${this.url}/${id}`).pipe(map((r) => r.data));
  update = (id: string, patch: RiderAccountPatch) => this.send(id, '', patch);
  /** A reason is required to reject or ask for documents. */
  setVerification = (id: string, status: RiderVerificationStatus, reason?: string) =>
    this.send(id, '/verification', { status, reason: reason || undefined }).pipe(
      refreshesReviews(),
    );
  /** Takes the rider offline now (only the rider can go online). */
  takeOffline = (id: string, reason: string) =>
    this.send(id, '/availability', { isOnline: false, reason });
  availability = (
    id: string,
    page: number,
    limit: number,
  ): Observable<Paginated<AvailabilityChange>> =>
    this.http
      .get<ApiResponse<Paginated<AvailabilityChange>>>(`${this.url}/${id}/availability`, {
        params: toParams({ page, limit }),
      })
      .pipe(map((r) => r.data));

  private send(id: string, path: string, body: object): Observable<RiderAccount> {
    return this.http
      .patch<ApiResponse<RiderAccount>>(`${this.url}/${id}${path}`, body)
      .pipe(map((r) => r.data));
  }
}
