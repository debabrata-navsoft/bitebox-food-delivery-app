import { HttpErrorResponse } from '@angular/common/http';
import { WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { User } from '../../../shared/models/user.models';
import { Register } from './register';

const created: User = {
  id: 'u1',
  name: 'Kavya Test',
  email: 'kavya@example.com',
  role: 'customer',
  status: 'active',
  createdAt: '',
  updatedAt: '',
};
const details = {
  name: 'Kavya Test',
  email: 'kavya@example.com',
  phone: '+919876543210',
  password: 'Secret123',
  confirmPassword: 'Secret123',
  referralCode: '',
};

describe('Register (sign-up confirmed by an emailed code)', () => {
  let fixture: ComponentFixture<Register>;
  let auth: { requestSignupCode: ReturnType<typeof vi.fn>; register: ReturnType<typeof vi.fn> };
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    auth = { requestSignupCode: vi.fn(), register: vi.fn(() => of(created)) };
    await TestBed.configureTestingModule({
      imports: [Register],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    }).compileComponents();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(Register);
    await fixture.whenStable();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const component = () =>
    fixture.componentInstance as unknown as {
      model: WritableSignal<typeof details>;
      codeModel: WritableSignal<{ code: string }>;
    };
  const submit = async () => {
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };

  it('emails a code first, and creates the account only with it', async () => {
    auth.requestSignupCode.mockReturnValue(
      of({
        message: 'We have sent a code to your email',
        codeRequired: true,
        resendInSeconds: 30,
        expiresInSeconds: 300,
      }),
    );
    component().model.set(details);
    await submit();
    expect(auth.requestSignupCode).toHaveBeenCalledWith('kavya@example.com', '+919876543210');
    expect(auth.register).not.toHaveBeenCalled();
    expect(el().textContent).toContain('Confirm and create account');
    expect(el().textContent).toContain('Resend code in 30 s');
    expect(el().textContent).toContain('We have sent a code to your email: kavya@example.com');

    component().codeModel.set({ code: '123456' });
    await submit();
    expect(auth.register).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'kavya@example.com', code: '123456', role: 'customer' }),
    );
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('signs up in one step while codes are off', async () => {
    auth.requestSignupCode.mockReturnValue(
      of({ message: 'No code needed', resendInSeconds: 0, expiresInSeconds: 0, codeRequired: false }),
    );
    component().model.set(details);
    await submit();
    expect(auth.register).toHaveBeenCalledWith(
      expect.not.objectContaining({ code: expect.anything() }),
    );
  });

  it('stays on the details when the email cannot be sent', async () => {
    auth.requestSignupCode.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 503,
            error: {
              success: false,
              message: "We can't send emails right now. Please try again later",
              error: { code: 'EMAIL_UNAVAILABLE' },
            },
          }),
      ),
    );
    component().model.set(details);
    await submit();
    expect(auth.register).not.toHaveBeenCalled();
    expect(el().textContent).toContain("We can't send emails right now");
  });

  it('needs a mobile number', async () => {
    component().model.set({ ...details, phone: '' });
    await submit();
    expect(auth.requestSignupCode).not.toHaveBeenCalled();
  });
});
