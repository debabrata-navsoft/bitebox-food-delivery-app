import { ChangeDetectionStrategy, Component, PLATFORM_ID, effect, inject, signal, untracked } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { AnimateOnScrollComponent } from 'nexprime';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { CatalogService } from '../../../core/services/catalog.service';
import { DeliveryLocationService } from '../../../core/services/delivery-location.service';
import { LocationPickerDialog } from '../../../shared/components/location-picker/location-picker-dialog';
import { RestaurantCard } from '../../../shared/components/restaurant-card/restaurant-card';
import { FoodCategory, Restaurant } from '../../../shared/models/catalog.models';

@Component({
  selector: 'bb-home',
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatIconModule, RestaurantCard, AnimateOnScrollComponent],
  templateUrl: './home.html',
  styleUrl: './home.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  private readonly catalog = inject(CatalogService);
  private readonly router = inject(Router);
  protected readonly user = inject(AuthService).user;

  private readonly dialog = inject(MatDialog);
  protected readonly deliveryLocation = inject(DeliveryLocationService).location;

  protected readonly searchControl = new FormControl('', { nonNullable: true });
  protected readonly categories = signal<FoodCategory[]>([]);
  protected readonly restaurants = signal<Restaurant[]>([]);
  /** null = still loading; the page is prerendered, so data is fetched in the browser only. */
  protected readonly loaded = signal<boolean | null>(null);
  private restaurantsRequest?: Subscription;

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    this.catalog.categories().subscribe({ next: (c) => this.categories.set(c), error: () => this.categories.set([]) });

    // Nearby restaurants when a delivery location is set, otherwise the most popular ones.
    effect(() => {
      const location = this.deliveryLocation();
      untracked(() => {
        this.restaurantsRequest?.unsubscribe();
        this.loaded.set(null);
        this.restaurantsRequest = this.catalog
          .restaurants(location ? { lat: location.latitude, lng: location.longitude, sort: 'distance', limit: 8 } : { sort: 'rating', limit: 8 })
          .subscribe({
            next: (res) => {
              this.restaurants.set(res.items);
              this.loaded.set(true);
            },
            // The rest of the page still works without this section.
            error: () => this.loaded.set(false),
          });
      });
    });
  }

  protected chooseLocation(): void {
    this.dialog.open(LocationPickerDialog, { width: '520px', maxWidth: '95vw', autoFocus: 'first-tabbable' });
  }

  protected submitSearch(): void {
    const search = this.searchControl.value.trim();
    void this.router.navigate(['/restaurants'], { queryParams: search ? { search } : {} });
  }

  protected readonly steps = [
    { icon: 'restaurant_menu', title: 'Pick a restaurant', text: 'Browse local kitchens, menus and ratings.' },
    { icon: 'shopping_bag', title: 'Fill your box', text: 'Add dishes, apply a coupon and choose how to pay.' },
    { icon: 'near_me', title: 'Track it live', text: 'Watch your rider on the map until it reaches your door.' },
  ];

  /** Decorative icons floating around the hero illustration. */
  protected readonly heroIcons = ['local_pizza', 'ramen_dining', 'lunch_dining', 'icecream'];
}
