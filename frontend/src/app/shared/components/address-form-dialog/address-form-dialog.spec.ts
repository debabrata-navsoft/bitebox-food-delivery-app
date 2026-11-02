import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { AddressService } from '../../../core/services/checkout-api.service';
import { DeliveryLocationService } from '../../../core/services/delivery-location.service';
import { GeolocationService } from '../../../core/services/geolocation.service';
import { AddressFormDialog } from './address-form-dialog';

type Form = { controls: Record<string, { value: unknown; setValue: (v: unknown) => void }> };

describe('AddressFormDialog', () => {
  const geo = { supported: true, currentPrecise: vi.fn() };
  const places = { reverse: vi.fn() };
  const service = { create: vi.fn(), update: vi.fn() };

  async function create() {
    await TestBed.configureTestingModule({
      imports: [AddressFormDialog],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: null },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: GeolocationService, useValue: geo },
        { provide: DeliveryLocationService, useValue: places },
        { provide: AddressService, useValue: service },
        { provide: AuthService, useValue: { user: () => ({ name: 'Asha', phone: '9000000002' }) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AddressFormDialog);
    await fixture.whenStable();
    return fixture;
  }

  it('pins GPS coordinates and fills only empty address fields', async () => {
    geo.currentPrecise.mockResolvedValue({ latitude: 10.5, longitude: 20.5, accuracy: 20 });
    places.reverse.mockReturnValue(
      of({ label: 'Test Area, Test City', displayName: 'Test Area, Test City, Test State', area: 'Test Area', city: 'Test City', state: 'Test State', postalCode: '100001', latitude: 10.5, longitude: 20.5 }),
    );
    const fixture = await create();
    const component = fixture.componentInstance as unknown as { form: Form; useCurrentLocation: () => Promise<void>; pinned: () => boolean };
    component.form.controls['city'].setValue('Sample City'); // typed by the user: must be kept

    await component.useCurrentLocation();

    expect(component.pinned()).toBe(true);
    expect(component.form.controls['latitude'].value).toBe(10.5);
    expect(component.form.controls['area'].value).toBe('Test Area');
    expect(component.form.controls['city'].value).toBe('Sample City');
    expect(component.form.controls['postalCode'].value).toBe('100001');
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Delivering here');
  });

  it('refuses to save without a pinned location', async () => {
    const fixture = await create();
    const component = fixture.componentInstance as unknown as { save: () => void };
    component.save();
    expect(service.create).not.toHaveBeenCalled();
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Pin your delivery location first');
  });
});
