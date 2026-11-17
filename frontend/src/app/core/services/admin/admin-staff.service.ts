import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  AuditEntry,
  LoginEntry,
  PermissionCatalogue,
  PlatformSummary,
  StaffAdminInput,
  StaffAdminUpdate,
  StaffQuery,
} from '../../../shared/models/admin-roles.models';
import { ApiResponse, Paginated } from '../../../shared/models/api.models';
import { User, UserStatus } from '../../../shared/models/user.models';
import { toParams } from '../http-params';

/** Super admin: operations, finance and support admin accounts, and the audit log. */
@Injectable({ providedIn: 'root' })
export class AdminStaffService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.baseUrl}/admin/admins`;

  list(query: StaffQuery): Observable<Paginated<User>> {
    return this.http
      .get<ApiResponse<Paginated<User>>>(this.url, { params: toParams(query) })
      .pipe(map((r) => r.data));
  }

  create(input: StaffAdminInput): Observable<User> {
    return this.http
      .post<ApiResponse<{ user: User }>>(this.url, input)
      .pipe(map((r) => r.data.user));
  }

  update(id: string, input: StaffAdminUpdate): Observable<User> {
    return this.http
      .patch<ApiResponse<{ user: User }>>(`${this.url}/${id}`, input)
      .pipe(map((r) => r.data.user));
  }

  /** What a super admin can grant, grouped, and the ready-made permission sets. */
  permissionCatalogue(): Observable<PermissionCatalogue> {
    return this.http
      .get<ApiResponse<PermissionCatalogue>>(`${this.url}/permissions`)
      .pipe(map((r) => r.data));
  }

  /** Sign-ins of a staff admin, newest first (Django API only: the Node API answers 404). */
  logins(id: string, page = 1, limit = 20): Observable<Paginated<LoginEntry>> {
    return this.http
      .get<ApiResponse<Paginated<LoginEntry>>>(`${this.url}/${encodeURIComponent(id)}/logins`, {
        params: toParams({ page, limit }),
      })
      .pipe(map((r) => r.data));
  }

  /** The admin home page's platform figures (Django API only: the Node API answers 404). */
  summary(): Observable<PlatformSummary> {
    return this.http
      .get<ApiResponse<PlatformSummary>>(`${environment.baseUrl}/admin/dashboard`)
      .pipe(map((r) => r.data));
  }

  /** A reason is required for anything but `active`. */
  setStatus(id: string, status: UserStatus, reason?: string): Observable<User> {
    return this.http
      .patch<ApiResponse<{ user: User }>>(`${this.url}/${id}/status`, { status, reason: reason || undefined })
      .pipe(map((r) => r.data.user));
  }

  auditLog(query: {
    action?: string;
    role?: string;
    search?: string;
    accountType?: string;
    /** Entries about one account or record. */
    resourceId?: string;
    /** ISO timestamps: entries at or after / at or before. */
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }): Observable<Paginated<AuditEntry>> {
    return this.http
      .get<ApiResponse<Paginated<AuditEntry>>>(`${environment.baseUrl}/admin/audit-logs`, {
        params: toParams(query),
      })
      .pipe(map((r) => r.data));
  }
}
