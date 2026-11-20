import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { KycSummary } from '../../../../core/models/kyc.models';
import { KycService } from '../../../../core/services/kyc.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { errorMessage } from '../../../utils/api-error';
import { KycDocuments } from '../kyc-documents/kyc-documents';
import { PayoutAccountForm } from '../payout-account-form/payout-account-form';

/**
 * The verification page body shared by restaurants and riders: "Send for review" when the
 * review asked for changes, the role's own details card (projected, with `detailsTitle`), the
 * bank account and the documents checklist. The page projects its status into `[status]` and
 * gets the updated account back from `resubmitted`.
 */
@Component({
  selector: 'bb-kyc-verification',
  imports: [KycDocuments, PayoutAccountForm],
  templateUrl: './kyc-verification.html',
  styleUrl: './kyc-verification.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KycVerification<T> {
  private readonly kyc = inject(KycService);
  private readonly notify = inject(NotificationService);

  /** Heading of the projected details card ("Legal and tax details", "Home address"). */
  readonly detailsTitle = input.required<string>();
  /** The review asked for changes (rejected or resubmission requested). */
  readonly canResubmit = input(false);
  /** Sends the account back for review. */
  readonly resubmit = input.required<() => Observable<T>>();
  /** The account after a successful "Send for review". */
  readonly resubmitted = output<T>();

  protected readonly kycData = rxResource({ stream: () => this.kyc.summary() });
  protected readonly summary = computed<KycSummary | null>(() =>
    this.kycData.hasValue() ? this.kycData.value() : null,
  );
  protected readonly resubmitting = signal(false);

  /** Re-reads the checklist, e.g. after details that decide which documents are needed. */
  reloadDocuments(): void {
    this.kycData.reload();
  }

  protected send(): void {
    this.resubmitting.set(true);
    this.resubmit()().subscribe({
      next: (account) => {
        this.resubmitting.set(false);
        this.resubmitted.emit(account);
        this.notify.success('Sent for review. We will let you know soon.');
      },
      error: (err: unknown) => {
        this.resubmitting.set(false);
        this.notify.error(errorMessage(err));
      },
    });
  }
}
