import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe, isPlatformBrowser } from '@angular/common';
import { IconComponent } from 'nexprime';
import { firstValueFrom } from 'rxjs';
import {
  BB_DIALOG_DATA,
  BB_DIALOG_TITLE_ID,
  BbDialog,
  BbDialogRef,
} from '../../../shared/dialog/bb-dialog';
import { DeliveryLocationService } from '../../../core/services/delivery-location.service';

export interface LocationDetectedData {
  latitude: number;
  longitude: number;
  accuracy?: number;
  area?: string;
  city?: string;
  displayName?: string;
}

@Component({
  selector: 'bb-location-detected-dialog',
  imports: [DecimalPipe, IconComponent],
  templateUrl: './location-detected-dialog.html',
  styleUrl: './location-detected-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LocationDetectedDialog {
  protected readonly data = inject<LocationDetectedData>(BB_DIALOG_DATA);
  protected readonly ref = inject<BbDialogRef<void>>(BbDialogRef);
  protected readonly titleId = inject(BB_DIALOG_TITLE_ID, { optional: true }) ?? 'location-dialog-title';
  private readonly locationService = inject(DeliveryLocationService);

  protected readonly Math = Math;
  protected readonly placeLoading = signal(!this.data.area && !this.data.displayName);
  protected readonly placeName = signal(
    this.data.area || this.data.city || (this.data.displayName ? this.data.displayName.split(',')[0] : ''),
  );
  protected readonly placeSub = signal(
    this.data.displayName ? this.data.displayName.split(',').slice(1, 3).join(',').trim() : '',
  );

  constructor() {
    if (this.placeLoading()) {
      firstValueFrom(this.locationService.reverse(this.data.latitude, this.data.longitude))
        .then((p) => {
          this.placeName.set(p.area || p.city || p.label || 'Location Locked');
          this.placeSub.set(
            [p.city, p.state].filter(Boolean).filter((s) => s !== this.placeName()).join(', ') || p.displayName || '',
          );
        })
        .catch(() => {
          this.placeName.set('Location Locked');
          this.placeSub.set(`${this.data.latitude.toFixed(4)}°, ${this.data.longitude.toFixed(4)}°`);
        })
        .finally(() => this.placeLoading.set(false));
    }

    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      const timer = setTimeout(() => this.ref.close(), 6000);
      inject(DestroyRef).onDestroy(() => clearTimeout(timer));
    }
  }

  protected close(): void {
    this.ref.close();
  }
}

export const openLocationDetectedDialog = (dialog: BbDialog, data: LocationDetectedData) =>
  dialog.open<LocationDetectedDialog, LocationDetectedData, void>(LocationDetectedDialog, {
    data,
    width: '420px',
    panelClass: 'bb-location-detected-panel',
  });
