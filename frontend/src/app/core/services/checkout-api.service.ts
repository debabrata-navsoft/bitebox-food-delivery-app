import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { FileDownloadService } from './file-download.service';
import { environment } from '../../../environments/environment';
import { ApiResponse, Paginated } from '../models/api.models';
import {
  AddressInput,
  AdminCoupon,
  AdminCouponInput,
  OfferKind,
  PaymentChannel,
  CouponOffer,
  DeliveryAddress,
  Order,
} from '../models/checkout.models';
import { CheckoutSession, PaymentMethod } from '../models/payment.models';
import { toParams } from '../../shared/utils/http-params';
import { CouponApi, One } from './coupon-api';

@Injectable({ providedIn: 'root' })
export class AddressService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.baseUrl}/addresses`;

  list(): Observable<DeliveryAddress[]> {
    return this.http
      .get<ApiResponse<{ addresses: DeliveryAddress[] }>>(this.url)
      .pipe(map((r) => r.data.addresses));
  }

  create(input: AddressInput): Observable<DeliveryAddress> {
    return this.http
      .post<ApiResponse<{ address: DeliveryAddress }>>(this.url, input)
      .pipe(map((r) => r.data.address));
  }

  update(id: string, input: Partial<AddressInput>): Observable<DeliveryAddress> {
    return this.http
      .patch<ApiResponse<{ address: DeliveryAddress }>>(`${this.url}/${id}`, input)
      .pipe(map((r) => r.data.address));
  }

  setDefault(id: string): Observable<DeliveryAddress> {
    return this.http
      .patch<ApiResponse<{ address: DeliveryAddress }>>(`${this.url}/${id}/default`, {})
      .pipe(map((r) => r.data.address));
  }

  remove(id: string): Observable<void> {
    return this.http.delete<ApiResponse<null>>(`${this.url}/${id}`).pipe(map(() => undefined));
  }
}

export interface PlaceOrderRequest {
  addressId: string;
  paymentMethod: PaymentMethod;
  /** Online orders: UPI, card, net banking or wallet (prices that channel's payment offer). */
  paymentChannel?: PaymentChannel;
  note?: string;
  expectedTotalPaise: number;
}

@Injectable({ providedIn: 'root' })
export class OrderService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.baseUrl;
  private readonly files = inject(FileDownloadService);

  /** The PDF invoice of a delivered order. */
  invoice(orderId: string): Promise<void> {
    return this.files.save(
      `${this.api}/orders/${encodeURIComponent(orderId)}/invoice`,
      'BiteBox-invoice.pdf',
    );
  }

  place(
    request: PlaceOrderRequest,
    idempotencyKey: string,
  ): Observable<{ order: Order; checkout: CheckoutSession | null }> {
    return this.http
      .post<ApiResponse<{ order: Order; checkout?: CheckoutSession | null }>>(
        `${this.api}/orders`,
        request,
        {
          headers: new HttpHeaders({ 'Idempotency-Key': idempotencyKey }),
        },
      )
      .pipe(map((r) => ({ order: r.data.order, checkout: r.data.checkout ?? null })));
  }

  mine(page = 1, limit = 10): Observable<Paginated<Order>> {
    return this.http
      .get<ApiResponse<Paginated<Order>>>(`${this.api}/orders`, {
        params: toParams({ page, limit }),
      })
      .pipe(map((r) => r.data));
  }

  get(id: string): Observable<Order> {
    return this.http
      .get<ApiResponse<{ order: Order }>>(`${this.api}/orders/${encodeURIComponent(id)}`)
      .pipe(map((r) => r.data.order));
  }

  cancel(id: string, reason?: string): Observable<Order> {
    return this.http
      .post<ApiResponse<{ order: Order }>>(`${this.api}/orders/${encodeURIComponent(id)}/cancel`, {
        reason,
      })
      .pipe(map((r) => r.data.order));
  }

  availableCoupons(restaurantId?: string): Observable<CouponOffer[]> {
    return this.http
      .get<ApiResponse<{ coupons: CouponOffer[] }>>(`${this.api}/coupons/available`, {
        params: toParams({ restaurantId }),
      })
      .pipe(map((r) => r.data.coupons));
  }
  /** The Offers page: every offer this customer can use, best first, optionally of one kind. */
  offers(kind?: OfferKind): Observable<CouponOffer[]> {
    return this.http
      .get<ApiResponse<{ offers: CouponOffer[] }>>(`${this.api}/coupons/offers`, {
        params: toParams({ type: kind }),
      })
      .pipe(map((r) => r.data.offers));
  }
}

@Injectable({ providedIn: 'root' })
export class AdminCouponService extends CouponApi<AdminCouponInput> {
  protected readonly url = `${environment.baseUrl}/admin/coupons`;
  private readonly offers = `${environment.baseUrl}/admin/restaurant-offers`;

  duplicate(id: string): Observable<AdminCoupon> {
    return this.one(this.http.post<One>(`${this.url}/${id}/duplicate`, {}));
  }

  /** Restaurant offers waiting for review. */
  pending(query: { page?: number; limit?: number }): Observable<Paginated<AdminCoupon>> {
    return this.http
      .get<ApiResponse<Paginated<AdminCoupon>>>(`${this.offers}/pending`, {
        params: toParams(query),
      })
      .pipe(map((r) => r.data));
  }

  approve(id: string): Observable<AdminCoupon> {
    return this.one(this.http.post<One>(`${this.offers}/${id}/approve`, {}));
  }

  reject(id: string, reason: string): Observable<AdminCoupon> {
    return this.one(this.http.post<One>(`${this.offers}/${id}/reject`, { reason }));
  }
}
