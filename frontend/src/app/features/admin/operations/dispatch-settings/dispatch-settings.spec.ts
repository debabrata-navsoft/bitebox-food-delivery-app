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
  updatedAt: null,
  updatedBy: null,
});

describe('DispatchSettingsPage', () => {
  const api = { dispatchSettings: vi.fn(), saveDispatchSettings: vi.fn() };
  const notify = { success: vi.fn(), error: vi.fn() };

  async function create() {
    api.dispatchSettings.mockReturnValue(of(settings(10)));
    api.saveDispatchSettings.mockImplementation((km: number) => of(settings(km)));
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
      model: { set(v: { maxPickupDistanceKm: number }): void };
      form: { maxPickupDistanceKm(): { markAsDirty(): void } };
    };
    const submit = async (km: number) => {
      page.model.set({ maxPickupDistanceKm: km });
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

  it('shows the saved distance and saves a new one', async () => {
    const { el, submit } = await create();
    expect(el.textContent).toContain('10 km');
    expect(el.textContent).toContain('(the default)');
    await submit(25);
    expect(api.saveDispatchSettings).toHaveBeenCalledWith(25);
    expect(notify.success).toHaveBeenCalledWith('Riders within 25 km now get new orders');
    expect(el.textContent).toContain('25 km');
  });

  it('only accepts 1 to 50 km', async () => {
    const { submit } = await create();
    await submit(0);
    await submit(60);
    expect(api.saveDispatchSettings).not.toHaveBeenCalled();
  });
});
