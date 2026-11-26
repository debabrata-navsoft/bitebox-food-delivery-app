import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconComponent } from 'nexprime';
import { GENDER_LABEL, USER_STATUS_META, User } from '../../../core/models/user.models';
import { dateText, fromIsoDay } from '../../utils/dates';
import { InfoRow, InfoRows } from '../info-rows/info-rows';

/**
 * A person's details for the admin account pages (customers, riders): Contact (email and phone,
 * verified or not), Personal (gender, birthday, and a rider's address and emergency contact) and
 * Account (joined, last sign-in, referral code, why it isn't active). A page can add its own
 * `<section class="bb-card">` cards inside the tag; they join the same two-column grid.
 */
@Component({
  selector: 'bb-person-info',
  imports: [IconComponent, InfoRows],
  templateUrl: './person-info.html',
  styleUrl: './person-info.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonInfo {
  readonly user = input.required<User>();
  /** A rider's home address and emergency contact, already written out (omit for customers). */
  readonly address = input<string | null>();
  readonly emergency = input<string | null>();

  private readonly day = dateText().day;

  protected readonly contacts = computed(() => {
    const u = this.user();
    return [
      { icon: 'mail', label: 'Email', value: u.email, verified: !!u.emailVerified },
      { icon: 'smartphone', label: 'Phone', value: u.phone || null, verified: !!u.phoneVerified },
    ];
  });

  protected readonly personal = computed((): InfoRow[] => {
    const u = this.user();
    const rows: InfoRow[] = [
      { icon: 'user', label: 'Gender', value: u.gender ? GENDER_LABEL[u.gender] : 'Not added' },
      {
        icon: 'cake',
        label: 'Date of birth',
        value: this.day(fromIsoDay(u.birthDate)) || 'Not added',
      },
    ];
    // Riders only (the inputs are left out for customers).
    if (this.address() !== undefined) {
      rows.push({ icon: 'house', label: 'Address', value: this.address() || 'Not added' });
    }
    if (this.emergency() !== undefined) {
      rows.push({
        icon: 'phone-call',
        label: 'Emergency contact',
        value: this.emergency() || 'Not added',
      });
    }
    return rows;
  });

  protected readonly account = computed((): InfoRow[] => {
    const u = this.user();
    const rows: InfoRow[] = [
      { icon: 'calendar-plus', label: 'Joined', value: this.day(u.createdAt) },
      {
        icon: 'log-in',
        label: 'Last sign-in',
        value: this.day(u.lastLoginAt, 'd MMM y, h:mm a') || 'Never',
      },
    ];
    if (u.referralCode) rows.push({ icon: 'gift', label: 'Referral code', value: u.referralCode });
    if (u.status !== 'active' && u.statusReason) {
      rows.push({
        icon: 'shield-alert',
        label: USER_STATUS_META[u.status].label,
        value: u.statusReason,
      });
    }
    return rows;
  });
}
