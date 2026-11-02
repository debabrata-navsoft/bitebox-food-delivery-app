import { HttpClient } from '@angular/common/http';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { Observable, catchError, finalize, map, of, shareReplay, tap, throwError, timer, switchMap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../../shared/models/api.models';
import {
  AuthSession,
  ChangePasswordRequest,
  LoginRequest,
  ROLE_META,
  RegisterRequest,
  Role,
  UpdateProfileRequest,
  User,
} from '../../shared/models/user.models';
import { errorCode } from '../services/api-error';

/**
 * Owns the signed-in user and access token.
 *
 * Security model:
 * - The short-lived access token lives only in memory (a signal), never in
 *   localStorage, so it is not readable by injected scripts after a reload.
 * - The long-lived refresh token is an HttpOnly cookie the browser sends only
 *   to /api/v1/auth; JavaScript can never read it.
 * - On page load we call /auth/refresh to restore the session.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly baseUrl = `${environment.apiUrl}/auth`;

  private readonly _user = signal<User | null>(null);
  private readonly _accessToken = signal<string | null>(null);
  private readonly _initialised = signal(false);
  private refreshInFlight$: Observable<string> | null = null;

  readonly user = this._user.asReadonly();
  readonly initialised = this._initialised.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);
  readonly role = computed(() => this._user()?.role ?? null);

  get accessToken(): string | null {
    return this._accessToken();
  }

  /**
   * Runs once at startup (browser only) to restore a session from the refresh cookie.
   * On the server `initialised` stays false so prerendered HTML matches the
   * browser's first paint (session unknown) and hydration does not mismatch.
   */
  restoreSession(): Observable<void> {
    if (!this.isBrowser) return of(undefined);
    return this.refresh().pipe(
      map(() => undefined),
      catchError(() => of(undefined)),
      finalize(() => this._initialised.set(true)),
    );
  }

  login(request: LoginRequest): Observable<User> {
    return this.http
      .post<ApiResponse<AuthSession>>(`${this.baseUrl}/login`, request)
      .pipe(map((res) => this.applySession(res.data)));
  }

  register(request: RegisterRequest): Observable<User> {
    return this.http
      .post<ApiResponse<AuthSession>>(`${this.baseUrl}/register`, request)
      .pipe(map((res) => this.applySession(res.data)));
  }

  /**
   * Exchanges the refresh cookie for a new access token. Concurrent callers
   * share one request; a REFRESH_RACE (another tab rotated first) is retried once.
   */
  refresh(): Observable<string> {
    if (!this.refreshInFlight$) {
      const attempt = () =>
        this.http.post<ApiResponse<AuthSession>>(`${this.baseUrl}/refresh`, {}).pipe(
          map((res) => {
            this.applySession(res.data);
            return res.data.accessToken;
          }),
        );

      this.refreshInFlight$ = attempt().pipe(
        catchError((error: unknown) =>
          errorCode(error) === 'REFRESH_RACE'
            ? timer(300).pipe(switchMap(attempt))
            : throwError(() => error),
        ),
        catchError((error: unknown) => {
          this.clearSession();
          return throwError(() => error);
        }),
        finalize(() => (this.refreshInFlight$ = null)),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.refreshInFlight$;
  }

  logout(): Observable<void> {
    const role = this._user()?.role ?? 'customer';
    return this.http.post<ApiResponse<null>>(`${this.baseUrl}/logout`, {}).pipe(
      catchError(() => of(null)),
      map(() => undefined),
      tap(() => {
        this.clearSession();
        void this.router.navigateByUrl(ROLE_META[role].login);
      }),
    );
  }

  forgotPassword(email: string): Observable<string> {
    return this.http
      .post<ApiResponse<null>>(`${this.baseUrl}/forgot-password`, { email })
      .pipe(map((res) => res.message));
  }

  resetPassword(token: string, password: string): Observable<string> {
    return this.http
      .post<ApiResponse<null>>(`${this.baseUrl}/reset-password`, { token, password })
      .pipe(map((res) => res.message));
  }

  updateProfile(request: UpdateProfileRequest): Observable<User> {
    return this.http.patch<ApiResponse<{ user: User }>>(`${this.baseUrl}/me`, request).pipe(
      map((res) => res.data.user),
      tap((user) => this._user.set(user)),
    );
  }

  /** Changing the password revokes every session, including this one. */
  changePassword(request: ChangePasswordRequest): Observable<string> {
    const role = this._user()?.role ?? 'customer';
    return this.http.post<ApiResponse<null>>(`${this.baseUrl}/change-password`, request).pipe(
      map((res) => res.message),
      tap(() => {
        this.clearSession();
        void this.router.navigateByUrl(ROLE_META[role].login);
      }),
    );
  }

  hasRole(...roles: Role[]): boolean {
    const role = this.role();
    return role !== null && roles.includes(role);
  }

  homeFor(role: Role): string {
    return ROLE_META[role].home;
  }

  /** Clears local state without calling the API (e.g. after a failed refresh). */
  clearSession(): void {
    this._user.set(null);
    this._accessToken.set(null);
  }

  private applySession(session: AuthSession): User {
    this._accessToken.set(session.accessToken);
    this._user.set(session.user);
    return session.user;
  }
}
