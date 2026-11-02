import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PasswordToggle } from './password-toggle';

@Component({
  imports: [PasswordToggle],
  template: `<input #pw type="password" /><bb-password-toggle [input]="pw" />`,
})
class Host {}

describe('PasswordToggle', () => {
  it('toggles the input between hidden and visible and updates its label', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector('input')!;
    const button = el.querySelector('button')!;

    expect(input.type).toBe('password');
    expect(button.getAttribute('aria-label')).toBe('Show password');

    button.click();
    await fixture.whenStable();
    expect(input.type).toBe('text');
    expect(button.getAttribute('aria-label')).toBe('Hide password');

    button.click();
    await fixture.whenStable();
    expect(input.type).toBe('password');
  });
});
