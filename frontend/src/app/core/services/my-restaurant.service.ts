import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../../shared/models/api.models';
import {
  FoodItem,
  FoodItemInput,
  MenuStats,
  Restaurant,
  RestaurantInput,
  RestaurantUpdate,
} from '../../shared/models/catalog.models';
import { Faceted, ListQuery } from '../../shared/list/filtered-list';
import { toParams } from './http-params';

export interface MyRestaurantState {
  restaurant: Restaurant | null;
  stats: MenuStats | null;
}

/** The dashboard's order figures (GET /my/restaurant/stats). Money in paise. */
export interface RestaurantStats {
  totalOrders: number;
  todayOrders: number;
  pendingOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  salesPaise: number;
  averageOrderPaise: number;
  rating: { average: number; count: number };
}

@Injectable({ providedIn: 'root' })
export class MyRestaurantService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.baseUrl}/my/restaurant`;

  get(): Observable<MyRestaurantState> {
    return this.http.get<ApiResponse<MyRestaurantState>>(this.url).pipe(map((res) => res.data));
  }

  stats(): Observable<RestaurantStats> {
    return this.http
      .get<ApiResponse<RestaurantStats>>(`${this.url}/stats`)
      .pipe(map((res) => res.data));
  }

  create(input: RestaurantInput): Observable<Restaurant> {
    return this.http
      .post<ApiResponse<{ restaurant: Restaurant }>>(this.url, input)
      .pipe(map((res) => res.data.restaurant));
  }

  update(input: RestaurantUpdate): Observable<Restaurant> {
    return this.http
      .patch<ApiResponse<{ restaurant: Restaurant }>>(this.url, input)
      .pipe(map((res) => res.data.restaurant));
  }

  /** After "documents needed" or a rejection: back to the review queue. */
  resubmit(): Observable<Restaurant> {
    return this.http
      .post<ApiResponse<{ restaurant: Restaurant }>>(`${this.url}/resubmit`, {})
      .pipe(map((res) => res.data.restaurant));
  }

  setAcceptingOrders(isAcceptingOrders: boolean): Observable<Restaurant> {
    return this.http
      .patch<ApiResponse<{ restaurant: Restaurant }>>(`${this.url}/accepting-orders`, {
        isAcceptingOrders,
      })
      .pipe(map((res) => res.data.restaurant));
  }

  /**
   * The menu: search, plus category, type (veg, non_veg) and availability (one value or several,
   * the Filters panel); `facets: 1` adds its counts.
   */
  foods(query: ListQuery = {}): Observable<Faceted<FoodItem>> {
    return this.http
      .get<ApiResponse<Faceted<FoodItem>>>(`${this.url}/foods`, { params: toParams(query) })
      .pipe(map((res) => res.data));
  }

  createFood(input: FoodItemInput): Observable<FoodItem> {
    return this.http
      .post<ApiResponse<{ item: FoodItem }>>(`${this.url}/foods`, input)
      .pipe(map((res) => res.data.item));
  }

  updateFood(id: string, input: Partial<FoodItemInput>): Observable<FoodItem> {
    return this.http
      .patch<ApiResponse<{ item: FoodItem }>>(`${this.url}/foods/${id}`, input)
      .pipe(map((res) => res.data.item));
  }

  setFoodAvailability(id: string, isAvailable: boolean): Observable<FoodItem> {
    return this.http
      .patch<ApiResponse<{ item: FoodItem }>>(`${this.url}/foods/${id}/availability`, {
        isAvailable,
      })
      .pipe(map((res) => res.data.item));
  }

  deleteFood(id: string): Observable<void> {
    return this.http
      .delete<ApiResponse<null>>(`${this.url}/foods/${id}`)
      .pipe(map(() => undefined));
  }
}
