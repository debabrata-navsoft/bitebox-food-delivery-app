import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NavItem, PanelShell } from '../panel-shell/panel-shell';

@Component({
  selector: 'bb-restaurant-layout',
  imports: [PanelShell],
  templateUrl: './restaurant-layout.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RestaurantLayout {
  protected readonly nav: NavItem[] = [
    { label: 'Dashboard', icon: 'space_dashboard', link: '/restaurant', exact: true },
    { label: 'Restaurant details', icon: 'storefront', link: '/restaurant/details' },
    { label: 'Menu', icon: 'menu_book', link: '/restaurant/menu' },
    { label: 'Profile', icon: 'manage_accounts', link: '/restaurant/profile' },
  ];
}
