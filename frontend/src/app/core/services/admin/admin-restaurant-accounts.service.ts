import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { ApiResponse } from '../../models/api.models';
import { Restaurant, RestaurantStatus, RestaurantUpdate } from '../../models/catalog.models';
import { User } from '../../models/user.models';
import { toParams } from '../../../shared/utils/http-params';
import { Faceted, ListQuery } from '../../../shared/list/filtered-list';
import { MyRestaurantService, MyRestaurantState } from '../my-restaurant.service';
import { refreshesReviews } from './review-changes';

export type KycState = 'verified' | 'pending' | 'incomplete' | 'rejected';
type Rating = { average: number; count: number };

export interface RestaurantAccountRow {
  id: string;
  name: string;
  slug: string;
  imageUrl?: string | null;
  city: string;
  status: RestaurantStatus;
  statusReason?: string | null;
  isAcceptingOrders: boolean;
  createdAt: string;
  owner: Pick<User, 'id' | 'name' | 'email' | 'phone' | 'status' | 'avatarUrl'> | null;
  stats: { orders: number; rating: Rating };
  commissionPercent: number;
  kycStatus: KycState;
}

/** GET /admin/restaurant-accounts/:id */
export interface RestaurantAccount {
  restaurant: Restaurant;
  owner: User | null;
  stats: {
    orders: number;
    delivered: number;
    cancelled: number;
    grossPaise: number;
    lastOrderAt: string | null;
    rating: Rating;
  };
  commission: { percent: number; source: 'default' | 'restaurant' };
  kyc: { status: KycState; missing: string[] };
}

/** Account management → Restaurant accounts (the API checks restaurants:* permissions). */
@Injectable({ providedIn: 'root' })
export class AdminRestaurantAccountsService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.baseUrl}/admin/restaurant-accounts`;

  /** Filters: search, status, accountStatus, kyc, city (several values each), joinedFrom/To, sort; `facets: 1` adds counts. */
  list = (query: ListQuery): Observable<Faceted<RestaurantAccountRow>> =>
    this.http
      .get<ApiResponse<Faceted<RestaurantAccountRow>>>(this.url, { params: toParams(query) })
      .pipe(map((r) => r.data));
  get = (id: string): Observable<RestaurantAccount> =>
    this.http.get<ApiResponse<RestaurantAccount>>(`${this.url}/${id}`).pipe(map((r) => r.data));
  update = (id: string, input: RestaurantUpdate) => this.send('PATCH', id, '', input);
  /** A reason is required to reject, ask for documents or suspend. */
  setStatus = (id: string, status: RestaurantStatus, reason?: string) =>
    this.send('PATCH', id, '/status', { status, reason: reason || undefined }).pipe(
      refreshesReviews(),
    );
  /** Temporarily close (with a reason) or reopen the restaurant for new orders. */
  setAccepting = (id: string, isAcceptingOrders: boolean, reason?: string) =>
    this.send('PATCH', id, '/accepting-orders', { isAcceptingOrders, reason: reason || undefined });

  private send(method: 'PATCH', id: string, path: string, body: object): Observable<Restaurant> {
    return this.http
      .request<ApiResponse<{ restaurant: Restaurant }>>(method, `${this.url}/${id}${path}`, {
        body,
      })
      .pipe(map((r) => r.data.restaurant));
  }
}

/**
 * The partner's restaurant forms (details, legal) save through MyRestaurantService. Provided on
 * the admin edit page, this version loads and saves the restaurant in the URL through the admin API.
 */
@Injectable()
export class AdminRestaurantStore extends MyRestaurantService {
  private readonly accounts = inject(AdminRestaurantAccountsService);
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';

  override get(): Observable<MyRestaurantState> {
    return this.accounts.get(this.id).pipe(map(({ restaurant }) => ({ restaurant, stats: null })));
  }

  override update(input: RestaurantUpdate): Observable<Restaurant> {
    return this.accounts.update(this.id, input);
  }
}
