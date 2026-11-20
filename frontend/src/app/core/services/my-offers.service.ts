import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { AdminCouponInput } from '../models/checkout.models';
import { CouponApi } from './coupon-api';

/** A partner's offer: the admin fields minus other restaurants, plus "save as a draft". */
export type OfferInput = Omit<AdminCouponInput, 'restaurants'> & { draft?: boolean };

/** A restaurant partner's own offers (/my/restaurant/offers). */
@Injectable({ providedIn: 'root' })
export class MyOffersService extends CouponApi<OfferInput> {
  protected readonly url = `${environment.baseUrl}/my/restaurant/offers`;
}
