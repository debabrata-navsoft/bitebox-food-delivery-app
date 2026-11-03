import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { InboxService } from '../../../core/services/inbox.service';
import { AppNotification } from '../../models/payment.models';

/** Header bell: unread count, latest notifications, mark read. Works for every role. */
@Component({
  selector: 'bb-notification-bell',
  imports: [DatePipe, MatBadgeModule, MatButtonModule, MatIconModule, MatMenuModule],
  templateUrl: './notification-bell.html',
  styleUrl: './notification-bell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationBell {
  protected readonly inbox = inject(InboxService);
  private readonly router = inject(Router);

  protected open(n: AppNotification): void {
    this.inbox.markRead(n);
    if (n.link) void this.router.navigateByUrl(n.link);
  }
}
