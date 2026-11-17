import { DatePipe, LowerCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent, PaginationComponent } from 'nexprime';
import { AuthService } from '../../../core/auth/auth.service';
import { AdminRestaurantAccountsService } from '../../../core/services/admin/admin-restaurant-accounts.service';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { TableLabels } from '../../../shared/list/table-labels';
import { USER_STATUS_META } from '../../../shared/models/user.models';
import { shortId } from '../account-list';
import { JOINED_SECTION, KYC_SECTION, accountSorts, accountStatusSection } from '../filter-sections';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { FilterSection } from '../../../shared/components/filter-panel/filter-panel.models';
import { filterOptions, filteredList } from '../../../shared/list/filtered-list';
import { KYC_META, RESTAURANT_STATUS_LABEL, RESTAURANT_STATUS_TONE } from './restaurant-status';

/**
 * Account management → Restaurant accounts: every restaurant partner with their restaurant,
 * owner, orders, rating, commission, approval, KYC and account status. Filters run on the server.
 */
@Component({
  selector: 'bb-admin-restaurant-accounts',
  imports: [
    DatePipe,
    LowerCasePipe,
    RouterLink,
    IconComponent,
    PaginationComponent,
    PageHeader,
    TableLabels,
    ListToolbar,
  ],
  templateUrl: './admin-restaurant-accounts.html',
  styleUrl: './admin-restaurant-accounts.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminRestaurantAccounts {
  private readonly api = inject(AdminRestaurantAccountsService);
  protected readonly auth = inject(AuthService);
  protected readonly shortId = shortId;
  protected readonly statusLabel = RESTAURANT_STATUS_LABEL;
  protected readonly statusTone = RESTAURANT_STATUS_TONE;
  protected readonly kycMeta = KYC_META;
  protected readonly accountMeta = USER_STATUS_META;

  protected readonly filterSections: FilterSection[] = [
    { kind: 'options', key: 'status', label: 'Approval status', options: filterOptions(RESTAURANT_STATUS_LABEL) },
    KYC_SECTION,
    accountStatusSection('accountStatus', 'Owner account'),
    // Cities come from the restaurants themselves (the API's counts).
    { kind: 'options', key: 'city', label: 'City' },
    JOINED_SECTION,
  ];
  protected readonly sortOptions = accountSorts({ orders: 'Most orders', rating: 'Highest rated' });

  protected readonly accounts = filteredList((query) => this.api.list(query), {
    errorText: 'Could not load restaurant accounts.',
    sort: 'newest',
  });
  protected readonly list = this.accounts.list;
}
