import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  PanelWelcome,
  UpcomingModule,
} from '../../../shared/components/panel-welcome/panel-welcome';

@Component({
  selector: 'bb-delivery-dashboard',
  imports: [PanelWelcome],
  templateUrl: './delivery-dashboard.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeliveryDashboard {
  protected readonly upcoming: UpcomingModule[] = [
    { icon: 'toggle_on', title: 'Online / offline', text: 'Control when you receive delivery requests.' },
    { icon: 'assignment', title: 'Delivery requests', text: 'Accept nearby orders that are ready for pickup.' },
    { icon: 'map', title: 'Live navigation', text: 'Route to the restaurant and customer on the map.' },
    { icon: 'account_balance_wallet', title: 'Earnings', text: 'Completed trips and payout history.' },
  ];
}
