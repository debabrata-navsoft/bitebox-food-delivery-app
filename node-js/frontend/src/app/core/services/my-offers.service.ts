import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse, Paginated } from '../../shared/models/api.models';
import {
  AdminCoupon,
  AdminCouponInput,
  CouponAnalytics,
  CouponQuery,
} from '../../shared/models/checkout.models';
import { toParams } from './http-params';

/** A partner's offer: the admin fields minus other restaurants, plus "save as a draft". */
export type OfferInput = Omit<AdminCouponInput, 'restaurants'> & { draft?: boolean };

/** A restaurant partner's own offers (/my/restaurant/offers). */
@Injectable({ providedIn: 'root' })
export class MyOffersService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.baseUrl}/my/restaurant/offers`;

  private one(request: Observable<ApiResponse<{ coupon: AdminCoupon }>>): Observable<AdminCoupon> {
    return request.pipe(map((r) => r.data.coupon));
  }

  list(query: Omit<CouponQuery, 'owner'>): Observable<Paginated<AdminCoupon>> {
    return this.http
      .get<ApiResponse<Paginated<AdminCoupon>>>(this.url, { params: toParams(query) })
      .pipe(map((r) => r.data));
  }

  analytics(): Observable<CouponAnalytics> {
    return this.http.get<ApiResponse<CouponAnalytics>>(`${this.url}/analytics`).pipe(map((r) => r.data));
  }

  create(input: OfferInput): Observable<AdminCoupon> {
    return this.one(this.http.post<ApiResponse<{ coupon: AdminCoupon }>>(this.url, input));
  }

  update(id: string, input: OfferInput): Observable<AdminCoupon> {
    return this.one(this.http.patch<ApiResponse<{ coupon: AdminCoupon }>>(`${this.url}/${id}`, input));
  }

  setActive(id: string, isActive: boolean): Observable<AdminCoupon> {
    return this.one(
      this.http.patch<ApiResponse<{ coupon: AdminCoupon }>>(`${this.url}/${id}/status`, { isActive }),
    );
  }

  remove(id: string): Observable<void> {
    return this.http.delete<ApiResponse<null>>(`${this.url}/${id}`).pipe(map(() => undefined));
  }
}
