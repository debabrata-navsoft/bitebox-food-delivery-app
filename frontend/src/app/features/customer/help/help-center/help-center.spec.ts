import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from '../../../../core/auth/auth.service';
import { HelpCenter } from './help-center';

describe('HelpCenter', () => {
  const auth = { isAuthenticated: () => false, role: () => null, user: () => null };

  async function open(url: string) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'help', component: HelpCenter }]),
        { provide: AuthService, useValue: auth },
      ],
    });
    const harness = await RouterTestingHarness.create(url);
    return { harness, el: harness.routeNativeElement as HTMLElement };
  }
  const titles = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('.group h2')).map((h) => h.textContent?.trim());

  it('lists every topic, and #payments opens on that one', async () => {
    const { harness, el } = await open('/help');
    expect(titles(el)).toContain('Restaurants & riders');
    await harness.navigateByUrl('/help#payments');
    expect(titles(el)).toEqual(['Payments & refunds']);
  });

  it('searches across all topics', async () => {
    const { harness, el } = await open('/help#account');
    const input = el.querySelector<HTMLInputElement>('.search input')!;
    input.value = 'refund';
    input.dispatchEvent(new Event('input'));
    await harness.fixture.whenStable();
    expect(titles(el)).toEqual(['Payments & refunds']);
    expect(el.querySelectorAll('details.faq').length).toBeGreaterThan(0);
  });

  it('offers call, chat and email', async () => {
    const { el } = await open('/help');
    expect(el.querySelector('a[href^="tel:"]')).not.toBeNull();
    expect(el.querySelector('a[href^="mailto:"]')).not.toBeNull();
    expect(el.textContent).toContain('Start a chat');
  });
});
