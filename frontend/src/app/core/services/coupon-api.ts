import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { Faceted, ListQuery } from '../../shared/list/filtered-list';
import { ApiResponse } from '../models/api.models';
import { AdminCoupon, CouponAnalytics, CouponQuery } from '../models/checkout.models';
import { toParams } from '../../shared/utils/http-params';

export type One = ApiResponse<{ coupon: AdminCoupon }>;

/**
 * The calls admins (/admin/coupons) and restaurant partners (/my/restaurant/offers) share:
 * list, totals, create, edit, pause or resume, and delete.
 */
export abstract class CouponApi<TInput> {
  protected readonly http = inject(HttpClient);
  protected abstract readonly url: string;

  protected one(request: Observable<One>): Observable<AdminCoupon> {
    return request.pipe(map((r) => r.data.coupon));
  }

  /** Filters take one value or several (the Filters panel); `facets: 1` adds its counts. */
  list(query: CouponQuery | ListQuery): Observable<Faceted<AdminCoupon>> {
    return this.http
      .get<ApiResponse<Faceted<AdminCoupon>>>(this.url, { params: toParams(query) })
      .pipe(map((r) => r.data));
  }

  analytics(): Observable<CouponAnalytics> {
    return this.http.get<ApiResponse<CouponAnalytics>>(`${this.url}/analytics`).pipe(map((r) => r.data));
  }

  create(input: TInput): Observable<AdminCoupon> {
    return this.one(this.http.post<One>(this.url, input));
  }

  update(id: string, input: TInput): Observable<AdminCoupon> {
    return this.one(this.http.patch<One>(`${this.url}/${id}`, input));
  }

  setActive(id: string, isActive: boolean): Observable<AdminCoupon> {
    return this.one(this.http.patch<One>(`${this.url}/${id}/status`, { isActive }));
  }

  remove(id: string): Observable<void> {
    return this.http.delete<ApiResponse<null>>(`${this.url}/${id}`).pipe(map(() => undefined));
  }
}
