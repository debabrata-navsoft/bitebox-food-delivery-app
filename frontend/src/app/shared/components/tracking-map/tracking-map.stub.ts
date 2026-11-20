import { Component, input } from '@angular/core';

/** For specs: the real map loads Leaflet; hosts only need to hand it the right data. */
@Component({ selector: 'bb-tracking-map', template: '' })
export class TrackingMapStub {
  readonly restaurant = input<unknown>();
  readonly rider = input<unknown>();
  readonly riderStale = input(false);
  readonly riderAccuracy = input<number | null>(null);
  readonly trail = input<unknown[]>([]);
  readonly nearby = input<unknown[]>([]);
  readonly radiusKm = input<number | null>(null);
  readonly fitRadius = input<unknown>();
  readonly label = input('');
}
