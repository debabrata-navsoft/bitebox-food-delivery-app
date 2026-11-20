import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { DeliveryLocationService } from '../../../core/services/delivery-location.service';
import {
  GeolocationService,
  ImpreciseLocationError,
} from '../../../core/services/geolocation.service';
import { LocationPickerDialog } from './location-picker-dialog';

type Picker = {
  useGps: () => Promise<void>;
  pick: (p: { latitude: number; longitude: number; label: string }) => void;
  onPinMoved: (p: { latitude: number; longitude: number }) => void;
  confirm: () => void;
};

describe('LocationPickerDialog', () => {
  // `denied: true` keeps the on-open detection out of the tests that don't cover it.
  const geo = {
    supported: true,
    currentPrecise: vi.fn(),
    denied: vi.fn(() => Promise.resolve(true)),
  };
  const ref = { close: vi.fn() };
  const location = {
    location: signal(null),
    search: vi.fn(() => of([])),
    reverse: vi.fn(),
    choosePoint: vi.fn(),
    chooseAddress: vi.fn(),
    clear: vi.fn(),
  };

  async function create() {
    await TestBed.configureTestingModule({
      imports: [LocationPickerDialog],
      providers: [
        { provide: GeolocationService, useValue: geo },
        { provide: MatDialogRef, useValue: ref },
        { provide: DeliveryLocationService, useValue: location },
        { provide: AuthService, useValue: { role: () => null } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(LocationPickerDialog);
    await fixture.whenStable();
    return fixture.componentInstance as unknown as Picker;
  }

  beforeEach(() => {
    location.choosePoint.mockReset();
    location.reverse.mockReset();
    ref.close.mockReset();
    geo.currentPrecise.mockReset();
    geo.denied.mockImplementation(() => Promise.resolve(true));
  });

  it('finds the current location when it opens, shows it, and uses it in one tap', async () => {
    geo.denied.mockImplementation(() => Promise.resolve(false));
    geo.currentPrecise.mockResolvedValue({ latitude: 11.5, longitude: 21.5, accuracy: 15 });
    location.reverse.mockReturnValue(
      of({
        label: 'Sample Area, Sample City',
        displayName: 'Sample Area, Sample City, Test State',
        latitude: 11.5,
        longitude: 21.5,
      }),
    );
    const picker = await create();
    const detected = (picker as unknown as { detected: () => { label: string } | null }).detected;

    await vi.waitFor(() => expect(detected()?.label).toBe('Sample Area, Sample City'));
    expect(ref.close).not.toHaveBeenCalled(); // shown under the button, not used yet

    await picker.useGps();
    expect(geo.currentPrecise).toHaveBeenCalledTimes(1); // no second GPS wait
    expect(location.choosePoint).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: 11.5, source: 'gps' }),
    );
    expect(ref.close).toHaveBeenCalledWith(true);
  });

  it('auto-detects and saves the current location in one click', async () => {
    geo.currentPrecise.mockResolvedValue({ latitude: 11.5, longitude: 21.5, accuracy: 15 });
    location.reverse.mockReturnValue(
      of({
        label: 'Sample Area, Sample City',
        displayName: 'Sample Area, Sample City, Test State',
        latitude: 11.5,
        longitude: 21.5,
      }),
    );
    const picker = await create();

    await picker.useGps();

    expect(location.choosePoint).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Sample Area, Sample City', latitude: 11.5, source: 'gps' }),
    );
    expect(ref.close).toHaveBeenCalledWith(true);
  });

  it('never uses a vague browser reading: nothing is saved and search is suggested', async () => {
    geo.currentPrecise.mockRejectedValue(new ImpreciseLocationError(1_400_000));
    const picker = await create();

    await picker.useGps();

    expect(location.choosePoint).not.toHaveBeenCalled();
    expect(ref.close).not.toHaveBeenCalled();
    expect((picker as unknown as { gpsError: () => string }).gpsError()).toContain(
      "couldn't detect your exact location",
    );
  });

  it('lets a searched place be fine-tuned on the map before saving', async () => {
    location.reverse.mockReturnValue(
      of({ label: 'Demo Street, Sample City', latitude: 12.6, longitude: 22.6 }),
    );
    const picker = await create();
    picker.pick({ latitude: 12.5, longitude: 22.5, label: 'Demo Street' });
    expect(location.choosePoint).not.toHaveBeenCalled();
    picker.onPinMoved({ latitude: 12.6, longitude: 22.6 });
    picker.confirm();
    expect(location.choosePoint).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Demo Street, Sample City', latitude: 12.6 }),
    );
  });
});
