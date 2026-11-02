import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { ScrollTopComponent } from 'nexprime';
import { AuthService } from '../../core/auth/auth.service';
import { CartService } from '../../core/services/cart.service';
import { DeliveryLocationService } from '../../core/services/delivery-location.service';
import { LocationPickerDialog } from '../../shared/components/location-picker/location-picker-dialog';
import { BrandLogo } from '../../shared/components/brand-logo/brand-logo';
import { ROLE_META } from '../../shared/models/user.models';

/**
 * Public / customer site chrome: sticky header, footer, and a bottom tab bar
 * on phones for thumb-friendly navigation.
 */
@Component({
  selector: 'bb-customer-layout',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatBadgeModule,
    MatButtonModule,
    MatDividerModule,
    MatIconModule,
    MatMenuModule,
    BrandLogo,
    ScrollTopComponent,
  ],
  templateUrl: './customer-layout.html',
  styleUrl: './customer-layout.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerLayout {
  private readonly auth = inject(AuthService);

  protected readonly user = this.auth.user;
  protected readonly cart = inject(CartService);
  protected readonly deliveryLocation = inject(DeliveryLocationService).location;
  private readonly dialog = inject(MatDialog);
  protected readonly ready = this.auth.initialised;
  /** Signed-in partner/admin accounts get a shortcut to their own panel. */
  protected readonly panelLink = computed(() => {
    const role = this.auth.role();
    return role && role !== 'customer' ? ROLE_META[role].home : null;
  });
  protected readonly firstName = computed(() => this.user()?.name.split(' ')[0] ?? '');
  protected readonly year = new Date().getFullYear();

  protected chooseLocation(): void {
    this.dialog.open(LocationPickerDialog, { width: '520px', maxWidth: '95vw', autoFocus: 'first-tabbable' });
  }

  protected logout(): void {
    this.auth.logout().subscribe();
  }
}
