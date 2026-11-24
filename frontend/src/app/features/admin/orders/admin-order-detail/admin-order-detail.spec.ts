import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NEVER, Subject, of } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { AdminOrdersService } from '../../../../core/services/order-management.service';
import { RealtimeService } from '../../../../core/services/realtime.service';
import { AdminOrder } from '../../../../core/models/order-management.models';
import { AdminOrderDetail } from './admin-order-detail';

const order = {
  id: 'o1',
  orderNumber: 'BB-261124-TEST01',
  restaurant: 'r1',
  restaurantSnapshot: { name: 'Olive Grove Kitchen', address: '12 Lake Road', phone: '+910000000001' },
  items: [
    { foodItem: 'f1', name: 'Masala Dosa', quantity: 2, isVeg: true, unitPricePaise: 15000, lineTotalPaise: 30000 },
  ],
  deliveryAddress: {
    recipientName: 'Tara Lane',
    phone: '+910000000002',
    line1: '4 Park Street',
    city: 'Kolkata',
    postalCode: '700001',
  },
  pricing: { itemTotalPaise: 30000, deliveryFeePaise: 2500, totalPaise: 32500 },
  distanceMeters: 1200,
  status: 'confirmed',
  statusHistory: [{ status: 'pending', at: '2026-11-24T10:00:00Z' }],
  paymentMethod: 'cod',
  paymentStatus: 'pending',
  offer: null,
  createdAt: '2026-11-24T10:00:00Z',
  updatedAt: '2026-11-24T10:00:00Z',
} as unknown as AdminOrder;

async function render(canManage: boolean) {
  await TestBed.configureTestingModule({
    imports: [AdminOrderDetail],
    providers: [
      provideRouter([]),
      { provide: AdminOrdersService, useValue: { get: () => of(order) } },
      { provide: AuthService, useValue: { can: () => canManage } },
      { provide: RealtimeService, useValue: { orderUpdates$: NEVER, track: () => NEVER } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(AdminOrderDetail);
  fixture.componentRef.setInput('id', 'o1');
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('AdminOrderDetail', () => {
  it('shows the order, its people, items and history on the page', async () => {
    const el = await render(true);
    expect(el.querySelector('h1')?.textContent).toContain('BB-261124-TEST01');
    expect(el.textContent).toContain('Olive Grove Kitchen');
    expect(el.textContent).toContain('Tara Lane');
    expect(el.textContent).toContain('Masala Dosa');
    expect(el.textContent).toContain('Cancel order');
  });

  it('hides the actions from admins who can only read orders', async () => {
    const el = await render(false);
    expect(el.textContent).not.toContain('Cancel order');
  });

  it('follows the order live: an event for it refetches and moves the tracker on', async () => {
    const events = new Subject<{ id: string }>();
    let current = order;
    const get = vi.fn(() => of(current));
    await TestBed.configureTestingModule({
      imports: [AdminOrderDetail],
      providers: [
        provideRouter([]),
        { provide: AdminOrdersService, useValue: { get } },
        { provide: AuthService, useValue: { can: () => true } },
        { provide: RealtimeService, useValue: { orderUpdates$: events, track: () => NEVER } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AdminOrderDetail);
    fixture.componentRef.setInput('id', 'o1');
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const current_step = () => el.querySelector('.journey .step.current .label')?.textContent?.trim();
    expect(current_step()).toBe('Accepted');

    current = {
      ...order,
      status: 'preparing',
      statusHistory: [...order.statusHistory, { status: 'confirmed', at: '2026-11-24T10:02:00Z' }, { status: 'preparing', at: '2026-11-24T10:05:00Z' }],
    } as AdminOrder;
    events.next({ id: 'someone-else' });
    events.next({ id: 'o1' });
    await new Promise((r) => setTimeout(r, 300)); // the events are debounced
    fixture.detectChanges();
    expect(get).toHaveBeenCalledTimes(2); // the page load, then the event for this order only
    expect(current_step()).toBe('Preparing');
  });
});
