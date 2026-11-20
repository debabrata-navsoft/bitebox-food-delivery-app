import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { DispatchSettings } from '../../../../core/models/admin-roles.models';
import { OperationsService } from '../../../../core/services/admin/operations.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { DispatchSettingsPage } from './dispatch-settings';

const settings = (km: number): DispatchSettings => ({
  maxPickupDistanceKm: km,
  defaultMaxPickupDistanceKm: 10,
  minPickupDistanceKm: 1,
  maxAllowedPickupDistanceKm: 50,
  maxDeliveryDistanceKm: 15,
  defaultMaxDeliveryDistanceKm: 15,
  updatedAt: null,
  updatedBy: null,
});

describe('DispatchSettingsPage', () => {
  const api = { dispatchSettings: vi.fn(), saveDispatchSettings: vi.fn() };
  const notify = { success: vi.fn(), error: vi.fn() };

  async function create() {
    api.dispatchSettings.mockReturnValue(of(settings(10)));
    api.saveDispatchSettings.mockImplementation((c: { maxPickupDistanceKm: number }) =>
      of(settings(c.maxPickupDistanceKm)),
    );
    await TestBed.configureTestingModule({
      imports: [DispatchSettingsPage],
      providers: [
        provideRouter([]),
        { provide: OperationsService, useValue: api },
        { provide: NotificationService, useValue: notify },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(DispatchSettingsPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const page = fixture.componentInstance as unknown as {
      model: { set(v: { maxPickupDistanceKm: number; maxDeliveryDistanceKm: number }): void };
      form: { maxPickupDistanceKm(): { markAsDirty(): void } };
    };
    const submit = async (km: number) => {
      page.model.set({ maxPickupDistanceKm: km, maxDeliveryDistanceKm: 20 });
      page.form.maxPickupDistanceKm().markAsDirty(); // as typing would
      await fixture.whenStable();
      el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
      await fixture.whenStable();
    };
    return { el, submit };
  }

  beforeEach(() => {
    api.saveDispatchSettings.mockReset();
    notify.success.mockReset();
  });

  it('shows both saved distances and saves new ones', async () => {
    const { el, submit } = await create();
    expect(el.textContent).toContain('10 km');
    expect(el.textContent).toContain('15 km');
    expect(el.textContent).toContain('(the default)');
    await submit(25);
    expect(api.saveDispatchSettings).toHaveBeenCalledWith({
      maxPickupDistanceKm: 25,
      maxDeliveryDistanceKm: 20,
    });
    expect(notify.success).toHaveBeenCalledWith('Distance settings saved');
    expect(el.textContent).toContain('25 km');
  });

  it('only accepts 1 to 50 km', async () => {
    const { submit } = await create();
    await submit(0);
    await submit(60);
    expect(api.saveDispatchSettings).not.toHaveBeenCalled();
  });
});
