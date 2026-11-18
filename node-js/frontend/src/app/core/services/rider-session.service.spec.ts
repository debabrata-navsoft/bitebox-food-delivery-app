import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Subject, of } from 'rxjs';
import { BbDialog } from '../../shared/dialog/bb-dialog';
import { RiderDashboard, RiderOrder } from '../../shared/models/order-management.models';
import { NotificationService } from './notification.service';
import { RiderService } from './order-management.service';
import { RealtimeService } from './realtime.service';
import { RiderGps } from './rider-gps.service';
import { RiderSession, offerTimeLeftMs } from './rider-session.service';

const NOW = Date.parse('2026-11-18T10:00:00Z');

const offer = (id: string, secondsLeft = 60): RiderOrder =>
  ({
    id,
    offerWindowSeconds: 90,
    offerExpiresAt: new Date(Date.now() + secondsLeft * 1000).toISOString(),
    restaurantSnapshot: { name: 'Lotus Bowl', address: '9 Lake Road' },
  }) as unknown as RiderOrder;

const dashboard = (o: RiderOrder | null): RiderDashboard =>
  ({ profile: { isOnline: true }, offer: o, activeOrder: null }) as unknown as RiderDashboard;

describe('offerTimeLeftMs', () => {
  const order = (expiresAt: number | null) =>
    ({
      offerWindowSeconds: 90,
      offerExpiresAt: expiresAt === null ? null : new Date(expiresAt).toISOString(),
    }) as RiderOrder;

  it('uses the server expiry when this clock agrees with it', () => {
    expect(offerTimeLeftMs(order(NOW + 40_000), NOW)).toBe(40_000);
  });

  it('assumes the full window when the phone clock is fast or slow', () => {
    expect(offerTimeLeftMs(order(NOW - 30_000), NOW)).toBe(90_000); // clock ahead: already "expired"
    expect(offerTimeLeftMs(order(NOW + 600_000), NOW)).toBe(90_000); // clock behind: too long
    expect(offerTimeLeftMs(order(null), NOW)).toBe(90_000);
  });
});

describe('RiderSession', () => {
  const dashboards = new Subject<RiderDashboard>();
  const open = vi.fn();
  const info = vi.fn();
  const closed = new Subject<string | undefined>();
  const close = vi.fn(() => closed.next(undefined));

  function create() {
    TestBed.configureTestingModule({
      providers: [
        RiderSession,
        { provide: RiderService, useValue: { dashboard: () => dashboards } },
        { provide: RealtimeService, useValue: { orderUpdates$: new Subject() } },
        { provide: RiderGps, useValue: { update: vi.fn(), stop: vi.fn() } },
        { provide: NotificationService, useValue: { info, success: vi.fn(), error: vi.fn() } },
        { provide: BbDialog, useValue: { open } },
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
      ],
    });
    return TestBed.inject(RiderSession);
  }

  beforeEach(() => {
    open.mockReset().mockReturnValue({ closed, close });
    info.mockReset();
    close.mockClear();
  });

  it('shows a request once, wherever the rider is, and closes it when it is gone', () => {
    const session = create();
    dashboards.next(dashboard(offer('o1')));
    TestBed.tick();
    expect(open).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith('New delivery request from Lotus Bowl');
    expect(session.offerSecondsLeft()).toBeGreaterThan(55);

    // The same request again (poll or socket refresh): no second popup or toast.
    dashboards.next(dashboard(offer('o1')));
    TestBed.tick();
    expect(open).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledTimes(1);

    // The request ends (taken by someone else, or expired): the popup closes.
    dashboards.next(dashboard(null));
    TestBed.tick();
    expect(close).toHaveBeenCalled();
    expect(session.offerSecondsLeft()).toBe(0);
  });

  it('does not reopen a request the rider closed, but does show the next one', () => {
    const session = create();
    dashboards.next(dashboard(offer('o1')));
    TestBed.tick();
    closed.next(undefined); // closed with the X
    dashboards.next(dashboard(offer('o1')));
    TestBed.tick();
    expect(open).toHaveBeenCalledTimes(1);

    session.openOffer(); // "View request" on the dashboard
    expect(open).toHaveBeenCalledTimes(2);
    closed.next(undefined);

    dashboards.next(dashboard(offer('o2')));
    TestBed.tick();
    expect(open).toHaveBeenCalledTimes(3);
  });
});
