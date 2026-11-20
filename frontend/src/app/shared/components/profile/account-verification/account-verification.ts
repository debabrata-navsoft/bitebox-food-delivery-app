import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormRoot, TreeValidationResult, form } from '@angular/forms/signals';
import { ButtonComponent, IconComponent } from 'nexprime';
import { Observable, finalize, firstValueFrom } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { errorMessage, fieldErrors } from '../../../utils/api-error';
import { NotificationService } from '../../../../core/services/notification.service';
import { serverErrors } from '../../../forms/form-errors';
import { codeRules } from '../../../validators/code-rules';
import { NP_FORM_FIELDS } from '../../../forms/np-form-fields';
import { countdown } from '../../../utils/countdown';
import { CodeSent, User } from '../../../../core/models/user.models';

type Channel = 'email' | 'phone';

/** What differs between confirming the email and the mobile number. */
interface ChannelInfo {
  codeLabel: string;
  confirmLabel: string;
  done: string;
  sentTo: (u: User) => string | undefined;
  verified: (u: User) => boolean;
  request: (auth: AuthService) => Observable<CodeSent>;
  verify: (auth: AuthService, code: string) => Observable<User>;
}

const CHANNELS: Record<Channel, ChannelInfo> = {
  email: {
    codeLabel: '6-digit code from the email',
    confirmLabel: 'Confirm email',
    done: 'Email verified',
    sentTo: (u) => u.email,
    verified: (u) => !!u.emailVerified,
    request: (auth) => auth.requestEmailCode(),
    verify: (auth, code) => auth.verifyEmailCode(code),
  },
  phone: {
    codeLabel: '6-digit code from the SMS',
    confirmLabel: 'Confirm number',
    done: 'Phone number verified',
    sentTo: (u) => u.phone,
    verified: (u) => !u.phone || !!u.phoneVerified,
    request: (auth) => auth.requestPhoneVerification(),
    verify: (auth, code) => auth.verifyPhone(code),
  },
};

/** Email and phone verification: a 6-digit code sent by email or SMS confirms each one. */
@Component({
  selector: 'bb-account-verification',
  imports: [FormRoot, NP_FORM_FIELDS, ButtonComponent, IconComponent],
  templateUrl: './account-verification.html',
  styleUrl: './account-verification.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountVerification {
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotificationService);

  protected readonly user = this.auth.user;
  /** Number verification needs SMS; without it the button is off and a note says why. */
  protected readonly phoneCodes = this.auth.phoneCodes;
  protected readonly busy = signal<Channel | null>(null);
  /** Which one a code was sent for. */
  private readonly codeFor = signal<Channel | null>(null);
  /** Seconds until a new code may be asked for, per channel (the API's resend wait). */
  protected readonly timers = { email: countdown(), phone: countdown() };
  /** How long the code just sent stays valid, in minutes. */
  protected readonly expiresInMinutes = signal(0);

  /** The channel whose code field shows, while it still needs confirming. */
  protected readonly pending = computed(() => {
    const what = this.codeFor();
    const u = this.user();
    return what && u && !CHANNELS[what].verified(u) ? CHANNELS[what] : null;
  });

  protected readonly codeModel = signal({ code: '' });
  protected readonly codeForm = form(this.codeModel, (p) => codeRules(p.code), {
    submission: { action: () => this.confirm() },
  });

  constructor() {
    this.auth.checkMethods();
  }

  protected sendCode(what: Channel): void {
    this.busy.set(what);
    CHANNELS[what]
      .request(this.auth)
      .pipe(finalize(() => this.busy.set(null)))
      .subscribe({
        next: (sent) => {
          this.codeFor.set(what);
          this.codeForm().reset({ code: '' });
          this.timers[what].start(sent.resendInSeconds);
          this.expiresInMinutes.set(Math.max(1, Math.round(sent.expiresInSeconds / 60)));
          this.notify.success(sent.message);
        },
        error: (err: unknown) => this.notify.error(errorMessage(err)),
      });
  }

  /** "Verify" first, then "Resend in 25 s" while the wait runs, then "Send a new code". */
  protected sendLabel(what: Channel): string {
    if (this.codeFor() !== what) return 'Verify';
    const left = this.timers[what].left();
    return left > 0 ? `Resend in ${left} s` : 'Send a new code';
  }

  private async confirm(): Promise<TreeValidationResult> {
    const channel = this.pending();
    if (!channel) return undefined;
    try {
      await firstValueFrom(channel.verify(this.auth, this.codeModel().code));
      this.codeFor.set(null);
      this.notify.success(channel.done);
      return undefined;
    } catch (err) {
      const fields = fieldErrors(err);
      return fields.length
        ? serverErrors(this.codeForm, fields)
        : [{ kind: 'server', message: errorMessage(err), fieldTree: this.codeForm.code }];
    }
  }
}
