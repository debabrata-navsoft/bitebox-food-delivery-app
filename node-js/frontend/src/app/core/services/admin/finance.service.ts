import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  Commission,
  CommissionRules,
  FinanceDashboard,
  LedgerSummary,
  Payout,
  PayoutDue,
  PayoutType,
  RefundRow,
  Transaction,
} from '../../../shared/models/admin-roles.models';
import { Faceted, ListQuery } from '../../../shared/list/filtered-list';
import { ApiResponse } from '../../../shared/models/api.models';
import { FileDownloadService } from '../file-download.service';
import { toParams } from '../http-params';

@Injectable({ providedIn: 'root' })
export class FinanceService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.baseUrl}/admin/finance`;
  private readonly files = inject(FileDownloadService);

  private get<T>(path: string, query: object = {}): Observable<T> {
    return this.http
      .get<ApiResponse<T>>(`${this.url}/${path}`, { params: toParams(query) })
      .pipe(map((r) => r.data));
  }
  private post<T>(path: string, body: object): Observable<T> {
    return this.http.post<ApiResponse<T>>(`${this.url}/${path}`, body).pipe(map((r) => r.data));
  }

  dashboard = (days: number) => this.get<FinanceDashboard>('dashboard', { days });
  commission = (days: number) => this.get<Commission>('commission', { days });
  transaction = (id: string) =>
    this.get<{ transaction: Transaction }>(`transactions/${id}`).pipe(map((d) => d.transaction));
  /** The refund queue: state, restaurant, updatedFrom/updatedTo, search; `facets: 1` adds the counts. */
  refunds = (query: ListQuery) => this.get<Faceted<RefundRow>>('refunds', query);

  due = (type: PayoutType) =>
    this.get<{ items: PayoutDue[] }>('payouts/due', { type }).pipe(map((d) => d.items));
  /**
   * Payout history: type, status, restaurant, rider (riders' user ids), createdFrom/createdTo and
   * search; `facets: 1` adds the counts.
   */
  payouts = (query: ListQuery) => this.get<Faceted<Payout>>('payouts', query);
  createPayout = (type: PayoutType, payeeId: string, note?: string) =>
    this.post<{ payout: Payout }>('payouts', { type, payeeId, note }).pipe(map((d) => d.payout));
  markPaid = (id: string, reference: string) =>
    this.post<{ payout: Payout }>(`payouts/${id}/paid`, { reference }).pipe(map((d) => d.payout));
  cancelPayout = (id: string, note?: string) =>
    this.post<{ payout: Payout }>(`payouts/${id}/cancel`, { note }).pipe(map((d) => d.payout));

  // Commission rules (changing them needs payouts:manage).
  commissionRules = () => this.get<CommissionRules>('commission/rules');
  setCommission = (body: { restaurantId?: string | null; basisPoints: number; note?: string }) =>
    this.http
      .put<ApiResponse<CommissionRules>>(`${this.url}/commission/rules`, body)
      .pipe(map((r) => r.data));
  clearCommission = (restaurantId: string) =>
    this.http
      .delete<ApiResponse<CommissionRules>>(`${this.url}/commission/rules/${restaurantId}`)
      .pipe(map((r) => r.data));

  /** Balances (whole ledger) and entries: account, event, createdFrom/createdTo, search. */
  ledger = (query: ListQuery & { days?: number }) =>
    this.get<LedgerSummary & Pick<Faceted<unknown>, 'facets'>>('ledger', query);
  statement = (id: string) =>
    this.files.save(
      `${this.url}/payouts/${encodeURIComponent(id)}/statement`,
      'BiteBox-payout-statement.pdf',
    );
  settlementsCsv = () => this.files.save(`${this.url}/settlements.csv`, 'BiteBox-settlements.csv');
}
