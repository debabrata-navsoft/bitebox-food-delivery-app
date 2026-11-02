import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { User } from '../../../shared/models/user.models';
import { Login, safeReturnUrl } from './login';

const admin: User = {
  id: 'a1',
  name: 'Admin',
  email: 'admin@bitebox.test',
  role: 'admin',
  status: 'active',
  createdAt: '',
  updatedAt: '',
};

describe('Login', () => {
  let fixture: ComponentFixture<Login>;
  let login: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    login = vi.fn();
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [provideRouter([]), { provide: AuthService, useValue: { login } }],
    }).compileComponents();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(Login);
    fixture.componentRef.setInput('portal', 'admin');
    fixture.componentRef.setInput('heading', 'Admin sign in');
    await fixture.whenStable();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const fill = (email: string, password: string) => {
    const [emailInput, passwordInput] = Array.from(el().querySelectorAll('input'));
    emailInput.value = email;
    emailInput.dispatchEvent(new Event('input'));
    passwordInput.value = password;
    passwordInput.dispatchEvent(new Event('input'));
  };
  const submit = async () => {
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };

  it('renders the portal heading', () => {
    expect(el().querySelector('h1')?.textContent).toContain('Admin sign in');
  });

  it('does not call the API when the form is invalid', async () => {
    await submit();
    expect(login).not.toHaveBeenCalled();
    expect(el().textContent).toContain('Email is required');
  });

  it('signs in with the portal role and redirects to the role home', async () => {
    login.mockReturnValue(of(admin));
    fill('admin@bitebox.test', 'Secret123');
    await submit();
    expect(login).toHaveBeenCalledWith({ email: 'admin@bitebox.test', password: 'Secret123', portal: 'admin' });
    expect(navigate).toHaveBeenCalledWith('/admin');
  });

  it('shows the server error message on failure', async () => {
    login.mockReturnValue(
      throwError(
        () => new HttpErrorResponse({ status: 401, error: { success: false, message: 'Invalid email or password' } }),
      ),
    );
    fill('admin@bitebox.test', 'wrong-pass1');
    await submit();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('Invalid email or password');
  });
});

describe('safeReturnUrl', () => {
  it('accepts in-app paths', () => expect(safeReturnUrl('/admin/users')).toBe('/admin/users'));
  it.each(['https://evil.example', '//evil.example', '/\\evil.example', '', undefined])(
    'rejects %s',
    (url) => expect(safeReturnUrl(url)).toBeNull(),
  );
});
