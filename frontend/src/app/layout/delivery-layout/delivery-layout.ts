import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RiderSession } from '../../core/services/rider-session.service';
import { NavItem, PanelShell } from '../panel-shell/panel-shell';

@Component({
  selector: 'bb-delivery-layout',
  imports: [PanelShell],
  templateUrl: './delivery-layout.html',
  // One rider state (live refresh, GPS, the request popup) for every delivery page.
  providers: [RiderSession],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeliveryLayout {
  // Started here, not by the first page that reads it, so a new request pops up on every rider
  // page (History, Earnings...), not only on the ones that use the rider state.
  private readonly session = inject(RiderSession);

  protected readonly nav: NavItem[] = [
    { label: 'Dashboard', icon: 'space_dashboard', link: '/delivery', exact: true },
    { label: 'Current delivery', icon: 'navigation', link: '/delivery/current' },
    { label: 'History', icon: 'history', link: '/delivery/history' },
    { label: 'Ratings', icon: 'star', link: '/delivery/reviews' },
    { label: 'Earnings', icon: 'account_balance_wallet', link: '/delivery/earnings' },
    { label: 'KYC Verification', icon: 'shield-check', link: '/delivery/verification' },
    { label: 'Help & support', icon: 'life-buoy', link: '/delivery/support' },
    { label: 'Profile', icon: 'manage_accounts', link: '/delivery/profile' },
  ];
}
