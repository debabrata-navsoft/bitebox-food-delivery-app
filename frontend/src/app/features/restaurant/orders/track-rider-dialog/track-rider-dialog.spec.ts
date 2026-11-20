import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EMPTY, of } from 'rxjs';
import { RestaurantOrder } from '../../../../core/models/order-management.models';
import { OrderTrackingService } from '../../../../core/services/order-tracking.service';
import { RealtimeService } from '../../../../core/services/realtime.service';
import { RoutingService } from '../../../../core/services/routing.service';
import { TrackingMap } from '../../../../shared/components/tracking-map/tracking-map';
import { TrackingMapStub } from '../../../../shared/components/tracking-map/tracking-map.stub';
import { BB_DIALOG_DATA, BbDialogRef } from '../../../../shared/dialog/bb-dialog';
import { TrackRiderDialog } from './track-rider-dialog';

const order = (status: RestaurantOrder['status']) =>
  ({
    id: 'o1',
    orderNumber: 'BB-1',
    status,
    riderAssigned: true,
    riderName: 'Kiran',
    restaurantSnapshot: {
      name: 'Lotus Bowl',
      location: { type: 'Point', coordinates: [73.85, 18.52] },
    },
    deliveryAddress: { recipientName: 'Asha Rao', area: 'Shivaji Nagar', city: 'Pune' },
  }) as unknown as RestaurantOrder;

describe('TrackRiderDialog', () => {
  async function open(current: ReturnType<typeof signal<RestaurantOrder | null>>) {
    await TestBed.configureTestingModule({
      imports: [TrackRiderDialog],
      providers: [
        { provide: BB_DIALOG_DATA, useValue: current },
        { provide: BbDialogRef, useValue: { close: vi.fn() } },
        { provide: RealtimeService, useValue: { connected: signal(true), track: () => EMPTY } },
        { provide: OrderTrackingService, useValue: { get: () => of(null) } },
        { provide: RoutingService, useValue: { route: () => EMPTY } },
      ],
    })
      .overrideComponent(TrackRiderDialog, {
        remove: { imports: [TrackingMap] },
        add: { imports: [TrackingMapStub] },
      })
      .compileComponents();
    const fixture = TestBed.createComponent(TrackRiderDialog);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('shows who carries whose order, with the customer by area only, and follows the stage', async () => {
    const current = signal<RestaurantOrder | null>(order('assigned'));
    const { fixture, el } = await open(current);
    expect(el.querySelector('.summary')!.textContent).toContain(
      'Kiran is coming to collect the order',
    );
    expect(el.querySelector('.customer')!.textContent!.replace(/\s+/g, ' ')).toContain(
      'Order for Asha Rao · Shivaji Nagar',
    );
    current.set(order('on_the_way'));
    await fixture.whenStable();
    expect(el.querySelector('.summary')!.textContent).toContain(
      'Kiran is on the way to the customer',
    );
    current.set(null); // delivered: gone from the board
    await fixture.whenStable();
    expect(el.textContent).toContain('This order is no longer out with a rider.');
  });
});
