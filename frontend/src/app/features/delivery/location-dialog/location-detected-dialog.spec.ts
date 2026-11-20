import { Dialog } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom, of } from 'rxjs';
import { BbDialog } from '../../../shared/dialog/bb-dialog';
import { DeliveryLocationService } from '../../../core/services/delivery-location.service';
import {
  LocationDetectedData,
  LocationDetectedDialog,
  openLocationDetectedDialog,
} from './location-detected-dialog';

describe('LocationDetectedDialog', () => {
  const mockLocationService = {
    reverse: vi.fn().mockReturnValue(
      of({
        label: 'Salt Lake, Kolkata',
        area: 'Salt Lake',
        city: 'Kolkata',
        state: 'West Bengal',
        displayName: 'Salt Lake, Sector V, Kolkata, West Bengal',
      }),
    ),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DeliveryLocationService, useValue: mockLocationService },
      ],
    });
  });

  afterEach(() => TestBed.inject(Dialog).closeAll());

  const open = async (data: LocationDetectedData) => {
    const dialogRef = openLocationDetectedDialog(TestBed.inject(BbDialog), data);
    await TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
    return { dialogRef };
  };

  it('renders the dialog with animated title, coordinates, and accuracy', async () => {
    const { dialogRef } = await open({
      latitude: 22.5726,
      longitude: 88.3639,
      accuracy: 12,
      area: 'Salt Lake',
      displayName: 'Salt Lake, Sector V, Kolkata',
    });

    const title = document.querySelector('.title');
    expect(title?.textContent?.trim()).toBe('Location Detected!');

    const coords = document.querySelector('.meta-value');
    expect(coords?.textContent).toContain('22.5726');
    expect(coords?.textContent).toContain('88.3639');

    const accuracy = document.querySelector('.accuracy-tag');
    expect(accuracy?.textContent).toContain('±12m');

    expect(dialogRef).toBeTruthy();
  });

  it('closes when the OK button is clicked', async () => {
    const { dialogRef } = await open({
      latitude: 22.5726,
      longitude: 88.3639,
      accuracy: 15,
    });

    const closed = firstValueFrom(dialogRef.closed);
    const okBtn = document.querySelector<HTMLButtonElement>('.ok-btn');
    expect(okBtn).toBeTruthy();
    okBtn?.click();

    await closed;
    expect(TestBed.inject(Dialog).openDialogs.length).toBe(0);
  });
});
