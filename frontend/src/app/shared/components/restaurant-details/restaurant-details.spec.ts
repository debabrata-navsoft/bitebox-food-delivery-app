import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { MyRestaurantService } from '../../../core/services/my-restaurant.service';
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
});
