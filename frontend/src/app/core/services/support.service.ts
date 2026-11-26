import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  MyTicket,
  NewTicket,
  SupportDashboard,
  TicketDetail,
  TicketPage,
  TicketQuery,
  TicketSummary,
  TicketUpdate,
} from '../models/admin-roles.models';
import { Faceted, ListQuery } from '../../shared/list/filtered-list';
import { ApiResponse } from '../models/api.models';
import { toParams } from '../../shared/utils/http-params';

const data = <T>() => map((r: ApiResponse<T>) => r.data);
const ticket = <T>() => map((r: ApiResponse<{ ticket: T }>) => r.data.ticket);

/** Customers, restaurants and riders: their own support tickets. */
@Injectable({ providedIn: 'root' })
export class SupportService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.baseUrl}/support/tickets`;

  /**
   * status (open, waiting_for_response, closed) and type take one value or several (the Filters
   * panel), plus createdFrom/createdTo and search; `facets: 1` adds its counts (own tickets only).
   */
  mine = (query: ListQuery): Observable<Faceted<MyTicket>> =>
    this.http
      .get<ApiResponse<Faceted<MyTicket>>>(this.url, { params: toParams(query) })
      .pipe(data());
  create = (input: NewTicket): Observable<MyTicket> =>
    this.http.post<ApiResponse<{ ticket: MyTicket }>>(this.url, input).pipe(ticket());
  get = (id: string): Observable<MyTicket> =>
    this.http.get<ApiResponse<{ ticket: MyTicket }>>(`${this.url}/${id}`).pipe(ticket());
  reply = (id: string, body: string): Observable<MyTicket> =>
    this.http
      .post<ApiResponse<{ ticket: MyTicket }>>(`${this.url}/${id}/messages`, { body })
      .pipe(ticket());
}

/** Support staff: the ticket queue. */
@Injectable({ providedIn: 'root' })
export class SupportDeskService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.baseUrl}/admin/support`;
  private readonly tickets = `${this.url}/tickets`;

  dashboard = (): Observable<SupportDashboard> =>
    this.http.get<ApiResponse<SupportDashboard>>(`${this.url}/dashboard`).pipe(data());
  staff = () =>
    this.http
      .get<ApiResponse<{ items: { id: string; name: string; role: string }[] }>>(
        `${this.url}/staff`,
      )
      .pipe(map((r) => r.data.items));
  /**
   * The queue: status, priority, type, requesterRole and assignee (each one value or several),
   * requester, createdFrom/createdTo and search; `facets: 1` adds the Filters panel's counts.
   */
  list = (
    query: TicketQuery | ListQuery,
  ): Observable<TicketPage & Pick<Faceted<TicketSummary>, 'facets'>> =>
    this.http
      .get<ApiResponse<Faceted<TicketSummary>>>(this.tickets, { params: toParams(query) })
      .pipe(data());
  get = (id: string): Observable<TicketDetail> =>
    this.http.get<ApiResponse<{ ticket: TicketDetail }>>(`${this.tickets}/${id}`).pipe(ticket());
  update = (id: string, change: TicketUpdate): Observable<TicketDetail> =>
    this.http
      .patch<ApiResponse<{ ticket: TicketDetail }>>(`${this.tickets}/${id}`, change)
      .pipe(ticket());
  message = (id: string, body: string, internal: boolean): Observable<TicketDetail> =>
    this.http
      .post<ApiResponse<{ ticket: TicketDetail }>>(`${this.tickets}/${id}/messages`, {
        body,
        internal,
      })
      .pipe(ticket());
  escalate = (id: string, note: string): Observable<TicketDetail> =>
    this.http
      .post<ApiResponse<{ ticket: TicketDetail }>>(`${this.tickets}/${id}/escalate`, { note })
      .pipe(ticket());
}
