import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { publicRequest } from '../interceptors/auth.interceptor';
import { ApiResponse } from '../models/api.models';

type Range = ApiResponse<{ maxDeliveryDistanceKm: number }>;

/** How far restaurants deliver (the admin's setting), drawn as a circle on location maps. */
@Injectable({ providedIn: 'root' })
export class DeliveryRangeService {
  /** Km, or null until loaded (or when unavailable: maps then draw no circle). */
  readonly km = toSignal(
    inject(HttpClient)
      .get<Range>(`${environment.baseUrl}/delivery-range`, { context: publicRequest() })
      .pipe(
        map((r) => r.data.maxDeliveryDistanceKm),
        catchError(() => of(null)),
      ),
    { initialValue: null },
  );
}
