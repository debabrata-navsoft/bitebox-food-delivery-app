import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { NearbyRiders, RestaurantOrder } from '../../../../core/models/order-management.models';
import { MyRestaurantService } from '../../../../core/services/my-restaurant.service';
import { TrackingMap } from '../../../../shared/components/tracking-map/tracking-map';
import { TrackingMapStub } from '../../../../shared/components/tracking-map/tracking-map.stub';
import { BB_DIALOG_DATA, BbDialogRef } from '../../../../shared/dialog/bb-dialog';
import { NearbyRidersDialog } from './nearby-riders-dialog';

const order = {
  id: 'o1',
  orderNumber: 'BB-1',
  deliveryAddress: { recipientName: 'Asha Rao', area: 'Shivaji Nagar', city: 'Pune' },
} as unknown as RestaurantOrder;

const nearby = (count: number): NearbyRiders => ({
  restaurant: { latitude: 18.52, longitude: 73.85 },
  radiusKm: 10,
  count,
  riders: count ? [{ latitude: 18.523, longitude: 73.861, distanceMeters: 520 }] : [],
});

async function open(response: Observable<NearbyRiders>) {
  await TestBed.configureTestingModule({
    imports: [NearbyRidersDialog],
    providers: [
      { provide: MyRestaurantService, useValue: { nearbyRiders: () => response } },
      { provide: BB_DIALOG_DATA, useValue: order },
      { provide: BbDialogRef, useValue: { close: vi.fn() } },
    ],
  })
    .overrideComponent(NearbyRidersDialog, {
      remove: { imports: [TrackingMap] },
      add: { imports: [TrackingMapStub] },
    })
    .compileComponents();
  const fixture = TestBed.createComponent(NearbyRidersDialog);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('NearbyRidersDialog', () => {
  it('shows how many free partners are within the search distance, and the area only', async () => {
    const el = await open(of(nearby(1)));
    const summary = el.querySelector('.summary')!.textContent!.replace(/\s+/g, ' ');
    expect(summary).toContain('1 delivery partner free within 10 km');
    expect(summary).toContain('nearest about 520 m away');
    expect(el.textContent).toContain('goes to Shivaji Nagar');
  });

  it('says when nobody is free, and when the list could not load', async () => {
    let el = await open(of(nearby(0)));
    expect(el.textContent).toContain('No free delivery partner within 10 km right now');
    TestBed.resetTestingModule();
    el = await open(throwError(() => new Error('down')));
    expect(el.querySelector('[role=alert]')!.textContent).toContain('Could not load');
  });
});
