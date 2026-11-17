import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NEVER } from 'rxjs';
import { RealtimeService } from '../../../core/services/realtime.service';
import { FilterValue } from '../../../shared/components/filter-panel/filter-panel.models';
import { AdminOrders } from './admin-orders';

const empty = {
  success: true,
  message: '',
  data: { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 }, counts: {} },
};

describe('AdminOrders', () => {
  let http: HttpTestingController;

  afterEach(() => http.verify());

  it("keeps a linked customer and sends the panel's filters (lists comma-separated, days as dates)", async () => {
    await TestBed.configureTestingModule({
      imports: [AdminOrders],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RealtimeService, useValue: { orderUpdates$: NEVER } },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(AdminOrders);
    fixture.componentRef.setInput('customer', 'u1');
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 350));
    // The first poll may run before the input is set; answer whatever was asked.
    for (const req of http.match((r) => r.url.endsWith('/admin/orders'))) req.flush(empty);

    const cmp = fixture.componentInstance as unknown as { orders: { panel: { set(v: FilterValue): void } } };
    cmp.orders.panel.set({
      status: ['pending', 'delivered'],
      paymentMethod: ['online'],
      restaurant: ['r1', 'r2'],
      placedFrom: new Date(2026, 10, 1),
    });
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 350));
    const req = http.expectOne((r) => r.url.endsWith('/admin/orders'));
    const p = req.request.params;
    expect(p.get('customer')).toBe('u1');
    expect(p.get('status')).toBe('pending,delivered');
    expect(p.get('paymentMethod')).toBe('online');
    expect(p.get('restaurant')).toBe('r1,r2');
    expect(p.get('placedFrom')).toBe('2026-11-01');
    expect(p.has('placedTo')).toBe(false);
    req.flush(empty);
  });
});
