import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router, RouterLink } from '@angular/router';
import { IconComponent } from 'nexprime';
import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../../../core/auth/auth.service';
import { isAdminRole } from '../../../../core/models/user.models';
import { openNewTicket } from '../../../../shared/components/support/new-ticket-dialog/new-ticket-dialog';
import { supportBase } from '../../../../shared/components/support/support-base';

/** The company's support details, plus the number as a `tel:` link (digits only). */
export const SUPPORT = {
  ...environment.support,
  tel: `tel:${environment.support.phone.replace(/[^\d+]/g, '')}`,
};

/** Call, chat and email cards, shared by Contact us and the Help center. */
@Component({
  selector: 'bb-contact-options',
  imports: [RouterLink, IconComponent],
  templateUrl: './contact-options.html',
  styleUrl: './contact-options.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactOptions {
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  protected readonly base = supportBase();
  protected readonly support = SUPPORT;

  protected readonly signedIn = this.auth.isAuthenticated;
  /** Admins answer chats rather than start them; signed-out visitors sign in first. */
  protected readonly canChat = computed(() => !isAdminRole(this.auth.role()));

  /** Starts a conversation with support, then opens its thread. */
  protected chat(): void {
    if (!this.signedIn()) {
      void this.router.navigate(['/login'], { queryParams: { returnUrl: '/support' } });
      return;
    }
    openNewTicket(this.dialog).subscribe((ticket) => {
      if (ticket) void this.router.navigate([this.base.path(), ticket.id]);
    });
  }
}
