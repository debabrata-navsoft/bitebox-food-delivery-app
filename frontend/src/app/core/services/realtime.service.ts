import { Injectable, PLATFORM_ID, effect, inject, signal, untracked } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, Subject } from 'rxjs';
import { Socket, io } from 'socket.io-client';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { OrderStatus } from '../../shared/models/checkout.models';

/** What the server pushes when an order changes. Details are re-read over the REST API. */
export interface OrderEvent {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  updatedAt: string;
}

/**
 * Live updates over Socket.IO while someone is signed in.
 *
 * The server decides which events each account receives (its own orders,
 * its restaurant, admins see all), so there is nothing to subscribe to here
 * beyond listening. Screens still refresh slowly on their own, so a dropped
 * connection only delays updates; it never loses them.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private readonly auth = inject(AuthService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private socket?: Socket;
  private readonly orders = new Subject<OrderEvent>();
  private retries = 0;

  /** True while the live connection is up. */
  readonly connected = signal(false);
  readonly orderUpdates$: Observable<OrderEvent> = this.orders.asObservable();

  constructor() {
    if (!this.browser) return;
    effect(() => {
      const signedIn = this.auth.user() !== null;
      untracked(() => (signedIn ? this.connect() : this.disconnect()));
    });
  }

  private connect(): void {
    if (this.socket) return;
    // Same host as the API (in development the API runs on its own port).
    const origin = new URL(environment.apiUrl, window.location.origin).origin;
    const socket = io(origin, {
      path: '/socket.io',
      // Read at every (re)connect, so a refreshed token is always used.
      auth: (cb) => cb({ token: this.auth.accessToken }),
      transports: ['websocket', 'polling'],
    });
    this.socket = socket;

    socket.on('connect', () => {
      this.retries = 0;
      this.connected.set(true);
    });
    socket.on('order:updated', (event: OrderEvent) => this.orders.next(event));
    // The server closes the connection when the access token expires: get a new one and come back.
    socket.on('disconnect', (reason) => {
      this.connected.set(false);
      if (reason === 'io server disconnect') this.reconnectWithFreshToken();
    });
    // Refused at the handshake (usually an expired token): the client does not retry these by itself.
    socket.on('connect_error', () => {
      this.connected.set(false);
      if (!socket.active) this.reconnectWithFreshToken();
    });
  }

  private reconnectWithFreshToken(): void {
    const socket = this.socket;
    if (!socket || this.retries >= 5) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.retries++);
    setTimeout(() => {
      if (this.socket !== socket || !this.auth.user()) return;
      this.auth.refresh().subscribe({ next: () => socket.connect(), error: () => undefined });
    }, delay);
  }

  private disconnect(): void {
    this.socket?.disconnect();
    this.socket = undefined;
    this.connected.set(false);
  }
}
