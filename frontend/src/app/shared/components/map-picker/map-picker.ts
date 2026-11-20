import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type * as Leaflet from 'leaflet';
import { environment } from '../../../../environments/environment';
import { UNRELIABLE_ACCURACY_M } from '../../../core/services/geolocation.service';
import { DeliveryRangeService } from '../../../core/services/delivery-range.service';
import { MapFrame } from '../map-frame/map-frame';
import { ctrlScrollZoom } from '../../utils/ctrl-scroll-zoom';

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** A GPS fix: where the device is and how exact that is (metres). */
export interface CurrentPosition extends LatLng {
  accuracy?: number | null;
}

const FALLBACK: LatLng = { latitude: 22.35, longitude: 78.67 };

@Component({
  selector: 'bb-map-picker',
  imports: [DecimalPipe, MapFrame],
  templateUrl: './map-picker.html',
  styleUrl: './map-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapPicker {
  readonly latitude = input<number | null>(null);
  readonly longitude = input<number | null>(null);
  /** The device's GPS fix ("Current location"): a blue dot with a ring of its accuracy. */
  readonly current = input<CurrentPosition | null>(null);
  /** The legend text for the delivery-range circle around the pin ({km} is replaced). */
  readonly rangeHint = input('Restaurants within {km} km can deliver here');
  /** The admin's delivery range (km), drawn as a dashed circle around the pin. */
  protected readonly rangeKm = inject(DeliveryRangeService).km;
  readonly moved = output<LatLng>();

  protected readonly loadError = signal<string | null>(null);
  protected readonly ready = signal(false);
  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('map');

  private L?: typeof Leaflet;
  private map?: Leaflet.Map;
  private marker?: Leaflet.Marker;
  private range?: Leaflet.Circle;
  private here?: Leaflet.LayerGroup;
  private resizeObserver?: ResizeObserver;

  constructor() {
    afterNextRender(() => void this.init());
    inject(DestroyRef).onDestroy(() => {
      this.resizeObserver?.disconnect();
      this.map?.remove();
    });

    effect(() => {
      const lat = this.latitude();
      const lng = this.longitude();
      if (!this.ready() || lat === null || lng === null) return;
      this.placePin({ latitude: lat, longitude: lng });
    });

    // The delivery range follows the pin.
    effect(() => {
      const lat = this.latitude();
      const lng = this.longitude();
      const km = this.rangeKm();
      if (!this.ready()) return;
      this.range?.remove();
      this.range =
        km && lat !== null && lng !== null
          ? this.L!.circle([lat, lng], {
              radius: km * 1000,
              className: 'bb-map-range',
              interactive: false,
            }).addTo(this.map!)
          : undefined;
      this.range?.bringToBack();
    });

    // "You are here": stays where the device is, even when the pin is dragged elsewhere.
    effect(() => {
      const fix = this.current();
      if (!this.ready()) return;
      this.showCurrent(fix);
    });
  }

  private async init(): Promise<void> {
    try {
      const mod = await import('leaflet');
      const L = (this.L = ((mod as { default?: typeof Leaflet }).default ?? mod) as typeof Leaflet);
      const start = this.hasPoint()
        ? { latitude: this.latitude()!, longitude: this.longitude()! }
        : FALLBACK;
      this.map = L.map(this.container().nativeElement, {
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: false, // Ctrl + wheel instead (below): a plain wheel scrolls the page
      }).setView([start.latitude, start.longitude], this.hasPoint() ? 17 : 5);
      L.tileLayer(environment.map.tileUrl, {
        maxZoom: environment.map.maxZoom,
        attribution: environment.map.attribution,
      }).addTo(this.map);

      this.map.on('click', (event: Leaflet.LeafletMouseEvent) => {
        const point = { latitude: event.latlng.lat, longitude: event.latlng.lng };
        this.placePin(point, false);
        this.moved.emit(point);
      });
      if (this.hasPoint()) this.placePin(start);
      ctrlScrollZoom(this.map, this.container().nativeElement);
      this.resizeObserver = new ResizeObserver(() => this.map?.invalidateSize());
      this.resizeObserver.observe(this.container().nativeElement);
      this.ready.set(true);
    } catch {
      this.loadError.set('The map could not be loaded. You can still enter coordinates manually.');
    }
  }

  private hasPoint(): boolean {
    return this.latitude() !== null && this.longitude() !== null;
  }

  private placePin(point: LatLng, recenter = true): void {
    const L = this.L;
    const map = this.map;
    if (!L || !map) return;
    const latLng = L.latLng(point.latitude, point.longitude);

    if (!this.marker) {
      const icon = L.divIcon({
        className: 'bb-map-pin',
        html: '<span></span>',
        iconSize: [30, 42],
        iconAnchor: [15, 42],
      });
      this.marker = L.marker(latLng, {
        draggable: true,
        icon,
        keyboard: true,
        title: 'Delivery location (drag to adjust)',
      }).addTo(map);
      this.marker.on('dragend', () => {
        const p = this.marker!.getLatLng();
        this.moved.emit({ latitude: p.lat, longitude: p.lng });
      });
    } else if (!this.marker.getLatLng().equals(latLng, 1e-7)) {
      this.marker.setLatLng(latLng);
    }
    if (recenter) map.setView(latLng, Math.max(map.getZoom(), 16));
  }

  /** The blue dot and its accuracy ring (none when the fix is too vague to draw). */
  private showCurrent(fix: CurrentPosition | null): void {
    const L = this.L!;
    this.here?.remove();
    this.here = undefined;
    if (!fix) return;
    const at = L.latLng(fix.latitude, fix.longitude);
    const ring =
      fix.accuracy && fix.accuracy <= UNRELIABLE_ACCURACY_M
        ? L.circle(at, { radius: fix.accuracy, className: 'bb-map-accuracy', interactive: false })
        : null;
    const dot = L.circleMarker(at, { radius: 7, className: 'bb-map-here', interactive: false });
    this.here = L.layerGroup(ring ? [ring, dot] : [dot]).addTo(this.map!);
    // A vague fix: show its whole ring, so it is clear the pin may need moving.
    if (ring && fix.accuracy! > 150) this.map!.fitBounds(ring.getBounds(), { maxZoom: 17 });
  }
}
