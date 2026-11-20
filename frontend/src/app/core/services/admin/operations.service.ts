import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  DeliveryPerformance,
  DispatchSettings,
  DistanceSettings,
  Monitoring,
  OperationsDashboard,
  RestaurantAvailability,
} from '../../models/admin-roles.models';
import { ApiResponse } from '../../models/api.models';
import { toParams } from '../../../shared/utils/http-params';

@Injectable({ providedIn: 'root' })
export class OperationsService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.baseUrl}/admin/operations`;

  private get<T>(path: string, query: object = {}): Observable<T> {
    return this.http
      .get<ApiResponse<T>>(`${this.url}/${path}`, { params: toParams(query) })
      .pipe(map((r) => r.data));
  }

  dashboard = (days: number) => this.get<OperationsDashboard>('dashboard', { days });
  monitoring = () => this.get<Monitoring>('monitoring');
  restaurants = () =>
    this.get<{ items: RestaurantAvailability[] }>('restaurants').pipe(map((d) => d.items));
  performance = (days: number) => this.get<DeliveryPerformance>('performance', { days });

  /** Dispatch rules (riders:manage). */
  private readonly dispatchUrl = `${environment.baseUrl}/admin/dispatch/settings`;
  dispatchSettings = () =>
    this.http
      .get<ApiResponse<{ settings: DispatchSettings }>>(this.dispatchUrl)
      .pipe(map((r) => r.data.settings));
  saveDispatchSettings = (changes: Partial<DistanceSettings>) =>
    this.http
      .put<ApiResponse<{ settings: DispatchSettings }>>(this.dispatchUrl, changes)
      .pipe(map((r) => r.data.settings));
}
