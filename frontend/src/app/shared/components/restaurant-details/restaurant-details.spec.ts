import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { MyRestaurantService } from '../../../core/services/my-restaurant.service';
import { NotificationService } from '../../../core/services/notification.service';
import { RestaurantDetails } from './restaurant-details';

describe('RestaurantDetails', () => {
  it('starts a new restaurant with the phone and email the owner signed up with', async () => {
    const owner = { phone: '+919000000001', email: 'owner@example.test' };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: MyRestaurantService, useValue: { get: () => of({ restaurant: null }) } },
        { provide: AuthService, useValue: { user: signal(owner) } },
      ],
    });
    const fixture = TestBed.createComponent(RestaurantDetails);
    await fixture.whenStable();
    const model = (fixture.componentInstance as unknown as { model: () => object }).model();
    expect(model).toEqual(expect.objectContaining(owner));
  });

  describe('after saving', () => {
    const restaurant = (status: string) => ({
      id: 'r1',
      name: 'Maple Bistro',
      slug: 'maple-bistro',
      description: 'Kebabs and grills.',
      cuisines: ['Mughlai'],
      phone: '+919000000001',
      email: '',
      address: {
        line1: '7 Lake View Lane',
        city: 'Riverside',
        state: 'West Bengal',
        postalCode: '700016',
      },
      location: { type: 'Point', coordinates: [88.37, 22.49] },
      imageUrl: '',
      photos: [],
      isPureVeg: false,
      costForTwoPaise: 50000,
      minOrderPaise: 0,
      avgPrepTimeMinutes: 25,
      openingTime: '10:00',
      closingTime: '23:00',
      weeklyHours: null,
      status,
    });

    async function saveAs(status: string, embedded = false) {
      const saved = restaurant(status);
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          {
            provide: MyRestaurantService,
            useValue: { get: () => of({ restaurant: saved }), update: () => of(saved) },
          },
          { provide: AuthService, useValue: { user: signal({}) } },
          {
            provide: NotificationService,
            useValue: { success: () => undefined, error: () => undefined },
          },
        ],
      });
      const router = TestBed.inject(Router);
      const go = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      const fixture = TestBed.createComponent(RestaurantDetails);
      fixture.componentRef.setInput('embedded', embedded);
      await fixture.whenStable();
      await (fixture.componentInstance as unknown as { save: () => Promise<unknown> }).save();
      return go;
    }

    it('sends a partner who is still onboarding to KYC verification', async () => {
      expect(await saveAs('pending')).toHaveBeenCalledWith('/restaurant/verification');
    });

    it('stays on the page once the restaurant is approved, and in the admin form', async () => {
      expect(await saveAs('approved')).not.toHaveBeenCalled();
      TestBed.resetTestingModule();
      expect(await saveAs('pending', true)).not.toHaveBeenCalled();
    });
  });
});
